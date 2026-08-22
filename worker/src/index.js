// DSH Plugin Directory 搜索 Worker：薄 HTTP 适配层，逻辑全在 search-core。
// 冷启动 fetch 同源数据（index.json.gz + plugins/ 分片），模块级内存缓存；查询纯内存，P95 目标 <300ms。
import { search } from "../../search-core/index.js";
import { createRateLimiter, rateLimitConfig } from "../../shared/rate-limit.js";

// 数据源 origin 解析（安全边界）：
// 1) 显式配置的 SITE_ORIGIN 恒优先——Referer 完全不影响数据来源；
// 2) 未配置时一律拒绝（fail closed）。曾有 *.pages.dev Referer 放行的免配置便利，但缓存是
//    模块级全局单例、不按 origin 隔离：任意第三方 pages.dev 部署可伪造 Referer 把数据源
//    解析到自己的服务器并污染全局缓存（spec：绝不接受任意 Referer）。预览环境须显式配 SITE_ORIGIN。
// 导出供集成测试直接验证解析规则。
export function resolveDataOrigin(env) {
  return (env && env.SITE_ORIGIN) || null;
}

// ---------- 缓存生命周期 ----------
// 剥离前移：README 全文只存在于同步产物；Worker 加载分片时即丢弃（10k 插件 × 8KB ≈ 80MB，
// 是逼近 128MB isolate 上限的主因），常驻内存只剩元数据与索引。
// 并发冷启动共享同一次加载（in-flight promise 防惊群）：N 个同时到达的冷请求只拉一份数据。
// TTL + stale-while-revalidate：缓存记录加载时间，到期后本次请求先回旧值、后台刷新换新——
// 搜索结果与 6 小时同步节奏对齐；02 锁定数据源后，TTL 也是缓存被污染时的自愈出路。
const CACHE_TTL_MS_DEFAULT = 10 * 60 * 1000; // env CACHE_TTL_MS 可覆盖（集成测试用）
let cache = null; // { index, plugins, loadedAt }
let inflight = null; // 进行中的加载 promise
let revalidating = false; // 进行中的后台刷新

async function loadFresh(env, base) {
  // 数据布局（2026-08 起）：单文件 plugins.json 曾达 28.8MiB、index.json 17.8MiB，
  // 超出 Cloudflare Pages 25MiB/文件上限 -> plugins 改为分片 + manifest，索引 gzip 压缩。
  const [idxRes, manRes] = await Promise.all([
    fetch(base + "/data/index.json.gz", { cf: { cacheTtl: 300 } }),
    fetch(base + "/data/plugins/manifest.json", { cf: { cacheTtl: 300 } }),
  ]);
  if (!idxRes.ok || !manRes.ok) throw new Error(`data fetch failed: index=${idxRes.status} manifest=${manRes.status}`);
  // 解压 gzip 索引（Node 与 workerd 均支持 DecompressionStream gzip）
  const decompressed = new Response(
    new Blob([await idxRes.arrayBuffer()]).stream().pipeThrough(new DecompressionStream("gzip"))
  );
  const index = await decompressed.json();
  const manifest = await manRes.json();
  const shardRes = await Promise.all(
    (manifest.shards || []).map((s) => fetch(base + "/data/plugins/" + s, { cf: { cacheTtl: 300 } }))
  );
  const bad = shardRes.find((r) => !r.ok);
  if (bad) throw new Error(`plugins shard fetch failed: ${bad.status}`);
  // 加载即剥离 README：内存与输出都不再持有全文
  const plugins = (await Promise.all(shardRes.map((r) => r.json()))).flatMap((d) =>
    (d.plugins || []).map(({ readme_text, ...meta }) => meta)
  );
  return { index, plugins, loadedAt: Date.now() };
}

async function loadData(env, base) {
  if (cache) return cache;
  if (!base) throw new Error("no trusted data origin (SITE_ORIGIN unset, referer not whitelisted)");
  if (!inflight) {
    inflight = loadFresh(env, base).then((fresh) => {
      cache = fresh;
      return fresh;
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

// TTL 到期：本次请求照常返回旧值，后台刷新换新（workerd 里用 ctx.waitUntil 保活）
function maybeRevalidate(env, base, ctx) {
  if (!cache || !base || revalidating) return;
  const ttl = Number(env && env.CACHE_TTL_MS) || CACHE_TTL_MS_DEFAULT;
  if (Date.now() - cache.loadedAt < ttl) return;
  revalidating = true;
  const p = loadFresh(env, base)
    .then((fresh) => { cache = fresh; })
    .catch((e) => console.error("[worker] background refresh failed:", e))
    .finally(() => { revalidating = false; });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
}

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

// ---------- 限流（兜底，与 Pages Function 共用 shared/rate-limit.js 的实现） ----------
// 主要限流在 Pages Function（真实访客 IP）。此处兜底直连 workers.dev 的滥用流量：
// 仅当 x-dsh-real-ip 与共享密钥头（x-dsh-shared-key，经 wrangler secret 配置 PAGES_WORKER_SHARED_KEY）
// 成对出现且密钥匹配时才信任转发 IP；未配置密钥 = 安全默认，只按边缘 CF-Connecting-IP 计数，
// 伪造转发头无法重置桶。
const checkRateLimit = createRateLimiter();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/search") {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: CORS });
    }
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: CORS });
    }
    const fwdIp = request.headers.get("x-dsh-real-ip");
    const fwdKey = request.headers.get("x-dsh-shared-key");
    const ip = fwdIp && fwdKey && env.PAGES_WORKER_SHARED_KEY && fwdKey === env.PAGES_WORKER_SHARED_KEY
      ? fwdIp
      : (request.headers.get("cf-connecting-ip") || "unknown");
    const retryAfter = checkRateLimit(ip, rateLimitConfig(env));
    if (retryAfter > 0) {
      return new Response(JSON.stringify({ error: "rate limited, slow down" }), {
        status: 429,
        headers: { ...CORS, "retry-after": String(retryAfter) },
      });
    }
    try {
      const base = resolveDataOrigin(env);
      const data = await loadData(env, base);
      maybeRevalidate(env, base, ctx); // TTL 到期：本次回旧值，后台刷新
      const params = url.searchParams;
      const q = (params.get("q") || "").slice(0, 256); // 超长查询两层截断（core 层另有一道）
      const categories = (params.get("cat") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const tags = (params.get("tag") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const sort = params.get("sort") === "stars" ? "stars" : "relevance";
      // limit 归一化（显式 0..200；0 空集；缺省/非法 50）在 search() 内统一执行——唯一一份实现
      const result = search(data.index, { q, categories, tags, sort, limit: params.get("limit") });
      // README 已在加载期剥离（见 loadFresh），输出直接取元数据
      const results = result.ids.map((id) => data.plugins[id]);
      return new Response(JSON.stringify({ total: result.total, results, scores: result.scores }), {
        headers: CORS,
      });
    } catch (e) {
      // 5xx 只回固定文案：origin/路径/状态码等内部细节不外泄，仅进日志
      console.error("[worker] internal error:", e);
      return new Response(JSON.stringify({ error: "internal error" }), { status: 500, headers: CORS });
    }
  },
};

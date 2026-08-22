// DSH Plugin Directory 搜索 Worker：薄 HTTP 适配层，逻辑全在 search-core。
// 冷启动 fetch 同源数据（index.json.gz + plugins-meta.json.gz），模块级内存缓存；查询纯内存，P95 目标 <300ms。
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
// 剥离前移：同步侧直接产出无 README 的 plugins-meta.json.gz（Worker 专用）；旧布局的
// 含 README 分片只在回退路径拉取，加载时同样剥离（10k 插件 × 8KB ≈ 80MB，是逼近
// 128MB isolate 上限的主因），常驻内存只剩元数据与索引。
// 并发冷启动共享同一次加载（in-flight promise 防惊群）：N 个同时到达的冷请求只拉一份数据。
// TTL + stale-while-revalidate：缓存记录加载时间，到期后本次请求先回旧值、后台刷新换新——
// 搜索结果与 6 小时同步节奏对齐；02 锁定数据源后，TTL 也是缓存被污染时的自愈出路。
const CACHE_TTL_MS_DEFAULT = 10 * 60 * 1000; // env CACHE_TTL_MS 可覆盖（集成测试用）
let cache = null; // { index, plugins, loadedAt }
let inflight = null; // 进行中的加载 promise
let revalidating = false; // 进行中的后台刷新

// 解压 gzip JSON（Node 与 workerd 均支持 DecompressionStream gzip；brotli 仅 workerd）
async function fetchGzipJson(url) {
  const res = await fetch(url, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`data fetch failed: ${url} -> ${res.status}`);
  return gunzipJson(res);
}

// 解压 gzip 响应体（Node 与 workerd 均支持 DecompressionStream gzip；brotli 仅 workerd）
async function gunzipJson(res) {
  const decompressed = new Response(new Blob([await res.arrayBuffer()]).stream().pipeThrough(new DecompressionStream("gzip")));
  return decompressed.json();
}

async function loadFresh(env, base) {
  // 请求必须顺序化：workerd 限制单次调用并发连接数（6），先发起的响应体不读、
  // 再继续发新请求会触发"防死锁取消"（stalled response canceled）——并行 index + 元数据
  // 曾因此整链失败。每个 fetch 的响应体都在下一步发起前读完。
  // 首选元数据分片（~2MB gz，无 README）：冷启动从"索引 14MB + 分片 61MB"降到"14MB + 2MB"，
  // 每 TTL 的后台刷新同步变轻。404 = 数据尚未随新布局发布（部署顺序解耦）：回退分片 + manifest。
  const metaRes = await fetch(base + "/data/plugins-meta.json.gz", { cf: { cacheTtl: 300 } });
  let plugins;
  if (metaRes.ok) {
    plugins = (await gunzipJson(metaRes)).plugins || [];
  } else if (metaRes.status === 404) {
    const manRes = await fetch(base + "/data/plugins/manifest.json", { cf: { cacheTtl: 300 } });
    if (!manRes.ok) throw new Error(`data fetch failed: meta=${metaRes.status} manifest=${manRes.status}`);
    const manifest = await manRes.json();
    // 回退路径分批拉分片：批内响应体立即消费（r.json()），任何时刻未读响应 ≤ 批大小，
    // 不越过并发连接上限；仅过渡期使用（新数据布局发布后走上面的 meta 路径）。
    const shards = manifest.shards || [];
    const BATCH = 4;
    plugins = [];
    for (let i = 0; i < shards.length; i += BATCH) {
      const metas = await Promise.all(shards.slice(i, i + BATCH).map(async (s) => {
        const r = await fetch(base + "/data/plugins/" + s, { cf: { cacheTtl: 300 } });
        if (!r.ok) throw new Error(`plugins shard fetch failed: ${r.status}`);
        const d = await r.json(); // 加载即剥离 README：内存与输出都不再持有全文
        return (d.plugins || []).map(({ readme_text, ...meta }) => meta);
      }));
      plugins.push(...metas.flat());
    }
  } else {
    throw new Error(`data fetch failed: meta=${metaRes.status}`);
  }
  const index = await fetchGzipJson(base + "/data/index.json.gz");
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

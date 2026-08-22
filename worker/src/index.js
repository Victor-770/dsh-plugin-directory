// DSH Plugin Directory 搜索 Worker：薄 HTTP 适配层，逻辑全在 search-core。
// 冷启动 fetch 同源数据（index.json.gz + plugins/ 分片），模块级内存缓存；查询纯内存，P95 目标 <300ms。
import { search } from "../../search-core/index.js";
import { createRateLimiter, rateLimitConfig } from "../../shared/rate-limit.js";

let cache = null;

// 数据源 origin 解析（安全边界）：
// 1) 显式配置的 SITE_ORIGIN 恒优先——Referer 完全不影响数据来源；
// 2) 未配置时只接受白名单 Referer origin：官方 *.pages.dev 子域（保留换环境免配置的便利）；
// 3) 其余一律拒绝——伪造 Referer 直连 Worker 不能改数据源、也不能污染全局缓存。
// 导出供集成测试直接验证解析规则。
export function resolveDataOrigin(env, referer) {
  if (env && env.SITE_ORIGIN) return env.SITE_ORIGIN;
  if (referer) {
    try {
      const { origin, hostname } = new URL(referer);
      if (hostname.endsWith(".pages.dev")) return origin;
    } catch { /* 非法 Referer 忽略 */ }
  }
  return null;
}

async function loadData(env, base) {
  if (cache) return cache;
  if (!base) throw new Error("no trusted data origin (SITE_ORIGIN unset, referer not whitelisted)");
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
  const plugins = (await Promise.all(shardRes.map((r) => r.json()))).flatMap((d) => d.plugins || []);
  cache = { index, plugins };
  return cache;
}

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

// ---------- 限流（兜底，与 Pages Function 共用 shared/rate-limit.js 的实现） ----------
// 主要限流在 Pages Function（真实访客 IP）。此处兜底直连 workers.dev 的滥用流量：
// 仅当 x-dsh-real-ip 与共享密钥头（x-dsh-shared-key，经 wrangler secret 配置 PAGES_WORKER_SHARED_KEY）
// 成对出现且密钥匹配时才信任转发 IP；未配置密钥 = 安全默认，只按边缘 CF-Connecting-IP 计数，
// 伪造转发头无法重置桶。
const checkRateLimit = createRateLimiter();

export default {
  async fetch(request, env) {
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
      const base = resolveDataOrigin(env, request.headers.get("referer"));
      const data = await loadData(env, base);
      const params = url.searchParams;
      const q = params.get("q") || "";
      const categories = (params.get("cat") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const tags = (params.get("tag") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const sort = params.get("sort") === "stars" ? "stars" : "relevance";
      const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
      const result = search(data.index, { q, categories, tags, sort, limit });
      // 响应瘦身：不携带 readme_text（站点经 GitHub 外链看 README），避免 50×8KB 拖慢 P95。
      const results = result.ids.map((id) => {
        const { readme_text, ...meta } = data.plugins[id];
        return meta;
      });
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

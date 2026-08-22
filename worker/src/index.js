// DSH Plugin Directory 搜索 Worker（Ticket 03）：薄 HTTP 适配层，逻辑全在 search-core。
// 冷启动 fetch 同源数据（index.json.br + plugins/ 分片），模块级内存缓存；查询纯内存，P95 目标 <300ms。
import { search } from "../../search-core/index.js";

let cache = null;

async function loadData(env, requestOrigin) {
  if (cache) return cache;
  // 实际访问域名（Referer）优先：站点换域名也无需改 Worker 配置；SITE_ORIGIN 仅直连兜底
  const base = requestOrigin || (env && env.SITE_ORIGIN);
  if (!base) throw new Error("SITE_ORIGIN not configured and no referer origin available");
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

// ---------- 限流（进程内滑动窗口） ----------
// 主要限流在 Pages Function（真实访客 IP，见 functions/api/search.js），那里会把真实 IP 以
// x-dsh-real-ip 头转发过来。此处是兜底：Pages 代理流量按转发头限流，直连 workers.dev 的
// 滥用请求按边缘 CF-Connecting-IP 限流。免费版按隔离实例生效，挡脚本抓取足够，DDoS 交给面板。
// 环境变量：RATE_LIMIT_MAX（默认 120）、RATE_LIMIT_WINDOW_SECONDS（默认 60）。
const buckets = new Map(); // ip -> { start, count }
let lastSweep = 0;
function checkRateLimit(ip, env) {
  const windowMs = (Number(env?.RATE_LIMIT_WINDOW_SECONDS) || 60) * 1000;
  const max = Number(env?.RATE_LIMIT_MAX) || 120;
  const now = Date.now();
  if (buckets.size >= 10000 && now - lastSweep >= windowMs) {
    lastSweep = now;
    for (const [k, b] of buckets) if (now - b.start >= windowMs) buckets.delete(k);
  }
  const b = buckets.get(ip);
  if (!b || now - b.start >= windowMs) {
    buckets.set(ip, { start: now, count: 1 });
    return 0;
  }
  b.count++;
  return b.count > max ? Math.ceil((b.start + windowMs - now) / 1000) : 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/search") {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: CORS });
    }
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: CORS });
    }
    // 兜底限流：Pages 代理转发真实 IP，直连时用边缘 IP
    const ip = request.headers.get("x-dsh-real-ip") || request.headers.get("cf-connecting-ip") || "unknown";
    const retryAfter = checkRateLimit(ip, env);
    if (retryAfter > 0) {
      return new Response(JSON.stringify({ error: "rate limited, slow down" }), {
        status: 429,
        headers: { ...CORS, "retry-after": String(retryAfter) },
      });
    }
    try {
      const referer = request.headers.get("referer");
      const requestOrigin = referer ? new URL(referer).origin : null;
      const data = await loadData(env, requestOrigin);
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
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: CORS });
    }
  },
};
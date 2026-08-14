// DSH Plugin Directory 搜索 Worker（Ticket 03）：薄 HTTP 适配层，逻辑全在 search-core。
// 冷启动 fetch 同源 index.json + plugins.json，模块级内存缓存；查询纯内存，P95 目标 <300ms。
import { search } from "../../search-core/index.js";

let cache = null;

async function loadData(env, requestOrigin) {
  if (cache) return cache;
  const base = (env && env.SITE_ORIGIN) || requestOrigin;
  if (!base) throw new Error("SITE_ORIGIN not configured and no referer origin available");
  const [idx, pl] = await Promise.all([
    fetch(base + "/data/index.json", { cf: { cacheTtl: 300 } }),
    fetch(base + "/data/plugins.json", { cf: { cacheTtl: 300 } }),
  ]);
  if (!idx.ok || !pl.ok) throw new Error(`data fetch failed: index=${idx.status} plugins=${pl.status}`);
  cache = { index: await idx.json(), plugins: (await pl.json()).plugins };
  return cache;
}

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/search") {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: CORS });
    }
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: CORS });
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

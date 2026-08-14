// Cloudflare Pages Function：把 /api/search 代理到搜索 Worker（免 CORS、免前端配置）。
// 环境变量 WORKER_URL（Pages 面板配置）指向 Worker 地址，如 https://dsh-plugin-directory-search.xxx.workers.dev
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.WORKER_URL) {
    return Response.json({ error: "WORKER_URL not configured" }, { status: 500 });
  }
  const url = new URL(request.url);
  const target = env.WORKER_URL + "/api/search" + url.search;
  try {
    const upstream = await fetch(target, { headers: { referer: url.origin } });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}

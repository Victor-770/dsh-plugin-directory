// Cloudflare Pages Function：把 /api/search 代理到搜索 Worker（免 CORS、免前端配置）。
// 环境变量 WORKER_URL（Pages 面板配置）指向 Worker 地址，如 https://dsh-plugin-directory-search.xxx.workers.dev
//
// 限流：浏览器 -> Pages（此处）-> Worker，Worker 看到的 CF-Connecting-IP 是 Cloudflare 边缘 IP，
// 所以按真实访客 IP 的限流只能放在这里（见 checkRateLimit）。同时把真实 IP 以 x-dsh-real-ip
// 头转发给 Worker，作为 Worker 直连（workers.dev 地址被滥用）时的兜底。

// ---------- 限流（进程内滑动窗口，按真实访客 IP） ----------
// 免费版没有分布式限流绑定，这里按 Pages Function 隔离实例做内存计数：能挡住把搜索接口
// 当免费后端整站克隆 / 高频抓取的脚本；防御全网 DDoS 是 Cloudflare 面板 rate limiting rules 的职责。
// 环境变量：RATE_LIMIT_MAX（窗口内最大请求数，默认 120）、RATE_LIMIT_WINDOW_SECONDS（默认 60）。
const buckets = new Map(); // ip -> { start, count }
let lastSweep = 0;
function checkRateLimit(ip, env) {
  const windowMs = (Number(env?.RATE_LIMIT_WINDOW_SECONDS) || 60) * 1000;
  const max = Number(env?.RATE_LIMIT_MAX) || 120;
  const now = Date.now();
  // 桶表膨胀时清扫过期条目（最多每窗口一次，避免每请求全量扫描）
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
  return b.count > max ? Math.ceil((b.start + windowMs - now) / 1000) : 0; // 剩余冷却秒数
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const retryAfter = checkRateLimit(ip, env);
  if (retryAfter > 0) {
    return Response.json({ error: "rate limited, slow down" }, {
      status: 429,
      headers: { "retry-after": String(retryAfter) },
    });
  }
  if (!env.WORKER_URL) {
    return Response.json({ error: "WORKER_URL not configured" }, { status: 500 });
  }
  const url = new URL(request.url);
  const target = env.WORKER_URL + "/api/search" + url.search;
  try {
    const upstream = await fetch(target, {
      headers: {
        referer: url.origin,
        "x-dsh-real-ip": ip, // 转发真实访客 IP，Worker 侧兜底限流用
      },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}

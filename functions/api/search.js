// Cloudflare Pages Function：把 /api/search 代理到搜索 Worker（免 CORS、免前端配置）。
//
// 环境变量（Pages 面板配置）：
//   WORKER_URL                Worker 地址，如 https://dsh-plugin-directory-search.xxx.workers.dev
//   PAGES_WORKER_SHARED_KEY   （可选，推荐）与 Worker 共享的密钥。配置后随真实 IP 一起发送，
//                             Worker 才信任 x-dsh-real-ip 转发头；未配置时 Worker 只按边缘 IP
//                             限流，功能不受影响（安全默认，部署不依赖密钥存在）。
//   RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SECONDS  本层限流参数（默认 120 / 60s）。
//   UPSTREAM_TIMEOUT_MS       上游请求超时（默认 10000；集成测试用它模拟挂起的上游）。
//
// 限流：浏览器 -> Pages（此处）-> Worker，Worker 看到的 CF-Connecting-IP 是 Cloudflare 边缘 IP，
// 所以按真实访客 IP 的限流放在这里（实现与 Worker 共用 shared/rate-limit.js，唯一一份）。
import { createRateLimiter, rateLimitConfig } from "../../shared/rate-limit.js";

const checkRateLimit = createRateLimiter();

// 上游 429/限流时白名单透传的响应头：retry-after 供被限流调用方正确退避，CORS 与 Worker 一致。
const PASSTHROUGH_HEADERS = ["retry-after", "access-control-allow-origin"];

export async function onRequestGet(context) {
  const { request, env } = context;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const retryAfter = checkRateLimit(ip, rateLimitConfig(env));
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
  const fwdHeaders = {
    referer: url.origin,
    "x-dsh-real-ip": ip, // 真实访客 IP；Worker 仅在密钥匹配时才信任它
  };
  if (env.PAGES_WORKER_SHARED_KEY) fwdHeaders["x-dsh-shared-key"] = env.PAGES_WORKER_SHARED_KEY;
  try {
    const timeoutMs = Number(env.UPSTREAM_TIMEOUT_MS) || 10000;
    const upstream = await fetch(target, { headers: fwdHeaders, signal: AbortSignal.timeout(timeoutMs) });
    const headers = { "content-type": "application/json; charset=utf-8" };
    for (const h of PASSTHROUGH_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) headers[h] = v;
    }
    const body = await upstream.text();
    return new Response(body, { status: upstream.status, headers });
  } catch {
    // 上游超时/不可达：固定文案，不外泄内部细节
    return Response.json({ error: "upstream unavailable" }, { status: 502 });
  }
}

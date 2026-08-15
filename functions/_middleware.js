// Cloudflare Pages Functions 根级中间件：
// 将 pages.dev 流量 301 永久重定向到自定义域名，其余请求正常处理。
// 放在 functions/_middleware.js 会拦截站点所有请求（静态资源 + Functions）。
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 将 pages.dev 流量 301 永久重定向到自定义域名
  if (url.hostname === 'dsh-plugin-directory.pages.dev') {
    url.hostname = 'dsh-plugin-directory.online';
    return Response.redirect(url.toString(), 301);
  }

  // 其他请求正常处理
  return context.next();
}

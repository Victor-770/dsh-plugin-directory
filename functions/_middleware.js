// Cloudflare Pages Functions 根级中间件：
// 将生产 pages.dev 流量 301 永久重定向到自定义域名，其余请求正常处理。
// 放在 functions/_middleware.js 会拦截站点所有请求（静态资源 + Functions）。
import { SITE_ORIGIN } from "../shared/site-origin.js"; // 主域名单一来源

// 生产 pages.dev 主机名（Pages 项目子域，不可从 SITE_ORIGIN 推得；精确匹配——
// 后缀匹配会把预览部署 <hash>.xxx.pages.dev 也劫持到主域，破坏预览可用性）
const PRODUCTION_PAGES_HOST = "dsh-plugin-directory.pages.dev";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (url.hostname === PRODUCTION_PAGES_HOST) {
    url.hostname = SITE_ORIGIN.replace(/^https?:\/\//, "");
    return Response.redirect(url.toString(), 301);
  }

  // 其他请求正常处理
  return context.next();
}


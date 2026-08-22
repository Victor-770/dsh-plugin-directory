// canonical 站点域名 —— 单一来源。
// 此前散布在：同步脚本（scripts/sync.mjs）、wrangler 配置（worker/wrangler.toml，注释指回此处）、
// pages.dev→主域重定向中间件（functions/_middleware.js）、站点配置（site/astro.config.mjs → Astro.site
// → 各页 canonical/sitemap）。改域名只改这里 + wrangler 部署变量。
export const SITE_ORIGIN = "https://dsh-plugin-directory.online";

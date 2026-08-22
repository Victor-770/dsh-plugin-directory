// canonical 站点域名 —— 单一来源。
// 此前散布在：同步脚本（scripts/sync.mjs）、wrangler 配置（worker/wrangler.toml，注释指回此处）、
// pages.dev→主域重定向中间件（functions/_middleware.js）、站点配置（site/astro.config.mjs → Astro.site
// → 各页 canonical/sitemap）。改域名只改这里 + wrangler 部署变量。
export const SITE_ORIGIN = "https://dsh-plugin-directory.online";
// 裸主机名（重定向目标与 IndexNow host 用）：从 SITE_ORIGIN 派生，避免 replace 散落多处。
export const SITE_HOST = SITE_ORIGIN.replace(/^https?:\/\//, "");

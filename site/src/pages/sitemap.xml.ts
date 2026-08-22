import { CATEGORY_ORDER } from "../lib/i18n.js";
import { CATEGORY_SLUGS } from "../lib/category-meta.js";
import { readFileSync } from "node:fs";
import path from "node:path";

// 构建期生成 sitemap.xml（静态输出下自动预渲染）：
// 首页 + 全部插件详情页（中英两个版本），每条 URL 带完整 hreflang 互链（含自引用与 x-default）。
// canonical 域名经 astro.config（SITE_ORIGIN 单源）注入 endpoint 的 site 上下文。
export function GET({ site }) {
  const base = site.origin;
  const browsePath = path.join(process.cwd(), "public", "data", "browse.json");
  let plugins = [];
  let lastmod = new Date().toISOString().slice(0, 10);
  try {
    const raw = JSON.parse(readFileSync(browsePath, "utf8"));
    plugins = raw.plugins || [];
    if (raw.generatedAt) {
      const d = new Date(String(raw.generatedAt).replace(/\//g, "-"));
      if (!Number.isNaN(d.getTime())) lastmod = d.toISOString().slice(0, 10);
    }
  } catch { /* 数据缺失时只输出首页 */ }
  const esc = (str) => String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const alternates = (zh, en) =>
    `<xhtml:link rel="alternate" hreflang="zh" href="${zh}"/>` +
    `<xhtml:link rel="alternate" hreflang="en" href="${en}"/>` +
    `<xhtml:link rel="alternate" hreflang="x-default" href="${zh}"/>`;
  // 分类页（仅收录有插件的分类，避免 thin page）
  const catKeys = new Set();
  for (const p of plugins) for (const c of p.categories || []) catKeys.add(c);
  const urls = [];
  // 首页：/ 与 /en/
  urls.push(`<url><loc>${base}/</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority>${alternates(base + "/", base + "/en/")}</url>`);
  urls.push(`<url><loc>${base}/en/</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority>${alternates(base + "/", base + "/en/")}</url>`);
  // 插件详情页：/plugin/... 与 /en/plugin/...
  // lastmod 用插件自身 pushed_at（Bing 指南 §3：准确 lastmod 比同步时间更有意义），无则回退同步时间。
  for (const p of plugins) {
    const [owner, repo] = p.full_name.split("/");
    if (!owner || !repo || owner.includes("..") || repo.includes("..")) continue;
    const pLastmod = (p.pushed_at || "").slice(0, 10) || lastmod;
    const zh = `${base}/plugin/${esc(owner)}/${esc(repo)}/`;
    const en = `${base}/en/plugin/${esc(owner)}/${esc(repo)}/`;
    urls.push(`<url><loc>${zh}</loc><lastmod>${pLastmod}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority>${alternates(zh, en)}</url>`);
    urls.push(`<url><loc>${en}</loc><lastmod>${pLastmod}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority>${alternates(zh, en)}</url>`);
  }
  // 关于页
  urls.push(`<url><loc>${base}/about/</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.3</priority>${alternates(base + "/about/", base + "/en/about/")}</url>`);
  urls.push(`<url><loc>${base}/en/about/</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.3</priority>${alternates(base + "/about/", base + "/en/about/")}</url>`);
  // 分类落地页
  for (const key of CATEGORY_ORDER) {
    if (!catKeys.has(key) || !CATEGORY_SLUGS[key]) continue;
    const zh = `${base}/category/${CATEGORY_SLUGS[key]}/`;
    const en = `${base}/en/category/${CATEGORY_SLUGS[key]}/`;
    urls.push(`<url><loc>${zh}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority>${alternates(zh, en)}</url>`);
    urls.push(`<url><loc>${en}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority>${alternates(zh, en)}</url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join("")}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
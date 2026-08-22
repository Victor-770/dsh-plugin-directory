// sitemap 构建期数据与 XML 组装（单一实现，供 /sitemap.xml 索引与 /sitemaps/[file].xml 分片共用）。
// 拆分动机：单文件 sitemap 在 10k 插件语料下达 11MB/2 万+ URL，对爬虫抓取不友好；
// 协议规范（sitemapindex）+ 每分片 ≤5000 URL。
import { readFileSync } from "node:fs";
import path from "node:path";
import { CATEGORY_ORDER } from "./i18n.js";
import { CATEGORY_SLUGS } from "./category-meta.js";
import { hasEnPage } from "./publish-policy.js";
import { getArticlesByLang } from "./articles-data.js";

export const SITEMAP_URLS_PER_FILE = 5000;

// 读取 browse.json（构建时 cwd 恒为 site/）。数据缺失时返回空列表（sitemap 只剩首页等核心 URL）。
export function loadSitemapPlugins() {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), "public", "data", "browse.json"), "utf8")).plugins || [];
  } catch {
    return [];
  }
}
export function loadGeneratedAt() {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), "public", "data", "browse.json"), "utf8")).generatedAt || null;
  } catch {
    return null;
  }
}

const esc = (str) => String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// hreflang 互链：en 页存在的插件输出完整三联；不足门槛的只输出 zh + x-default（不指向 404）
const alternates = (zh, en) =>
  `<xhtml:link rel="alternate" hreflang="zh" href="${zh}"/>` +
  (en ? `<xhtml:link rel="alternate" hreflang="en" href="${en}"/>` : "") +
  `<xhtml:link rel="alternate" hreflang="x-default" href="${zh}"/>`;

const url = (loc, lastmod, changefreq, priority, zh, en) =>
  `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority>${alternates(zh, en)}</url>`;

// 分片文件名清单（数据驱动）：core + plugins-zh-N + plugins-en-N。
export function sitemapFileNames(plugins) {
  const zhPages = Math.max(1, Math.ceil(plugins.length / SITEMAP_URLS_PER_FILE));
  const enCount = plugins.filter(hasEnPage).length;
  const enPages = Math.max(1, Math.ceil(enCount / SITEMAP_URLS_PER_FILE));
  const names = ["core"];
  for (let i = 1; i <= zhPages; i++) names.push(`plugins-zh-${i}`);
  for (let i = 1; i <= enPages; i++) names.push(`plugins-en-${i}`);
  return names;
}

// 组装每个分片的 <url> 列表
function coreUrls(base, plugins, lastmod) {
  const catKeys = new Set();
  for (const p of plugins) for (const c of p.categories || []) catKeys.add(c);
  const urls = [
    url(`${base}/`, lastmod, "daily", "1.0", `${base}/`, `${base}/en/`),
    url(`${base}/en/`, lastmod, "daily", "1.0", `${base}/`, `${base}/en/`),
    url(`${base}/articles/`, lastmod, "daily", "0.9", `${base}/articles/`, `${base}/en/articles/`),
    url(`${base}/en/articles/`, lastmod, "daily", "0.9", `${base}/articles/`, `${base}/en/articles/`),
    url(`${base}/about/`, lastmod, "monthly", "0.3", `${base}/about/`, `${base}/en/about/`),
    url(`${base}/en/about/`, lastmod, "monthly", "0.3", `${base}/about/`, `${base}/en/about/`),
  ];
  const zhArticles = getArticlesByLang("zh");
  for (const a of zhArticles) {
    const aLastmod = (a.updatedAt || a.publishedAt || lastmod).slice(0, 10);
    const zh = `${base}/articles/${a.slug}/`;
    const en = `${base}/en/articles/${a.slug}/`;
    urls.push(url(zh, aLastmod, "weekly", "0.8", zh, en), url(en, aLastmod, "weekly", "0.8", zh, en));
  }
  for (const key of CATEGORY_ORDER) {
    if (!catKeys.has(key) || !CATEGORY_SLUGS[key]) continue;
    const zh = `${base}/category/${CATEGORY_SLUGS[key]}/`;
    const en = `${base}/en/category/${CATEGORY_SLUGS[key]}/`;
    urls.push(url(zh, lastmod, "weekly", "0.7", zh, en), url(en, lastmod, "weekly", "0.7", zh, en));
  }
  return urls;
}
function pluginUrls(base, plugins, lastmod, lang) {
  const out = [];
  for (const p of plugins) {
    if (lang === "en" && !hasEnPage(p)) continue;
    const [owner, repo] = p.full_name.split("/");
    if (!owner || !repo || owner.includes("..") || repo.includes("..")) continue;
    // lastmod 用插件自身 pushed_at（Bing 指南 §3：准确 lastmod 比同步时间更有意义），无则回退同步时间
    const pLastmod = (p.pushed_at || "").slice(0, 10) || lastmod;
    const zh = `${base}/plugin/${esc(owner)}/${esc(repo)}/`;
    const en = `${base}/en/plugin/${esc(owner)}/${esc(repo)}/`;
    const enHref = hasEnPage(p) ? en : null;
    out.push(lang === "zh" ? url(zh, pLastmod, "weekly", "0.6", zh, enHref) : url(en, pLastmod, "weekly", "0.6", zh, en));
  }
  return out;
}

// 全部 sitemap 内容：Map<文件名（不含扩展名）, xml 字符串>，含 "sitemap"（索引）。
// 模块级 memo：索引与分片两个端点各调一次，避免双份 10k URL 组装。
let memo = null;
export function buildSitemaps(base) {
  if (memo && memo.base === base) return memo.result;
  const plugins = loadSitemapPlugins();
  const generatedAt = loadGeneratedAt();
  let lastmod = new Date().toISOString().slice(0, 10);
  if (generatedAt) {
    const d = new Date(String(generatedAt).replace(/\//g, "-"));
    if (!Number.isNaN(d.getTime())) lastmod = d.toISOString().slice(0, 10);
  }
  const wrap = (urls) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join("")}</urlset>`;
  const result = new Map();
  result.set("core", wrap(coreUrls(base, plugins, lastmod)));
  for (const lang of ["zh", "en"]) {
    const urls = pluginUrls(base, plugins, lastmod, lang);
    const pages = Math.max(1, Math.ceil(urls.length / SITEMAP_URLS_PER_FILE));
    for (let i = 1; i <= pages; i++) {
      result.set(`plugins-${lang}-${i}`, wrap(urls.slice((i - 1) * SITEMAP_URLS_PER_FILE, i * SITEMAP_URLS_PER_FILE)));
    }
  }
  const names = sitemapFileNames(plugins);
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    names.map((n) => `<sitemap><loc>${base}/sitemaps/${n}.xml</loc><lastmod>${lastmod}</lastmod></sitemap>`).join("")
  }</sitemapindex>`;
  result.set("sitemap", indexXml);
  memo = { base, result };
  return result;
}

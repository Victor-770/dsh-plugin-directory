// /sitemap.xml：sitemapindex（指向 /sitemaps/*.xml 分片）。拆分动机与分片清单见 lib/sitemap-data.js。
// robots.txt 与外部提交入口仍指向本 URL（对爬客透明：索引自动被发现）。
import { buildSitemaps } from "../lib/sitemap-data.js";

export function GET({ site }) {
  const xml = buildSitemaps(site.origin).get("sitemap");
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

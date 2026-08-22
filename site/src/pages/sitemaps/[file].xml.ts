// /sitemaps/{file}.xml：sitemap 分片（core / plugins-zh-N / plugins-en-N）。
// 分片数由数据规模决定（每片 ≤ SITEMAP_URLS_PER_FILE 条），getStaticPaths 枚举实际文件名。
import { buildSitemaps, sitemapFileNames, loadSitemapPlugins } from "../../lib/sitemap-data.js";

export async function getStaticPaths() {
  return sitemapFileNames(loadSitemapPlugins()).map((file) => ({ params: { file } }));
}

export function GET({ site, params }) {
  const xml = buildSitemaps(site.origin).get(params.file);
  if (!xml) return new Response("not found", { status: 404 });
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

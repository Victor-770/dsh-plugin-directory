// 发布策略（单一来源）：OG 图只出 top-N、英文详情页只出 star 达标插件。
// 动机：Cloudflare Pages 免费版每次部署上限 20,000 文件；每插件产物 = zh 详情页 + en 详情页
// + OG 图 = 3 文件，语料涨到 10k+ 后全量产物 31k+ 文件直接超限（部署失败）。
// 使用方必须全部 import 本模块，禁止各自硬编码阈值（漂移 = 404 链接 / 错误 hreflang）：
//   - site/scripts/og-images.mjs（只渲染 top-N）
//   - 中英详情页模板（OG 回退、hreflang、语言切换）
//   - PluginCard / CategoryPage / browse.js（en 树内不足阈值的插件回退链到 zh 页）
//   - sitemap（en URL 与 en alternate 只在达标时输出）
//   - scripts/sync.mjs（IndexNow 的 en URL 提交/下线通知）

// 英文详情页门槛：star >= 2 才生成 /en/plugin/...（2026-08 语料下 ≈31% 插件）。
// 0-1 星长尾的英文壳页（内容仍是原文）几乎没有搜索流量，砍掉后 en 树仍覆盖全部头部插件。
export const EN_PAGE_MIN_STARS = 2;
export function hasEnPage(p) {
  return (p && Number(p.stars) || 0) >= EN_PAGE_MIN_STARS;
}

// 每插件 OG 图只为 star top-N 生成（社交分享真正会抓 OG 的几乎只有头部插件）。
// 其余详情页回退站点级 /og.png。tie 按 full_name 稳定排序：同步间 star 抖动不让集合边缘闪动。
export const OG_TOP_N = 500;
export function ogTopSet(plugins) {
  const list = (plugins || []).filter(
    (p) => typeof p.full_name === "string" && p.full_name.includes("/") && !p.full_name.includes("..")
  );
  list.sort((a, b) => (Number(b.stars) || 0) - (Number(a.stars) || 0) || (a.full_name < b.full_name ? -1 : 1));
  return new Set(list.slice(0, OG_TOP_N).map((p) => p.full_name));
}
export function pluginOgUrl(site, p, ogSet) {
  return ogSet && ogSet.has(p.full_name)
    ? `${site}/og/plugin/${p.full_name}/index.png`
    : `${site}/og.png`;
}

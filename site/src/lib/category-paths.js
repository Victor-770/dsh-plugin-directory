// 分类路由的构建期取数：browse.json 读取 + 按 CATEGORY_ORDER 分组（star 降序）。
// 四个 getStaticPaths（中英 × 首页/分页页）共用——数据加载必须位于 getStaticPaths 调用链内
// （Astro 编译约束），故以函数提供而非模块顶层执行。
import { readFileSync } from "node:fs";
import path from "node:path";
import { CATEGORY_ORDER } from "./i18n.js";
import { CATEGORY_SLUGS } from "./category-meta.js";

export function loadCategories() {
  let browse = [];
  try {
    browse = JSON.parse(readFileSync(path.join(process.cwd(), "public", "data", "browse.json"), "utf8")).plugins || [];
  } catch { /* 数据未生成时站点仍可构建（空列表） */ }
  return CATEGORY_ORDER.map((key) => ({
    key,
    slug: CATEGORY_SLUGS[key],
    plugins: browse.filter((p) => (p.categories || []).includes(key)).sort((a, b) => b.stars - a.stars),
  }));
}

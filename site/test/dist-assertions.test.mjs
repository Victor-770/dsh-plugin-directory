// 构建产物断言（地基票 01）：锁定"当前为真"的站点构建产物性质，作为前端修复票（12-15）的
// 验收手段与重构安全网。
//
// 机制约定（后续票在此追加断言）：
// - 每个修复票为自己的修复追加 1-2 条断言（如 12 追加 /en/ 初始化语言、13 追加 404 样式表、
//   14 分页后大幅下调分类页体积上界）。
// - 只断言外部可观察的产物内容（HTML 结构、体积、文件数），不断言实现细节。
// - 基线数字是有意的决定：语料增长导致的上调应伴随一次明确评审，而不是被动漂移。
// - dist 不存在（干净 clone / CI 测试先于构建）时整组跳过并提示，不阻塞 npm test。
// - 断言保持顶层平铺（共享 whenBuilt 跳过守卫）：嵌套 t.test() 在 node:test 部分版本上
//   会被父测试提前取消（nodejs/node#58227），勿改回嵌套结构。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasEnPage } from "../src/lib/publish-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");

// ---- 基线（2026-08-22 发布策略收敛：OG top-500、en 详情页 star>=2、sitemap 拆分） ----
const BASELINE = {
  // dist 总文件数上界 = Cloudflare Pages 免费版每次部署 20,000 文件硬上限（超出直接部署失败，
  // 曾因语料涨到 10k+ 全量产物 31,607 文件超限）。语料自然增长顶到上界时：优先调发布策略
  // （publish-policy 的门槛/top-N），其次评审迁移付费计划（100k），不可被动漂移。
  distFiles: 19999,
  // 最大分类单页 HTML 上界：分页后实测最大 ~62KB（150 条/页）。上界留余量到 100KB。
  maxCategoryHtmlBytes: 100_000,
  // OG 图上界 = publish-policy OG_TOP_N + 1（manifest.json）
  ogFiles: 501,
};

const read = (rel) => readFileSync(path.join(DIST, rel), "utf8");
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const built = existsSync(path.join(DIST, "index.html"));
const whenBuilt = { skip: built ? false : "dist 不存在（先 cd site && npm run build）；干净环境跳过" };

test("/en/ 页面 html lang=en", whenBuilt, () => {
  const html = read(path.join("en", "index.html"));
  assert.match(html, /<html[^>]*lang="en"/, "en/index.html 的 <html> 应带 lang=\"en\"");
});

test("zh 首页 html lang=zh", whenBuilt, () => {
  const html = read("index.html");
  assert.match(html, /<html[^>]*lang="zh"/, "index.html 的 <html> 应带 lang=\"zh\"");
});

test("404 页含样式表链接（Ticket 13）", whenBuilt, () => {
  const html = read("404.html");
  assert.match(html, /<link[^>]+stylesheet[^>]*>/i, "404.html 应引入样式表（曾为裸 HTML）");
  assert.ok(!html.includes('rel="canonical"'), "noindex 的 404 页不应有 canonical（自相矛盾的信号）");
});

test("/en/ 页面浏览端初始化语言为 en（Ticket 12，可静态断言部分）", whenBuilt, () => {
  // BrowseApp 的 lang 参数经打包保留在 _astro chunk 中：至少一个 chunk 以 en 初始化。
  // 引号形式不固定（esbuild 会按文件内引号分布选 " 或 `），三种引号都接受。
  const chunks = readdirSync(path.join(DIST, "_astro")).filter((f) => f.endsWith(".js"));
  const hit = chunks.some((f) =>
    /lang:\s*([`"'])en\1/.test(readFileSync(path.join(DIST, "_astro", f), "utf8")));
  assert.ok(hit, "打包产物中应有 BrowseApp({ lang: \"en\" }) 调用（/en/ 页面初始化语言）");
});

test("分类分页产物存在（Ticket 14）：最大分类有第 2 页且含分页导航", whenBuilt, () => {
  const p2 = path.join(DIST, "category", "tools-dev", "2", "index.html");
  assert.ok(existsSync(p2), "tools-dev（最大分类）应有第 2 页");
  const html = readFileSync(p2, "utf8");
  assert.match(html, /rel="canonical" href="[^"]*\/category\/tools-dev\/2\/"/, "第 2 页 canonical 应指向自身");
  assert.match(html, /rel="prev"/, "第 2 页应有 prev 链接");
  assert.match(html, /aria-label="分页"/, "分页导航应存在");
});

test("浏览端精简数据已产出（Ticket 15）", whenBuilt, () => {
  const lite = path.join(DIST, "data", "browse-lite.json");
  assert.ok(existsSync(lite), "dist/data/browse-lite.json 应存在");
  const data = JSON.parse(readFileSync(lite, "utf8"));
  const sample = data.plugins[0];
  assert.ok(sample && "full_name" in sample && "description" in sample);
  assert.ok(!("html_url" in sample) && !("pushed_at" in sample) && !("readme_text" in sample), "精简版不应含 html_url/pushed_at/readme_text");
  assert.ok(Object.entries(sample).every(([k, v]) => k !== "description" || v.length <= 200), "描述应截断到 200 字符");
});

test(`分类单页 HTML 体积 ≤ ${BASELINE.maxCategoryHtmlBytes} 字节`, whenBuilt, () => {
  let worst = { file: null, size: 0 };
  for (const dir of ["category", path.join("en", "category")]) {
    const base = path.join(DIST, dir);
    if (!existsSync(base)) continue;
    for (const slug of readdirSync(base)) {
      const f = path.join(base, slug, "index.html");
      if (!existsSync(f)) continue;
      const size = statSync(f).size;
      if (size > worst.size) worst = { file: path.join(dir, slug, "index.html"), size };
    }
  }
  assert.ok(
    worst.size <= BASELINE.maxCategoryHtmlBytes,
    `${worst.file} 为 ${worst.size} 字节，超过上界 ${BASELINE.maxCategoryHtmlBytes}（期望 ≤ 上界，实际见前）`
  );
});

test(`dist 文件数 ≤ 基线 ${BASELINE.distFiles}`, whenBuilt, () => {
  const count = walk(DIST).length;
  assert.ok(
    count <= BASELINE.distFiles,
    `dist 文件数 ${count} 超过基线 ${BASELINE.distFiles}（期望 ≤ 基线）：若为语料自然增长，评审后有意上调基线`
  );
});

// ---- 发布策略断言（OG top-N / en 页 star 门槛 / sitemap 拆分） ----

test("OG 图只发布 top-N（publish-policy OG_TOP_N）", whenBuilt, () => {
  const ogDir = path.join(DIST, "og", "plugin");
  assert.ok(existsSync(ogDir), "dist/og/plugin 应存在");
  const files = walk(ogDir);
  const pngs = files.filter((f) => f.endsWith("index.png"));
  assert.ok(pngs.length >= 1 && files.length <= BASELINE.ogFiles, `og 文件数 ${files.length} 应在 1..${BASELINE.ogFiles}（png=${pngs.length}）`);
});

test("en 详情页只为 star 达标插件生成（publish-policy EN_PAGE_MIN_STARS）", whenBuilt, () => {
  const browse = JSON.parse(read(path.join("data", "browse.json"))).plugins || [];
  const expected = browse.filter(hasEnPage).length;
  const enPages = walk(path.join(DIST, "en", "plugin")).filter((f) => f.endsWith("index.html")).length;
  assert.equal(enPages, expected, `en 详情页数 ${enPages} 应等于达标插件数 ${expected}`);
});

test("sitemap 为索引 + 分片结构且分片文件存在", whenBuilt, () => {
  const index = read("sitemap.xml");
  assert.match(index, /<sitemapindex/, "sitemap.xml 应为 sitemapindex");
  const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 3, `索引应列出 ≥3 个分片（core + zh + en），实际 ${locs.length}`);
  for (const loc of locs) {
    const rel = new URL(loc).pathname.replace(/^\//, "");
    assert.ok(existsSync(path.join(DIST, rel)), `分片 ${rel} 应存在于 dist`);
  }
});

test("浏览端首屏数据 browse-top.json 已产出（分阶段加载第一级）", whenBuilt, () => {
  const top = JSON.parse(read(path.join("data", "browse-top.json")));
  assert.ok(top.plugins.length > 0 && top.plugins.length <= 300, "top 子集应为 1..300 条");
  assert.equal(top.count, JSON.parse(read(path.join("data", "browse-lite.json"))).count, "top.count 应等于全量 count");
  assert.ok(top.catCounts && Object.keys(top.catCounts).length > 0, "应带全语料分类计数");
  assert.ok(top.tagCounts && Object.keys(top.tagCounts).length > 0, "应带全语料标签计数");
  assert.ok(!("readme_text" in top.plugins[0]) && !("html_url" in top.plugins[0]), "首屏数据不应含 readme/html_url");
});

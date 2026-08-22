// 构建产物断言（地基票 01）：锁定"当前为真"的站点构建产物性质，作为前端修复票（12-15）的
// 验收手段与重构安全网。
//
// 机制约定（后续票在此追加断言）：
// - 每个修复票为自己的修复追加 1-2 条断言（如 12 追加 /en/ 初始化语言、13 追加 404 样式表、
//   14 分页后大幅下调分类页体积上界）。
// - 只断言外部可观察的产物内容（HTML 结构、体积、文件数），不断言实现细节。
// - 基线数字是有意的决定：语料增长导致的上调应伴随一次明确评审，而不是被动漂移。
// - dist 不存在（干净 clone / CI 测试先于构建）时整组跳过并提示，不阻塞 npm test。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");

// ---- 基线（2026-08-22 本地构建：10424 插件、20811 页） ----
const BASELINE = {
  // dist 总文件数上界：防路由/产物意外翻倍的回归。语料自然增长时有意上调。
  distFiles: 31606,
  // 最大分类单页 HTML 上界：分页后实测最大 61.5KB（150 条/页）。上界留余量到 100KB。
  maxCategoryHtmlBytes: 100_000,
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

test("构建产物断言", { skip: built ? false : "dist 不存在（先 cd site && npm run build）；干净环境跳过" }, (t) => {
  t.test("/en/ 页面 html lang=en", () => {
    const html = read(path.join("en", "index.html"));
    assert.match(html, /<html[^>]*lang="en"/, "en/index.html 的 <html> 应带 lang=\"en\"");
  });

  t.test("zh 首页 html lang=zh", () => {
    const html = read("index.html");
    assert.match(html, /<html[^>]*lang="zh"/, "index.html 的 <html> 应带 lang=\"zh\"");
  });

  t.test("404 页含样式表链接（Ticket 13）", () => {
    const html = read("404.html");
    assert.match(html, /<link[^>]+stylesheet[^>]*>/i, "404.html 应引入样式表（曾为裸 HTML）");
    assert.ok(!html.includes('rel="canonical"'), "noindex 的 404 页不应有 canonical（自相矛盾的信号）");
  });

  t.test("/en/ 页面浏览端初始化语言为 en（Ticket 12，可静态断言部分）", () => {
    // BrowseApp 的 lang 参数经打包保留在 _astro chunk 中：至少一个 chunk 以 en 初始化
    const chunks = readdirSync(path.join(DIST, "_astro")).filter((f) => f.endsWith(".js"));
    const hit = chunks.some((f) => readFileSync(path.join(DIST, "_astro", f), "utf8").includes('lang:"en"'));
    assert.ok(hit, "打包产物中应有 BrowseApp({ lang: \"en\" }) 调用（/en/ 页面初始化语言）");
  });

  t.test("分类分页产物存在（Ticket 14）：最大分类有第 2 页且含分页导航", () => {
    const p2 = path.join(DIST, "category", "tools-dev", "2", "index.html");
    assert.ok(existsSync(p2), "tools-dev（最大分类）应有第 2 页");
    const html = readFileSync(p2, "utf8");
    assert.match(html, /rel="canonical" href="[^"]*\/category\/tools-dev\/2\/"/, "第 2 页 canonical 应指向自身");
    assert.match(html, /rel="prev"/, "第 2 页应有 prev 链接");
    assert.match(html, /aria-label="分页"/, "分页导航应存在");
  });

  t.test("浏览端精简数据已产出（Ticket 15）", () => {
    const lite = path.join(DIST, "data", "browse-lite.json");
    assert.ok(existsSync(lite), "dist/data/browse-lite.json 应存在");
    const data = JSON.parse(readFileSync(lite, "utf8"));
    const sample = data.plugins[0];
    assert.ok(sample && "full_name" in sample && "description" in sample);
    assert.ok(!("html_url" in sample) && !("pushed_at" in sample) && !("readme_text" in sample), "精简版不应含 html_url/pushed_at/readme_text");
    assert.ok(Object.entries(sample).every(([k, v]) => k !== "description" || v.length <= 200), "描述应截断到 200 字符");
  });

  t.test(`分类单页 HTML 体积 ≤ ${BASELINE.maxCategoryHtmlBytes} 字节`, () => {
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

  t.test(`dist 文件数 ≤ 基线 ${BASELINE.distFiles}`, () => {
    const count = walk(DIST).length;
    assert.ok(
      count <= BASELINE.distFiles,
      `dist 文件数 ${count} 超过基线 ${BASELINE.distFiles}（期望 ≤ 基线）：若为语料自然增长，评审后有意上调基线`
    );
  });
});

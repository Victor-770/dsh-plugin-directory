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
  distFiles: 31472,
  // 最大分类单页 HTML 上界：当前 tools-dev 1.93MB（5545 插件全量单页）。票 14 分页后应大幅下调。
  maxCategoryHtmlBytes: 2_000_000,
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

  t.test("404 页存在", () => {
    assert.ok(existsSync(path.join(DIST, "404.html")), "dist/404.html 应存在");
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

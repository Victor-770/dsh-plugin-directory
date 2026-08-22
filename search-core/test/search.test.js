import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, search, expandAliases } from "../index.js";
import { FIXTURE_RECORDS } from "./fixtures.js";

const index = buildIndex(FIXTURE_RECORDS);
const names = (r) => r.ids.map((id) => index.docs[id].full_name);

test("别名展开：皮肤 -> 含 skin", () => {
  const ex = expandAliases("皮肤");
  assert.ok(ex.includes("皮肤"));
  assert.ok(ex.includes("skin"));
});
test("搜『皮肤』命中英文 README 含 skin 的插件", () => {
  const r = search(index, { q: "皮肤" });
  assert.ok(names(r).includes("skin-maker/skin-maker"));
  assert.ok(names(r).includes("ui-studio/dsh-web-ui"));
});
test("搜 search 命中中文 README 含『搜索』的插件", () => {
  const r = search(index, { q: "search" });
  assert.ok(names(r).includes("zh-team/zh-searcher"));
});
test("搜 ocr 同时命中中英描述插件", () => {
  const r = search(index, { q: "ocr" });
  assert.ok(names(r).includes("vision-lab/vision-ocr"));
});
test("搜『识别』通过别名命中 OCR 插件", () => {
  const r = search(index, { q: "识别" });
  assert.ok(names(r).includes("vision-lab/vision-ocr"));
});
test("搜『视频』命中 B站 视频插件", () => {
  const r = search(index, { q: "视频" });
  assert.ok(names(r).includes("media/bilibili-dl"));
});
test("无匹配词返回空（含常见词也 AND 拒掉）", () => {
  const r = search(index, { q: "zzz-no-such-term-zzz" });
  assert.equal(r.total, 0);
});
test("别名：搜『文件』命中英文 file 文档", () => {
  const r = search(index, { q: "文件" });
  assert.ok(names(r).includes("tool/file-organizer"));
});
test("别名：搜 file 命中中文文档", () => {
  const r = search(index, { q: "file" });
  assert.ok(names(r).includes("tool/file-organizer"));
});
test("词级 AND：skin terminal 只命中两者都有的文档", () => {
  const r = search(index, { q: "skin terminal" });
  assert.ok(names(r).includes("skin-maker/skin-maker"));   // 标题 skin + 描述 terminal
  assert.ok(!names(r).includes("readme-only/readme-only")); // 只有 skin 没有 terminal
  assert.ok(!names(r).includes("ui-studio/dsh-web-ui"));    // 只有 skin 没有 terminal
});
test("相关性排序：标题命中 > 描述命中 > README", () => {
  const r = search(index, { q: "skin" });
  // skin-maker(0) 标题含 skin(3分) > dsh-web-ui(3) 描述含 skin(2分) > readme-only(7) 仅 README 含 skin(1分)
  assert.equal(r.ids[0], 0);
  assert.ok(r.ids.indexOf(0) < r.ids.indexOf(3));
  assert.ok(r.ids.indexOf(3) < r.ids.indexOf(7));
});
test("star tiebreak：同分时 star 高者在前", () => {
  const r = search(index, { q: "ocr" });
  const ocrDoc = r.ids.filter((id) => names(r).includes("vision-lab/vision-ocr"));
  assert.ok(ocrDoc.length === 1);
});
test("sort=stars 降序", () => {
  const r = search(index, { q: "", sort: "stars" });
  const stars = r.ids.map((id) => index.docs[id].stars);
  assert.deepEqual(stars, [...stars].sort((a, b) => b - a));
  assert.equal(r.ids[0], 3); // dsh-web-ui 800 stars 最高
});
test("分类过滤 AND：搜 ocr 且限 皮肤/UI -> 无结果", () => {
  const r = search(index, { q: "ocr", categories: ["皮肤/UI"] });
  assert.equal(r.total, 0);
});
test("标签过滤 AND：搜 skin 且 tag=terminal -> 命中 skin-maker", () => {
  const r = search(index, { q: "skin", tags: ["terminal"] });
  assert.ok(names(r).includes("skin-maker/skin-maker"));
});
test("无搜索词 + 过滤 + 排序组合", () => {
  const r = search(index, { q: "", categories: ["内容/媒体"], sort: "stars" });
  assert.equal(r.total, 2);
  assert.equal(r.ids[0], 2); // vision-ocr 300 > bilibili-dl 60
});
test("limit 生效", () => {
  const r = search(index, { q: "", limit: 3 });
  assert.equal(r.ids.length, 3);
});
// ---- Ticket 08：单字中文召回 ----
test("单字召回：查『图』命中含『图片』的文档（修复前失败）", () => {
  const r = search(index, { q: "图" });
  assert.ok(names(r).includes("vision-lab/vision-ocr"), "图片识别 文档应被单字『图』命中");
});

// ---- Ticket 08：≥3 字别名键复活（覆盖匹配） ----
test("三字键：查『命令行』触发 cli（修复前死键）", () => {
  const records = [...FIXTURE_RECORDS, {
    full_name: "cli/cli-helper", description: "helper", stars: 1,
    language: "Go", pushed_at: "2026-08-01T00:00:00Z", topics: [],
    categories: ["工具/开发"], tags: [],
    readme_text: "a cli tool for your command line.",
  }];
  const idx = buildIndex(records);
  const r = search(idx, { q: "命令行" });
  assert.ok(r.ids.map((id) => idx.docs[id].full_name).includes("cli/cli-helper"));
});
test("三字键：查『浏览器』召回含 browser 的英文 README（修复前死键）", () => {
  const records = [...FIXTURE_RECORDS, {
    full_name: "web/browser-tool", description: "helper", stars: 1,
    language: "Rust", pushed_at: "2026-08-01T00:00:00Z", topics: [],
    categories: ["工具/开发"], tags: [],
    readme_text: "open links in your favorite browser.",
  }];
  const idx = buildIndex(records);
  const r = search(idx, { q: "浏览器" });
  assert.ok(r.ids.map((id) => idx.docs[id].full_name).includes("web/browser-tool"));
});
test("键覆盖不过度触发：查『命令』不触发 命令行 键的 cli", () => {
  // "命令" 只产出 bigram 命令+单字，不含 令行，键 命令行 的触发条件不满足
  const ex = expandAliases("命令");
  assert.ok(!ex.includes("cli"), `不应注入 cli：${ex.join(" ")}`);
});

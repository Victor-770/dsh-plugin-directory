import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, wordGroups, keyTriggerTokens } from "../index.js";
import { ALIASES } from "../aliases.js";

test("中文二元切词：皮肤 -> bigram + 首字 + 尾字", () => {
  assert.deepEqual(tokenize("皮肤"), ["皮肤", "皮", "肤"]);
});
test("三字中文：终端插件 -> 二元 + 首字 + 尾字", () => {
  assert.deepEqual(tokenize("终端插件"), ["终端", "端插", "插件", "终", "件"]);
});
test("单字中文：图 -> 图", () => {
  assert.deepEqual(tokenize("图"), ["图"]);
});
test("英文小写分词", () => {
  assert.deepEqual(tokenize("Hello World"), ["hello", "world"]);
});
test("混合文本", () => {
  assert.deepEqual(tokenize("DSH 插件"), ["dsh", "插件", "插", "件"]);
});
test("符号分隔", () => {
  assert.deepEqual(tokenize("a-b_c"), ["a", "b", "c"]);
});
test("空输入", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
});

// ---- Ticket 08：中文标点是词边界，不产生"汉字+标点"垃圾 token ----
test("句号切断 run：工具。皮肤 不产生含标点 token", () => {
  const toks = tokenize("工具。皮肤");
  assert.ok(!toks.some((t) => /[。，、；：！？（）]/.test(t)), `tokens: ${toks.join(" ")}`);
  assert.deepEqual(toks, ["工具", "工", "具", "皮肤", "皮", "肤"]);
});
test("全角标点同样切断：工具，皮肤", () => {
  const toks = tokenize("工具，皮肤");
  assert.ok(!toks.some((t) => t.includes("，")));
});
test("顿号分隔枚举：截图、字幕 各自成段", () => {
  assert.deepEqual(tokenize("截图、字幕"), ["截图", "截", "图", "字幕", "字", "幕"]);
});

// ---- Ticket 08：别名可达性性质测试（每个键都能被某个查询触发） ----
test("别名可达性：每个键的触发 token 都可由该键自身的查询产出", () => {
  const dead = [];
  for (const key of Object.keys(ALIASES)) {
    const triggers = keyTriggerTokens(key);
    const queryTokens = new Set(wordGroups(key).flat());
    if (!triggers.length || !triggers.every((t) => queryTokens.has(t))) dead.push(key);
  }
  assert.deepEqual(dead, [], `死键（查询永远无法触发）：${dead.join(" ")}`);
});

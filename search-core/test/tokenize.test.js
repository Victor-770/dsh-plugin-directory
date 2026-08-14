import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../index.js";

test("中文二元切词：皮肤 -> 皮肤+尾字", () => {
  assert.deepEqual(tokenize("皮肤"), ["皮肤", "肤"]);
});
test("三字中文：终端插件 -> 二元+尾字", () => {
  assert.deepEqual(tokenize("终端插件"), ["终端", "端插", "插件", "件"]);
});
test("英文小写分词", () => {
  assert.deepEqual(tokenize("Hello World"), ["hello", "world"]);
});
test("混合文本", () => {
  assert.deepEqual(tokenize("DSH 插件"), ["dsh", "插件", "件"]);
});
test("符号分隔", () => {
  assert.deepEqual(tokenize("a-b_c"), ["a", "b", "c"]);
});
test("空输入", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
});

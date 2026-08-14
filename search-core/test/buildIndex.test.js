import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, tokenize } from "../index.js";
import { FIXTURE_RECORDS } from "./fixtures.js";

const index = buildIndex(FIXTURE_RECORDS);

test("索引形状符合契约", () => {
  assert.equal(index.version, 1);
  assert.ok(typeof index.builtAt === "string");
  assert.ok(Array.isArray(index.docs));
  assert.equal(index.docs.length, FIXTURE_RECORDS.length);
  const doc = index.docs[0];
  for (const k of ["id", "full_name", "stars", "categories", "tags", "title_tokens", "desc_tokens"]) {
    assert.ok(k in doc, "missing " + k);
  }
});
test("token->id 映射：插件 出现在含该词的描述文档", () => {
  const ids = index.tokens["插件"];
  assert.ok(ids.includes(2)); // vision-ocr 描述含"插件"
  assert.ok(!ids.includes(0)); // skin-maker 无中文"插件"
});
test("token->id 映射：skin 的倒排覆盖标题与 README", () => {
  assert.ok(index.tokens["skin"].includes(0)); // skin-maker
  assert.ok(index.tokens["skin"].includes(3)); // dsh-web-ui
});
test("标题与描述 tokens 与 tokenize 一致", () => {
  assert.deepEqual(index.docs[2].title_tokens, tokenize("vision-lab/vision-ocr"));
  assert.deepEqual(index.docs[1].desc_tokens, tokenize("中文搜索工具"));
});
test("README 词进倒排索引但不在 title/desc", () => {
  // random-tool 的 README 有 'nothing'，不应出现在 title/desc
  assert.ok(index.tokens["nothing"].includes(5));
  assert.ok(!index.docs[5].title_tokens.includes("nothing"));
  assert.ok(!index.docs[5].desc_tokens.includes("nothing"));
});

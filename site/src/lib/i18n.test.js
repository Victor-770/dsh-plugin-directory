import { test } from "node:test";
import assert from "node:assert/strict";
import { STR, CATEGORY_ORDER, LANGS } from "../lib/i18n.js";

test("两种语言字典键完整且一致", () => {
  const zhKeys = Object.keys(STR.zh).sort();
  const enKeys = Object.keys(STR.en).sort();
  assert.deepEqual(zhKeys, enKeys, "zh/en 字典键必须一致");
  for (const k of zhKeys) {
    if (k === "languages") continue;
    assert.ok(STR.zh[k] !== undefined && STR.en[k] !== undefined, "missing key " + k);
  }
});
test("分类名双语覆盖全部八个分类", () => {
  for (const cat of CATEGORY_ORDER) {
    assert.ok(STR.zh.languages[cat], "zh missing category " + cat);
    assert.ok(STR.en.languages[cat], "en missing category " + cat);
  }
});
test("支持的语言列表", () => {
  assert.deepEqual(LANGS, ["zh", "en"]);
});
test("英文关键文案", () => {
  assert.equal(STR.en.sortStars, "Stars");
  assert.equal(STR.en.siteName, "DSH Plugin Directory");
  assert.ok(STR.en.noResults.length > 0);
});

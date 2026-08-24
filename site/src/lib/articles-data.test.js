import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_ARTICLES,
  getArticlesByLang,
  getArticle,
  extractHeadings,
  buildArticleJsonLd
} from "./articles-data.js";

test("文章数据层：能够正确加载中英文文章", () => {
  assert.ok(ALL_ARTICLES.length >= 2, "应包含至少两篇中英文初始文章");
  const zhArticles = getArticlesByLang("zh");
  const enArticles = getArticlesByLang("en");
  assert.ok(zhArticles.length >= 1, "应包含中文文章");
  assert.ok(enArticles.length >= 1, "应包含英文文章");
});

test("文章查询：能够通过 slug 和 lang 精准检索文章", () => {
  const article = getArticle("what-is-deepseek-harness", "en");
  assert.ok(article, "应找到旗舰英文文章");
  assert.equal(article.slug, "what-is-deepseek-harness");
  assert.equal(article.lang, "en");
  assert.ok(article.title.includes("DeepSeek Harness"));
  assert.ok(Array.isArray(article.faq) && article.faq.length > 0, "应包含 FAQ 数组");
  assert.ok(Array.isArray(article.sources) && article.sources.length > 0, "应包含 Sources 数组");
  assert.ok(Array.isArray(article.relatedPluginSlugs) && article.relatedPluginSlugs.length > 0, "应包含相关插件 Slugs");

  const vsArticleZh = getArticle("deepseek-harness-vs-claude-code-vs-codex", "zh");
  assert.ok(vsArticleZh, "应找到 PLAN-02 中文对比文章");
  assert.equal(vsArticleZh.lang, "zh");
  assert.ok(vsArticleZh.title.includes("Claude Code"));

  const vsArticleEn = getArticle("deepseek-harness-vs-claude-code-vs-codex", "en");
  assert.ok(vsArticleEn, "应找到 PLAN-02 英文对比文章");
  assert.equal(vsArticleEn.lang, "en");
  assert.ok(vsArticleEn.title.includes("Claude Code"));
});

test("TOC 提取：能够准确从 HTML 提取 H2 与 H3 目录结构", () => {
  const sampleHtml = `
    <h2 id="intro">Introduction</h2>
    <p>Some text</p>
    <h3 id="what-is">What is Harness?</h3>
    <h2 id="ecosystem">Plugin Ecosystem</h2>
  `;
  const headings = extractHeadings(sampleHtml);
  assert.equal(headings.length, 3);
  assert.deepEqual(headings[0], { id: "intro", text: "Introduction", level: 2 });
  assert.deepEqual(headings[1], { id: "what-is", text: "What is Harness?", level: 3 });
  assert.deepEqual(headings[2], { id: "ecosystem", text: "Plugin Ecosystem", level: 2 });
});

test("Schema.org 生成：复合 @graph 包含 TechArticle, BreadcrumbList 与 FAQPage", () => {
  const article = getArticle("what-is-deepseek-harness", "en");
  const jsonLd = buildArticleJsonLd({
    article,
    siteOrigin: "https://dsh-plugin-directory.online",
    canonical: "https://dsh-plugin-directory.online/en/articles/what-is-deepseek-harness/",
    lang: "en"
  });

  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.ok(Array.isArray(jsonLd["@graph"]));
  
  const techArticle = jsonLd["@graph"].find((item) => item["@type"] === "TechArticle");
  assert.ok(techArticle, "应包含 TechArticle 类型");
  assert.equal(techArticle.headline, article.title);

  const breadcrumbs = jsonLd["@graph"].find((item) => item["@type"] === "BreadcrumbList");
  assert.ok(breadcrumbs, "应包含 BreadcrumbList 类型");
  assert.equal(breadcrumbs.itemListElement.length, 3);

  const faqPage = jsonLd["@graph"].find((item) => item["@type"] === "FAQPage");
  assert.ok(faqPage, "应包含 FAQPage 类型");
  assert.equal(faqPage.mainEntity.length, article.faq.length);
});

import { articleEn as whatIsDshEn } from "./what-is-deepseek-harness-en.js";
import { articleZh as whatIsDshZh } from "./what-is-deepseek-harness-zh.js";
import { articleEn as vsClaudeEn } from "./deepseek-harness-vs-claude-code-en.js";
import { articleZh as vsClaudeZh } from "./deepseek-harness-vs-claude-code-zh.js";

export const ALL_ARTICLES = [
  whatIsDshZh,
  whatIsDshEn,
  vsClaudeZh,
  vsClaudeEn,
];

export function getArticlesByLang(lang = "zh") {
  return ALL_ARTICLES.filter((a) => a.lang === lang).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

export function getArticle(slug, lang = "zh") {
  return ALL_ARTICLES.find((a) => a.slug === slug && a.lang === lang) || null;
}

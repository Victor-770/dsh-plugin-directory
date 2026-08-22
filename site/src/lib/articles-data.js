// 文章数据聚合、TOC 提取与 Schema.org 结构化数据生成
import { ALL_ARTICLES, getArticlesByLang, getArticle } from "../data/articles/index.js";

export { ALL_ARTICLES, getArticlesByLang, getArticle };

/**
 * 从 HTML 正文中提取 H2 和 H3 作为目录
 * @param {string} html
 * @returns {Array<{ id: string, text: string, level: number }>}
 */
export function extractHeadings(html = "") {
  if (!html) return [];
  const regex = /<h([23])\s+id="([^"]+)"[^>]*>(.*?)<\/h\1>/gi;
  const headings = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    const id = match[2];
    // 清除可能包含的嵌套 HTML 标签
    const text = match[3].replace(/<[^>]*>/g, "").trim();
    headings.push({ id, text, level });
  }
  return headings;
}

/**
 * 生成全套 Schema.org 结构化数据（复合 @graph）
 * 包含 TechArticle + FAQPage + BreadcrumbList
 */
export function buildArticleJsonLd({ article, siteOrigin, canonical, lang = "zh" }) {
  const isEn = lang === "en";
  const homeUrl = siteOrigin + (isEn ? "/en/" : "/");
  const articlesUrl = siteOrigin + (isEn ? "/en/articles/" : "/articles/");
  const homeName = isEn ? "Home" : "首页";
  const articlesName = isEn ? "Articles" : "文章";

  const graph = [
    {
      "@type": "TechArticle",
      "headline": article.title,
      "description": article.pageDescription || article.description,
      "datePublished": article.publishedAt,
      "dateModified": article.updatedAt || article.publishedAt,
      "author": {
        "@type": "Organization",
        "name": article.author || "DSH Plugin Directory editorial team",
        "url": siteOrigin
      },
      "publisher": {
        "@type": "Organization",
        "name": isEn ? "DSH Plugin Directory" : "DSH 插件目录",
        "url": siteOrigin,
        "logo": {
          "@type": "ImageObject",
          "url": `${siteOrigin}/favicon.svg`
        }
      },
      "url": canonical,
      "inLanguage": lang,
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": canonical
      }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": homeName,
          "item": homeUrl
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": articlesName,
          "item": articlesUrl
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": article.title,
          "item": canonical
        }
      ]
    }
  ];

  if (article.faq && Array.isArray(article.faq) && article.faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "mainEntity": article.faq.map((item) => ({
        "@type": "Question",
        "name": item.q,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": item.a
        }
      }))
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph
  };
}

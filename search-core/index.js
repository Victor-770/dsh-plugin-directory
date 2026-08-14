// search-core：零依赖纯函数库，Node（同步管道）与 Cloudflare Worker 共用。唯一测试 seam。
import { ALIASES } from "./aliases.js";

const isCJK = (cp) =>
  (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK Unified
  (cp >= 0x3400 && cp <= 0x4dbf) ||   // Ext A
  (cp >= 0xf900 && cp <= 0xfaff) ||   // Compat
  (cp >= 0x3000 && cp <= 0x303f) ||   // CJK punct
  (cp >= 0xff00 && cp <= 0xffef);     // Fullwidth

/** 切词：CJK 二元切词 + 尾字；ASCII 小写按非字母数字切分。 */
export function tokenize(text) {
  if (!text) return [];
  const s = String(text);
  const out = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      for (const w of buf.toLowerCase().split(/[^a-z0-9]+/)) if (w) out.push(w);
      buf = "";
    }
  };
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    if (isCJK(cp)) {
      flush();
      let run = "";
      while (i < s.length && isCJK(s.codePointAt(i))) {
        run += String.fromCodePoint(s.codePointAt(i));
        i++;
      }
      const chars = [...run];
      for (let k = 0; k < chars.length - 1; k++) out.push(chars[k] + chars[k + 1]);
      out.push(chars[chars.length - 1]);
    } else {
      buf += String.fromCodePoint(cp);
      i++;
    }
  }
  flush();
  return out;
}

/** 查询按"词"分组：CJK 连续段（二元+尾字）一组，ASCII 单词一组。词级 AND、词内 OR。 */
export function wordGroups(query) {
  if (!query) return [];
  const s = String(query);
  const groups = [];
  let buf = "";
  const flush = () => { if (buf) { groups.push([buf]); buf = ""; } };
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    if (isCJK(cp)) {
      flush();
      let run = "";
      while (i < s.length && isCJK(s.codePointAt(i))) {
        run += String.fromCodePoint(s.codePointAt(i));
        i++;
      }
      const chars = [...run];
      const toks = [];
      for (let k = 0; k < chars.length - 1; k++) toks.push(chars[k] + chars[k + 1]);
      toks.push(chars[chars.length - 1]);
      groups.push(toks);
    } else if (/[a-z0-9]/i.test(String.fromCodePoint(cp))) {
      buf += String.fromCodePoint(cp).toLowerCase();
      i++;
    } else {
      flush();
      i++;
    }
  }
  flush();
  return groups;
}

/** 组内别名展开（含别名值的切词结果）。 */
function expandGroup(tokens, aliases) {
  const set = new Set(tokens);
  for (const t of tokens) {
    const v = aliases[t];
    if (v) {
      for (const a of Array.isArray(v) ? v : [v]) for (const at of tokenize(a)) set.add(at);
    }
  }
  return set;
}

/** 查询词双向别名展开（含别名值的切词结果）。 */
export function expandAliases(query, aliases = ALIASES) {
  const terms = tokenize(query);
  const expanded = new Set(terms);
  for (const t of terms) {
    const v = aliases[t];
    if (v) {
      for (const a of Array.isArray(v) ? v : [v]) for (const at of tokenize(a)) expanded.add(at);
    }
  }
  return [...expanded];
}

/** 构建倒排索引。records: PluginRecord[]。索引形状见 spec（docs 增补 stars/categories/tags 供自足过滤排序）。 */
export function buildIndex(records) {
  // Object.create(null)：防止 token 命中原型链键（如 "constructor"）导致 ||= 不建数组
  const tokens = Object.create(null);
  const docs = [];
  records.forEach((rec, id) => {
    const title_tokens = tokenize(rec.full_name);
    const desc_tokens = tokenize(rec.description || "");
    const readme_tokens = tokenize((rec.readme_text || "").slice(0, 8192));
    for (const t of new Set([...title_tokens, ...desc_tokens, ...readme_tokens])) {
      (tokens[t] ||= []).push(id);
    }
    docs.push({
      id, full_name: rec.full_name,
      stars: Number(rec.stars) || 0,
      categories: rec.categories || [],
      tags: rec.tags || [],
      title_tokens, desc_tokens,
    });
  });
  return { version: 1, builtAt: new Date().toISOString(), tokens, docs };
}

/** 搜索：查询词 OR 匹配（别名展开后），分类/标签过滤 AND。返回 {total, ids, scores}。 */
export function search(index, { q = "", categories = [], tags = [], sort = "relevance", limit = 50 } = {}) {
  // 词级 AND + 词内 OR（含别名）：每个查询词至少命中一个 token，避免常见词 OR 全命中
  const groups = q ? wordGroups(q).map((g) => expandGroup(g, ALIASES)) : [];
  const scores = new Map();
  for (const doc of index.docs) {
    if (categories.length && !categories.some((c) => doc.categories.includes(c))) continue;
    if (tags.length && !tags.some((t) => doc.tags.includes(t))) continue;
    if (groups.length) {
      let score = 0, allHit = true;
      for (const group of groups) {
        let hit = false;
        for (const t of group) {
          if (doc.title_tokens.includes(t)) { score += 3; hit = true; }
          else if (doc.desc_tokens.includes(t)) { score += 2; hit = true; }
          else if (index.tokens[t] && index.tokens[t].includes(doc.id)) { score += 1; hit = true; }
        }
        if (!hit) { allHit = false; break; }
      }
      if (!allHit) continue;
      scores.set(doc.id, score);
    } else {
      scores.set(doc.id, 0);
    }
  }
  let ids = [...scores.keys()];
  if (sort === "stars") ids.sort((a, b) => index.docs[b].stars - index.docs[a].stars);
  else ids.sort((a, b) => (scores.get(b) - scores.get(a)) || (index.docs[b].stars - index.docs[a].stars));
  const sliced = ids.slice(0, Math.max(1, Number(limit) || 50));
  return { total: ids.length, ids: sliced, scores: Object.fromEntries(sliced.map((id) => [id, scores.get(id)])) };
}
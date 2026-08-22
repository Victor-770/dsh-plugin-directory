// search-core：零依赖纯函数库，Node（同步管道）与 Cloudflare Worker 共用。唯一测试 seam。
import { ALIASES } from "./aliases.js";

// run 成员（连成一个 CJK 词段）：汉字三区 + 苏州码数字（0x3000 段唯一的"文字"）+ 全角字母数字。
const isRunChar = (cp) =>
  (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK Unified
  (cp >= 0x3400 && cp <= 0x4dbf) ||   // Ext A
  (cp >= 0xf900 && cp <= 0xfaff) ||   // Compat
  (cp >= 0x3021 && cp <= 0x3029) ||
  (cp >= 0xff10 && cp <= 0xff19) || (cp >= 0xff21 && cp <= 0xff3a) || (cp >= 0xff41 && cp <= 0xff5a);

// 词边界（切断 run、不产出任何 token）：CJK 标点（0x3000-0x303f 非文字部分）与全角标点/符号。
// 旧实现把它们当 run 成员，产生"具。"这类"汉字+标点"垃圾 bigram 入索引。
const isSeparator = (cp) =>
  (cp >= 0x3000 && cp <= 0x303f && !(cp >= 0x3021 && cp <= 0x3029)) ||
  (cp >= 0xff00 && cp <= 0xffef && !isRunChar(cp));

// CJK 词段的召回 token：二元切词 + 首尾单字（首尾字服务单字召回：查"图"命中含"图片"的文档）；
// 单字词段即自身。tokenize（索引侧）与 wordGroups（查询侧）共用——两侧的词段展开必须一致。
function runTokens(run) {
  const chars = [...run];
  const toks = [];
  for (let k = 0; k < chars.length - 1; k++) toks.push(chars[k] + chars[k + 1]);
  if (chars.length > 1) { toks.push(chars[0]); toks.push(chars[chars.length - 1]); }
  else toks.push(chars[0]);
  return toks;
}

/** 切词：CJK 二元切词 + 首字 + 尾字；ASCII 小写按非字母数字切分。 */
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
  const emitRun = (run) => { for (const t of runTokens(run)) out.push(t); };
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    if (isSeparator(cp)) {
      flush();
      i++;
    } else if (isRunChar(cp)) {
      flush();
      let run = "";
      while (i < s.length && isRunChar(s.codePointAt(i))) {
        run += String.fromCodePoint(s.codePointAt(i));
        i++;
      }
      emitRun(run);
    } else {
      buf += String.fromCodePoint(cp);
      i++;
    }
  }
  flush();
  return out;
}

/** 查询按"词"分组：CJK 连续段（二元+首尾字）一组，ASCII 单词一组。词级 AND、词内 OR。 */
export function wordGroups(query) {
  if (!query) return [];
  const s = String(query);
  const groups = [];
  let buf = "";
  const flush = () => { if (buf) { groups.push([buf]); buf = ""; } };
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    if (isRunChar(cp)) {
      flush();
      let run = "";
      while (i < s.length && isRunChar(s.codePointAt(i))) {
        run += String.fromCodePoint(s.codePointAt(i));
        i++;
      }
      groups.push(runTokens(run));
    } else if (isSeparator(cp) || !/[a-z0-9]/i.test(ch)) {
      flush();
      i++;
    } else {
      buf += ch.toLowerCase();
      i++;
    }
  }
  flush();
  return groups;
}

// ---------- 别名展开 ----------
// 别名值注入查询组时过滤单字噪声：多字 CJK 值的首/尾单字会海量命中 README（词内 OR），
// 别名承担的是"概念等价"而非单字召回，单字召回由索引侧首尾字发射负责。
function aliasValueTokens(value) {
  const out = [];
  for (const v of Array.isArray(value) ? value : [value]) {
    for (const t of tokenize(v)) {
      if (t.length === 1 && t.charCodeAt(0) > 0xff) continue;
      out.push(t);
    }
  }
  return out;
}

// 键的触发条件 token：CJK 段滑窗 bigram（不含首尾单字）+ ASCII 段单词 + 单字符段自身。
// 2 字键退化为单 bigram（= 键本身），与既有"token 精确等于键"路径一致；
// ≥3 字键与含空格键因此变得可触发（旧实现里它们是永远无法命中的死键）。
export function keyTriggerTokens(key) {
  const triggers = [];
  for (const seg of String(key).match(/[^\u0000-\u00ff]+|[\u0000-\u00ff]+/g) || []) {
    if (seg[0].charCodeAt(0) <= 0xff) {
      for (const w of seg.toLowerCase().split(/[^a-z0-9]+/)) if (w) triggers.push(w);
    } else {
      const chars = [...seg];
      if (chars.length === 1) triggers.push(chars[0]);
      else for (let k = 0; k + 1 < chars.length; k++) triggers.push(chars[k] + chars[k + 1]);
    }
  }
  return triggers;
}

// 键覆盖匹配的共用循环：键的全部触发 token 都出现在查询里（has 判定，跨组亦可，如 "skin center"）
// 时，把键值 token 经 inject 注入查询。expandQueryGroups 与 expandAliases 的差异只在成员判定与注入位置。
function applyKeyCoverage(aliases, has, inject) {
  for (const key of Object.keys(aliases)) {
    const triggers = keyTriggerTokens(key);
    if (!triggers.length || (triggers.length === 1 && triggers[0] === key)) continue; // 精确路径已覆盖
    if (!triggers.every(has)) continue;
    inject(triggers[0], aliasValueTokens(aliases[key]));
  }
}

// 查询组展开：每组的 token 精确命中别名键（含多 token 值），再做键覆盖匹配。
// 覆盖注入进首个触发 token 所在的组，保持"词内 OR、词间 AND"语义。
function expandQueryGroups(q) {
  const rawGroups = wordGroups(q);
  if (!rawGroups.length) return [];
  const expanded = rawGroups.map((g) => {
    const set = new Set(g);
    for (const t of g) {
      const v = ALIASES[t];
      if (v) for (const at of aliasValueTokens(v)) set.add(at);
    }
    return set;
  });
  const tokenToGroup = new Map();
  rawGroups.forEach((g, gi) => { for (const t of g) if (!tokenToGroup.has(t)) tokenToGroup.set(t, gi); });
  applyKeyCoverage(
    ALIASES,
    (t) => tokenToGroup.has(t),
    (first, values) => { for (const at of values) expanded[tokenToGroup.get(first)].add(at); }
  );
  return expanded;
}

/** 查询词双向别名展开（含别名值的切词结果，过滤单字噪声）。 */
export function expandAliases(query, aliases = ALIASES) {
  const terms = new Set(tokenize(query));
  for (const t of terms) {
    const v = aliases[t];
    if (v) for (const at of aliasValueTokens(v)) terms.add(at);
  }
  applyKeyCoverage(
    aliases,
    (t) => terms.has(t),
    (_first, values) => { for (const at of values) terms.add(at); }
  );
  return [...terms];
}

// ---------- 查询热路径加速（索引文件格式不变） ----------
// 倒排链按文档 id 升序（buildIndex 依 id 顺序 push），成员判断用二分查找：
// 旧 Array.includes 对千级倒排链 × 万级文档是 O(N²)，随语料线性恶化。
function postingHas(list, id) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = list[mid];
    if (v === id) return true;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

// title/desc token 的 Set 视图，按 doc 对象经 WeakMap 记忆（只在本进程内派生，不改索引产物）：
// 每查询重复构建小 Set 反而慢，记忆后命中判断 O(1)。
const docTokenSets = new WeakMap(); // doc -> { title: Set, desc: Set }
function docSets(doc) {
  let s = docTokenSets.get(doc);
  if (!s) {
    s = { title: new Set(doc.title_tokens), desc: new Set(doc.desc_tokens) };
    docTokenSets.set(doc, s);
  }
  return s;
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

// limit 归一化：显式区间 0..200。缺省/空串/NaN -> 50；负数收敛到 0（返回空集）；超上限收敛到 200。
function normalizeLimit(v) {
  if (v === null || v === undefined || v === "") return 50;
  const n = Number(v);
  if (Number.isNaN(n)) return 50;
  return Math.min(200, Math.max(0, Math.trunc(n)));
}

// 查询长度上限：core 层硬截断（Worker 层另有一道），超长查询不烧放大级 CPU。
const MAX_QUERY_CHARS = 256;

/** 搜索：查询词 OR 匹配（别名展开后），分类/标签过滤 AND。返回 {total, ids, scores}。 */
export function search(index, { q = "", categories = [], tags = [], sort = "relevance", limit = 50 } = {}) {
  q = String(q).slice(0, MAX_QUERY_CHARS);
  // 词级 AND + 词内 OR（含别名与 ≥3 字键的覆盖匹配）：每个查询词至少命中一个 token
  const groups = q ? expandQueryGroups(q) : [];
  // IDF 查询期现成可得：df = 倒排链长度（token 出现在多少文档的任一字段），索引格式不变。
  // 用平滑变体 log(1 + D/df)：df=D 的满篇词仍有微小正分（命中不被误判为未命中），
  // 区分性强的词（df 小）权重高，营销文案靠堆 dsh/plugin 刷分的老问题由此消除。
  const D = index.docs.length || 1;
  const idfCache = new Map();
  const idf = (t) => {
    let v = idfCache.get(t);
    if (v === undefined) {
      const posting = index.tokens[t];
      const df = Array.isArray(posting) ? posting.length : D; // 非数组（原型链键等）按满频退化
      v = Math.log(1 + D / Math.max(1, df));
      idfCache.set(t, v);
    }
    return v;
  };
  const scores = new Map();
  for (const doc of index.docs) {
    if (categories.length && !categories.some((c) => doc.categories.includes(c))) continue;
    if (tags.length && !tags.some((t) => doc.tags.includes(t))) continue;
    if (groups.length) {
      const sets = docSets(doc);
      let score = 0, allHit = true;
      for (const group of groups) {
        // 同义词组内取最高分而非求和：标题同时含 skin 与尾字『肤』的文档不应凭双重计分
        // 超过标题真含『皮肤』的文档
        let best = 0;
        for (const t of group) {
          let weight = sets.title.has(t) ? 3 : sets.desc.has(t) ? 2 : 0;
          if (!weight) {
            const posting = index.tokens[t];
            if (Array.isArray(posting) && postingHas(posting, doc.id)) weight = 1;
          }
          if (!weight) continue;
          const s = weight * idf(t);
          if (s > best) best = s;
        }
        if (best === 0) { allHit = false; break; }
        score += best;
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
  const sliced = ids.slice(0, normalizeLimit(limit));
  return { total: ids.length, ids: sliced, scores: Object.fromEntries(sliced.map((id) => [id, scores.get(id)])) };
}
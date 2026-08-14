// 同步管道（Ticket 01）：拉全 topic:dsh-plugin 仓库 -> README -> 分类 -> plugins.json + 契约校验。
// 用法：GITHUB_TOKEN=xxx npm run sync（无 token 也可，未认证额度内）。
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { categorize } from "./lib/categories.mjs";
import { buildIndex } from "../search-core/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "site", "public", "data"); // 站点静态资源目录：Worker 同源拉取
const TOKEN = process.env.GITHUB_TOKEN || "";
const HEADERS = { "User-Agent": "dsh-plugin-directory", Accept: "application/vnd.github+json" };
if (TOKEN) HEADERS.Authorization = `Bearer ${TOKEN}`;

const SEARCH_API = "https://api.github.com/search/repositories?q=";
const TOPIC_Q = "topic:dsh-plugin archived:false"; // 与 topic 页语义一致：排除已归档
const DATE_LO = "2008-01-01"; // GitHub 最早仓库日期
const README_CANDIDATES = [
  "README.md", "readme.md", "Readme.md", "README.MD",
  "README.en.md", "README.zh.md", "README_EN.md", "README_ZH.md",
  "README-EN.md", "README-CN.md", "README_CN.md", "readme.en.md", "readme.zh.md",
  "README.rst", "readme.rst", "README.txt", "readme.txt",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 搜索 API 限 10 次/分钟（未认证）：单页 403 限流则等 reset 重试；页间保持间隔。
async function fetchSearchPage(query, page) {
  const url = `${SEARCH_API}${encodeURIComponent(query)}&per_page=100&page=${page}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    if (res.status === 403) {
      const body = await res.text();
      if (/rate limit/i.test(body)) {
        const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
        const wait = reset > Date.now() ? reset - Date.now() + 2000 : 60000;
        console.log(`[sync] rate limited (query ${query.slice(0, 60)} page ${page}), waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1})`);
        await sleep(Math.min(wait, 120000));
        continue;
      }
      throw new Error(`GitHub search failed ${res.status}: ${body.slice(0, 300)}`);
    }
    if (!res.ok) throw new Error(`GitHub search failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json();
  }
  throw new Error("gave up after 10 rate-limit retries: " + query.slice(0, 60));
}

const MIN_INTERVAL = 6500; // 10/min 预算 -> 每页间隔 ~6.5s

// 拉取某查询下全部分页（调用方保证 total_count <= 1000）
async function fetchAllInQuery(query) {
  const all = [];
  let page = 1;
  for (;;) {
    const t0 = Date.now();
    const data = await fetchSearchPage(query, page);
    all.push(...data.items);
    if (!data.items.length || page * 100 >= data.total_count) break;
    page++;
    const elapsed = Date.now() - t0;
    if (elapsed < MIN_INTERVAL) await sleep(MIN_INTERVAL - elapsed);
  }
  return all;
}

const addDays = (iso, days) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// 分治：topic 超过搜索 API 1000 条上限时，按 created 日期二分窗口，每窗口 <=1000 再分页拉全。
async function collectRange(query, lo, hi, depth = 0) {
  const q = `${query} created:${lo}..${hi}`;
  const probe = await fetchSearchPage(q, 1);
  if (probe.total_count <= 1000) {
    const items = await fetchAllInQuery(q);
    console.log(`[sync] window ${lo}..${hi}: ${items.length} repos`);
    return items;
  }
  if (lo >= hi) throw new Error(`window not shrinkable: ${lo}..${hi} has ${probe.total_count} repos`);
  const days = Math.round((new Date(hi) - new Date(lo)) / 86400000);
  const mid = addDays(lo, Math.max(1, Math.floor(days / 2)));
  const left = await collectRange(query, lo, mid, depth + 1);
  const right = await collectRange(query, addDays(mid, 1), hi, depth + 1);
  return [...left, ...right];
}

async function fetchAllRepos() {
  const hi = new Date().toISOString().slice(0, 10);
  const items = await collectRange(TOPIC_Q, DATE_LO, hi);
  // 防御性去重（窗口按日期不相交，但保底）
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    if (!seen.has(it.full_name)) { seen.add(it.full_name); unique.push(it); }
  }
  console.log(`[sync] collected ${unique.length} unique repos (raw ${items.length})`);
  return unique;
}

async function fetchReadme(fullName) {
  const base = `https://raw.githubusercontent.com/${fullName}/HEAD/`;
  for (const name of README_CANDIDATES) {
    try {
      const res = await fetch(base + name, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return (await res.text()).slice(0, 8192);
    } catch { /* 单个候选失败继续下一个 */ }
  }
  return "";
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const REQUIRED = ["full_name", "html_url", "description", "stars", "language", "pushed_at", "topics", "categories", "tags", "readme_text"];

// 校验语义（对真实 GitHub 数据）：description/language 允许空或 null，readme_text 允许空串（仓库无 README 是合法态）。
function validate(records) {
  const errors = [];
  records.forEach((rec, i) => {
    const tag = rec.full_name || "(no full_name)";
    if (typeof rec.full_name !== "string" || !rec.full_name) errors.push(`record[${i}] ${tag}: full_name missing`);
    if (typeof rec.html_url !== "string" || !rec.html_url) errors.push(`record[${i}] ${tag}: html_url missing`);
    if (typeof rec.description !== "string") errors.push(`record[${i}] ${tag}: description must be string`);
    if (typeof rec.stars !== "number" || !Number.isFinite(rec.stars)) errors.push(`record[${i}] ${tag}: stars not a number`);
    if (rec.language !== null && typeof rec.language !== "string") errors.push(`record[${i}] ${tag}: language must be string|null`);
    if (typeof rec.pushed_at !== "string" || !rec.pushed_at) errors.push(`record[${i}] ${tag}: pushed_at missing`);
    if (!Array.isArray(rec.topics)) errors.push(`record[${i}] ${tag}: topics must be array`);
    if (!Array.isArray(rec.categories) || rec.categories.length === 0) errors.push(`record[${i}] ${tag}: categories empty`);
    if (!Array.isArray(rec.tags)) errors.push(`record[${i}] ${tag}: tags must be array`);
    if (typeof rec.readme_text !== "string") errors.push(`record[${i}] ${tag}: readme_text must be string`);
  });
  return errors;
}

async function main() {
  console.log("[sync] fetching repos (topic:dsh-plugin)...");
  const repos = await fetchAllRepos();
  console.log(`[sync] got ${repos.length} repos`);
  console.log("[sync] fetching READMEs...");
  const readmes = await mapLimit(repos, 10, (r) => fetchReadme(r.full_name));
  const records = repos.map((r, i) => {
    const { categories, tags } = categorize({
      full_name: r.full_name, description: r.description || "", topics: r.topics || [], readme_text: readmes[i],
    });
    return {
      full_name: r.full_name, html_url: r.html_url, description: r.description || "",
      stars: r.stargazers_count, language: r.language ?? null, pushed_at: r.pushed_at,
      topics: r.topics || [], categories, tags, readme_text: readmes[i],
    };
  });
  records.sort((a, b) => b.stars - a.stars);
  console.log("[sync] validating schema...");
  const errors = validate(records);
  if (errors.length) {
    console.error(`[sync] VALIDATION FAILED (${errors.length}):`);
    for (const e of errors.slice(0, 20)) console.error("  -", e);
    process.exit(1);
  }
  await mkdir(DATA_DIR, { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), count: records.length, plugins: records };
  await writeFile(path.join(DATA_DIR, "plugins.json"), JSON.stringify(payload, null, 2));
  const index = buildIndex(records);
  await writeFile(path.join(DATA_DIR, "index.json"), JSON.stringify(index));
  // 轻量浏览数据（不含 readme_text）：站点端过滤/排序用，避免 ~9MB 全量进客户端
  const browse = records.map(({ readme_text, ...meta }) => meta);
  await writeFile(path.join(DATA_DIR, "browse.json"), JSON.stringify({ generatedAt: payload.generatedAt, count: browse.length, plugins: browse }));
  console.log(`[sync] OK: plugins.json + index.json + browse.json (${records.length} plugins, ${Object.keys(index.tokens).length} tokens)`);
  const byCat = {};
  for (const rec of records) for (const c of rec.categories) byCat[c] = (byCat[c] || 0) + 1;
  console.log("[sync] categories:", JSON.stringify(byCat));
}

main().catch((e) => { console.error("[sync] FATAL:", e); process.exit(1); });
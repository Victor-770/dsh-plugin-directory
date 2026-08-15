// 同步管道（Ticket 01 + 架构升级）：双游标增量 + 定期全量对账。
// - 常规同步（默认）：pushed 增量（最近 N 天活跃）+ created 兜底（上次对账之后新增），README 有缓存。
// - 对账同步（--reconcile）：created 全窗口二分全量重扫，兜住"很久没 push 但新打 topic"的老仓库。
// 游标存 site/public/data/meta.json（workflow 的 file_pattern 是 site/public/data/*.json，会随数据一起提交，
// 保证 CI 全新 checkout 后仍能读到上次对账时间与同步计数，增量逻辑在 CI 里持续生效）。
// 用法：GITHUB_TOKEN=xxx npm run sync [-- --reconcile]
// 说明：搜索 API 未认证 10 次/分钟，认证 30 次/分钟；脚本按认证与否自适应限速。
import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { categorize } from "./lib/categories.mjs";
import { buildIndex } from "../search-core/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "site", "public", "data"); // 站点静态资源目录：Worker 同源拉取
const PUBLIC_DIR = path.dirname(DATA_DIR); // site/public：IndexNow key 文件所在
const SITE_ORIGIN = "https://dsh-plugin-directory.online"; // canonical 域名（与 astro.config / sitemap 一致）
const TOKEN = process.env.GITHUB_TOKEN || "";
const HEADERS = { "User-Agent": "dsh-plugin-directory", Accept: "application/vnd.github+json" };
if (TOKEN) HEADERS.Authorization = `Bearer ${TOKEN}`;

const SEARCH_API = "https://api.github.com/search/repositories?q=";
const TOPIC_Q = "topic:dsh-plugin archived:false"; // 与 topic 页语义一致：排除已归档
const DATE_LO = "2008-01-01"; // GitHub 最早仓库日期
// 常规增量窗口：只扫最近多少天"活跃"（pushed 在窗口内）的仓库。活跃集规模稳定，不随历史总量增长。
const INCREMENTAL_DAYS = 7;
// 每次对账后，下一次对账前的"新增兜底窗口"：created 在此之后的新仓库（即使 push 很久前也会被 created 兜住）。
const RECONCILE_GAP_DAYS = 40;
// 对账周期：每 N 次常规同步做一次全量对账（每 6h cron，N=6 -> 每 36h 一次全量）。
const RECONCILE_EVERY = 6;
// README 候选文件名（保持与原实现一致）
const README_CANDIDATES = [
  "README.md", "readme.md", "Readme.md", "README.MD",
  "README.en.md", "README.zh.md", "README_EN.md", "README_ZH.md",
  "README-EN.md", "README-CN.md", "README_CN.md", "readme.en.md", "readme.zh.md",
  "README.rst", "readme.rst", "README.txt", "readme.txt",
];

const META_FILE = path.join(DATA_DIR, "meta.json"); // { lastReconcileAt: "YYYY-MM-DD"|null, syncCount: number }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 限速预算：认证 30/min，未认证 10/min。所有搜索请求按时间槽排队，天然满足每分钟配额。
const RATE_PER_MIN = TOKEN ? 30 : 10;
const REQUEST_INTERVAL = 60000 / RATE_PER_MIN;
let nextRequestAt = 0;
function throttleSearch() {
  // 时间槽限速：每次调用预留一个槽位，并发调用会自动排开；无 Promise 链，不会累积内存。
  const now = Date.now();
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt + REQUEST_INTERVAL);
  if (wait) return sleep(wait);
  return Promise.resolve();
}

// 搜索 API 单查询上限 1000 条（10 页 × 100）。二分窗口必须保证 total_count <= 1000。
async function fetchSearchPage(query, page) {
  await throttleSearch();
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

// 拉取某查询下全部分页（调用方保证 total_count <= 1000；firstPage 复用二分探针的第一页，省一次请求）
async function fetchAllInQuery(query, firstPage) {
  const all = [];
  if (firstPage && Array.isArray(firstPage.items)) all.push(...firstPage.items);
  let page = 2;
  for (;;) {
    const data = await fetchSearchPage(query, page);
    all.push(...data.items);
    if (!data.items.length || page * 100 >= data.total_count) break;
    page++;
  }
  return all;
}

const addDays = (iso, days) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// 时间戳解析：lo/hi 形如 "YYYY-MM-DD"（日粒度）或 "YYYY-MM-DDTHH:00:00Z"（小时粒度）。
const isDay = (s) => s.length === 10;
const parseTs = (s) => (isDay(s) ? new Date(s + "T00:00:00Z") : new Date(s));
const fmtHour = (day, h) => `${day}T${String(h).padStart(2, "0")}:00:00Z`;

// 二分窗口：返回 [left, right] 两个 {lo, hi}，或 null（单小时窗口，无法再分）。
// 两个子窗口互斥且都严格小于父窗口（杜绝同参递归），跨天按天二分，同一天降级到小时粒度。
// 小时区间按半开 [loHour, hiHourExclusive) 理解：上界为 T{h}:00:00Z 表示覆盖到 h 点前，
// 上界为 T23:59:59Z（等价 24 点）表示覆盖整点 23。这样任何子窗口都非零宽、严格更小。
function splitWindow(lo, hi) {
  const loDay = lo.slice(0, 10), hiDay = hi.slice(0, 10);
  const daySpan = Math.round((parseTs(hiDay) - parseTs(loDay)) / 86400000);
  if (daySpan > 0) {
    // 跨天：按天对半（[lo..mid] + [mid+1..hi]）。daySpan=1 时切成两个单日，不会复现父窗口。
    const mid = addDays(loDay, Math.floor(daySpan / 2));
    return [
      { lo: loDay, hi: mid },
      { lo: addDays(mid, 1), hi: hiDay },
    ];
  }
  // 同一天：小时粒度。lo/hi 可能是日期（当日 00:00..23:59）或已是时间戳。
  const day = loDay;
  const loHour = isDay(lo) ? 0 : Number(lo.slice(11, 13));
  const hiHourExclusive = isDay(hi) || hi.endsWith("T23:59:59Z") ? 24 : Number(hi.slice(11, 13));
  const span = hiHourExclusive - loHour;
  if (span <= 1) return null; // 单小时窗口，无法再分（极端防御）
  const midHour = loHour + Math.floor(span / 2);
  return [
    { lo: fmtHour(day, loHour), hi: fmtHour(day, midHour) },
    { lo: fmtHour(day, midHour), hi: hiHourExclusive >= 24 ? `${day}T23:59:59Z` : fmtHour(day, hiHourExclusive) },
  ];
}

// 二分收集：窗口内 total_count >1000 则分裂（先按天，同日降小时），直到 <=1000 再分页拉全。
// 左右子树并行（实际请求仍经串行闸门排队，限速配额不变）；depth 防御性封顶，杜绝同参死递归。
async function collectRange(query, lo, hi, depth = 0) {
  if (depth > 64) throw new Error(`collectRange depth exceeded at ${lo}..${hi}`);
  const q = `${query} created:${lo}..${hi}`;
  const probe = await fetchSearchPage(q, 1);
  if (probe.total_count <= 1000) {
    const items = await fetchAllInQuery(q, probe);
    console.log(`[sync] window ${lo}..${hi}: ${items.length} repos`);
    return items;
  }
  const parts = splitWindow(lo, hi);
  if (!parts) throw new Error(`window not shrinkable even at hour granularity: ${lo}..${hi} has ${probe.total_count} repos`);
  const [left, right] = await Promise.all([
    collectRange(query, parts[0].lo, parts[0].hi, depth + 1),
    collectRange(query, parts[1].lo, parts[1].hi, depth + 1),
  ]);
  return [...left, ...right];
}

// 全量对账：created 全窗口（2008..今天）二分，兜住所有老仓库。
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

// 常规增量：pushed 增量（最近 N 天活跃）+ created 兜底（上次对账之后新增）。
// 注意：created 兜底下限 = 上次对账时间 - 缓冲，避免对账刚结束时新仓库被漏。
async function fetchIncrementalRepos(lastReconcileAt) {
  const hi = new Date().toISOString().slice(0, 10);
  const loActive = addDays(hi, -INCREMENTAL_DAYS);
  const loCreated = lastReconcileAt ? addDays(lastReconcileAt, -RECONCILE_GAP_DAYS) : DATE_LO;
  console.log(`[sync] incremental: pushed >= ${loActive} (last ${INCREMENTAL_DAYS}d), created >= ${loCreated} (reconcile gap)`);
  const [active, created] = await Promise.all([
    collectRange(`${TOPIC_Q} pushed:>=${loActive}`, DATE_LO, hi),
    collectRange(TOPIC_Q, loCreated, hi),
  ]);
  // 合并去重（pushed 与 created 窗口可能重叠）
  const seen = new Set();
  const unique = [];
  for (const it of [...active, ...created]) {
    if (!seen.has(it.full_name)) { seen.add(it.full_name); unique.push(it); }
  }
  console.log(`[sync] incremental: ${active.length} active + ${created.length} created = ${unique.length} unique`);
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

// 游标：meta.json（随数据提交，CI 全新 checkout 后仍可读）。
async function readMeta() {
  try {
    const raw = JSON.parse(await readFile(META_FILE, "utf8"));
    return {
      lastReconcileAt: typeof raw.lastReconcileAt === "string" ? raw.lastReconcileAt.slice(0, 10) : null,
      syncCount: Number(raw.syncCount) || 0,
    };
  } catch {
    return { lastReconcileAt: null, syncCount: 0 };
  }
}
async function writeMeta(meta) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(META_FILE, JSON.stringify(meta), "utf8");
}

// 读取上次数据文件，构造 full_name -> record 的 Map（供 README 缓存与 diff）
async function readPreviousRecords() {
  const file = path.join(DATA_DIR, "plugins.json");
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(raw.plugins) ? raw.plugins : [];
  } catch {
    return [];
  }
}

// 增量时 README 缓存：只有 pushed_at 变化（内容真更新）或新仓库才重抓；否则复用上次的 readme_text。
// 返回 { records, readmesFetched }。readmesFetched 仅用于日志。
async function fetchRecords({ reconcile, meta, prevMap }) {
  const repos = reconcile ? await fetchAllRepos() : await fetchIncrementalRepos(meta.lastReconcileAt);
  let readmeHits = 0, readmeMisses = 0;
  const readmes = await mapLimit(repos, 10, async (r) => {
    const prev = prevMap.get(r.full_name);
    const pushedChanged = !prev || prev.pushed_at !== r.pushed_at;
    if (!reconcile && prev && !pushedChanged) {
      // 未变化：复用缓存
      readmeHits++;
      return prev.readme_text || "";
    }
    readmeMisses++;
    return await fetchReadme(r.full_name);
  });
  console.log(`[sync] README cache: ${readmeHits} reused, ${readmeMisses} fetched`);
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
  return records;
}

// 增量合并：保留上次未变化的仓库 + 本次增量仓库，按 full_name 去重，pushed_at 新者胜。
function mergeRecords(prev, incr) {
  const map = new Map();
  for (const r of prev) map.set(r.full_name, r);
  for (const r of incr) {
    const old = map.get(r.full_name);
    if (!old || (old.pushed_at || "") <= (r.pushed_at || "")) map.set(r.full_name, r);
  }
  return [...map.values()].sort((a, b) => b.stars - a.stars);
}

// 站点 URL 构造（与 sitemap.xml.ts 保持一致：zh 在根路径，en 在 /en/ 前缀）
function pluginUrl(fullName) {
  return `${SITE_ORIGIN}/plugin/${fullName}/`;
}
function pluginEnUrl(fullName) {
  return `${SITE_ORIGIN}/en/plugin/${fullName}/`;
}

// 对比新旧记录：pushed_at / stars / description 任一变化即视为"更新"（内容已变，值得通知）
function diffChangedUrls(prev, next) {
  const prevMap = new Map(prev.map((p) => [p.full_name, p]));
  const changed = [];
  for (const rec of next) {
    const old = prevMap.get(rec.full_name);
    if (!old) { changed.push(rec); continue; } // 新增
    if (
      old.pushed_at !== rec.pushed_at ||
      old.stars !== rec.stars ||
      (old.description || "") !== (rec.description || "")
    ) changed.push(rec); // 更新
  }
  return changed;
}

// 向 IndexNow 端点提交 URL（POST JSON；失败重试 2 次）
async function notifyIndexNow(urls) {
  const key = await findIndexNowKey();
  if (!key) throw new Error("no IndexNow key file found in site/public/");
  const body = { host: SITE_ORIGIN.replace(/^https?:\/\//, ""), key, keyLocation: `${SITE_ORIGIN}/${key}.txt`, urlList: urls };
  const endpoint = process.env.INDEXNOW_ENDPOINT || "https://api.indexnow.org/indexnow";
  console.log(`[indexnow] notifying ${urls.length} URLs (${changedSummary(urls)})`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "dsh-plugin-directory" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) { console.log(`[indexnow] OK (${res.status})`); return; }
    // 200/202 之外的错误：可能限流，稍等重试
    const text = await res.text().catch(() => "");
    if (attempt < 2) {
      console.warn(`[indexnow] attempt ${attempt + 1} failed (${res.status} ${text.slice(0, 120)}), retrying...`);
      await sleep(5000 * (attempt + 1));
    } else {
      throw new Error(`IndexNow returned ${res.status}: ${text.slice(0, 200)}`);
    }
  }
}

// 在 site/public/ 下寻找 <key>.txt（与 sitemap 里 robots.txt 的 Sitemap 声明一致）
async function findIndexNowKey() {
  const entries = await readdir(PUBLIC_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && /^[0-9a-f]{32}\.txt$/i.test(e.name)) return e.name.replace(/\.txt$/i, "");
  }
  // 兼容：显式环境变量指定（无 key 文件时）
  return process.env.INDEXNOW_KEY || "";
}

function changedSummary(urls) {
  const hasEn = urls.some((u) => u.includes("/en/plugin/"));
  const count = urls.length / 2;
  return `~${count} plugins, ${count * 2} URLs (zh+en)`;
}

// 主流程：决定本次是对账还是增量，取数 -> 合并 -> 校验 -> IndexNow -> 写数据 -> 更新游标。
async function main() {
  const reconcile = process.argv.includes("--reconcile");
  const meta = await readMeta();
  // 对账周期：--reconcile 强制；无游标（首次）强制；否则 syncCount 每到 RECONCILE_EVERY 触发一次。
  // 注意：对账后 syncCount 归零，必须用 syncCount>0 排除"刚对账完的下一次"，否则会每次都全量对账。
  const doReconcile = reconcile || meta.lastReconcileAt === null || (meta.syncCount > 0 && meta.syncCount % RECONCILE_EVERY === 0);
  if (doReconcile) console.log(`[sync] mode: RECONCILE (full created scan)`);
  else console.log(`[sync] mode: incremental (pushed ${INCREMENTAL_DAYS}d + created gap)`);

  const prev = await readPreviousRecords();
  const prevMap = new Map(prev.map((p) => [p.full_name, p]));

  const records = await fetchRecords({ reconcile: doReconcile, meta, prevMap });

  // 合并：对账时用本次全量覆盖；增量时与上次合并（保留未变化仓库）。
  let finalRecords;
  if (doReconcile) {
    finalRecords = records;
  } else {
    finalRecords = mergeRecords(prev, records);
    console.log(`[sync] merged: ${prev.length} prev + ${records.length} incremental = ${finalRecords.length} total`);
  }

  console.log("[sync] validating schema...");
  const errors = validate(finalRecords);
  if (errors.length) {
    console.error(`[sync] VALIDATION FAILED (${errors.length}):`);
    for (const e of errors.slice(0, 20)) console.error("  -", e);
    process.exit(1);
  }

  // --- IndexNow 通知（Bing 指南 §4）：对比上次数据，只提交新增/更新/删除的 URL ---
  try {
    const changed = diffChangedUrls(prev, finalRecords);
    const deleted = prev.filter((p) => !finalRecords.some((r) => r.full_name === p.full_name));
    const urls = [
      ...changed.flatMap((p) => [pluginUrl(p.full_name), pluginEnUrl(p.full_name)]),
      ...deleted.flatMap((p) => [pluginUrl(p.full_name), pluginEnUrl(p.full_name)]),
    ];
    if (urls.length) {
      await notifyIndexNow(urls);
    } else {
      console.log("[indexnow] no URL changes since last sync; skipping");
    }
  } catch (e) {
    // 通知失败不应让数据同步失败：仅告警，不中断
    console.warn(`[indexnow] skipped due to error: ${e.message}`);
  }

  await mkdir(DATA_DIR, { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), count: finalRecords.length, plugins: finalRecords };
  await writeFile(path.join(DATA_DIR, "plugins.json"), JSON.stringify(payload, null, 2));
  const index = buildIndex(finalRecords);
  await writeFile(path.join(DATA_DIR, "index.json"), JSON.stringify(index));
  // 轻量浏览数据（不含 readme_text）：站点端过滤/排序用，避免 ~9MB 全量进客户端
  const browse = finalRecords.map(({ readme_text, ...meta }) => meta);
  await writeFile(path.join(DATA_DIR, "browse.json"), JSON.stringify({ generatedAt: payload.generatedAt, count: browse.length, plugins: browse }));

  // 更新游标：对账后 syncCount 归零并记录对账时间；增量则累加。
  if (doReconcile) {
    meta.lastReconcileAt = new Date().toISOString().slice(0, 10);
    meta.syncCount = 0;
  } else {
    meta.syncCount += 1;
  }
  await writeMeta(meta);

  console.log(`[sync] OK: plugins.json + index.json + browse.json (${finalRecords.length} plugins, ${Object.keys(index.tokens).length} tokens)`);
  const byCat = {};
  for (const rec of finalRecords) for (const c of rec.categories) byCat[c] = (byCat[c] || 0) + 1;
  console.log("[sync] categories:", JSON.stringify(byCat));
}

main().catch((e) => { console.error("[sync] FATAL:", e); process.exit(1); });

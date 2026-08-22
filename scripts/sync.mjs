// 同步管道（Ticket 01 + 架构升级）：双游标增量 + 定期全量对账。
// - 常规同步（默认）：pushed 增量（最近 N 天活跃）+ created 兜底（上次对账之后新增），README 有缓存。
// - 对账同步（--reconcile）：created 全窗口二分全量重扫，兜住"很久没 push 但新打 topic"的老仓库。
// 游标存 site/public/data/meta.json（workflow 的 file_pattern 是 site/public/data 整目录，会随数据一起提交，
// 保证 CI 全新 checkout 后仍能读到上次对账时间，增量逻辑在 CI 里持续生效）。
// 用法：GITHUB_TOKEN=xxx npm run sync [-- --reconcile]
// 说明：搜索 API 未认证 10 次/分钟，认证 30 次/分钟；脚本按认证与否自适应限速。
import { writeFile, mkdir, readdir, readFile, rm, rename } from "node:fs/promises";
import { gzipSync } from "node:zlib";
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
// 对账周期：距上次对账超过该小时数即全量对账（每 6h cron，36h -> 约每 6 轮一次）。
// 用 lastReconcileAt 时间差而非运行计数：计数器每轮 +1 会让 meta.json 每次同步都产生
// 心跳 commit，触发 Pages 全量重建；时间差只在对账成功那天变化。
const RECONCILE_EVERY_HOURS = 36;
const hoursSince = (day) => (Date.now() - Date.parse(day + "T00:00:00Z")) / 3600000;
// README 候选文件名（保持与原实现一致）
const README_CANDIDATES = [
  "README.md", "readme.md", "Readme.md", "README.MD",
  "README.en.md", "README.zh.md", "README_EN.md", "README_ZH.md",
  "README-EN.md", "README-CN.md", "README_CN.md", "readme.en.md", "readme.zh.md",
  "README.rst", "readme.rst", "README.txt", "readme.txt",
];

const META_FILE = path.join(DATA_DIR, "meta.json"); // { lastReconcileAt: "YYYY-MM-DD"|null }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 原子写盘：同目录临时文件 + rename——磁盘满/中途崩溃只可能留下完整旧文件或完整新文件，
// 不会出现半份 JSON 被下一轮 readPreviousRecords 解析失败或被 CI 提交部署。
async function writeFileAtomic(filePath, data) {
  const tmp = filePath + ".tmp";
  await writeFile(tmp, data);
  await rename(tmp, filePath);
}

// 限速预算：认证 30/min，未认证 10/min。所有搜索请求按时间槽排队，天然满足每分钟配额。
const RATE_PER_MIN = TOKEN ? 30 : 10;
const REQUEST_INTERVAL = 60000 / RATE_PER_MIN;
let nextRequestAt = 0;
function throttleSearch() {
  // 时间槽限速：本请求占据 slot = max(now, nextRequestAt)，并把后续槽位推到 slot+间隔。
  // 等待目标是"自己的槽起点"而非旧 nextRequestAt，否则会与已占用该槽的请求同毫秒并发。
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + REQUEST_INTERVAL;
  const wait = slot - now;
  if (wait) return sleep(wait);
  return Promise.resolve();
}

// ---------- 瞬时故障重试矩阵 ----------
// 可重试：网络异常（DNS/连接重置/超时中断，fetch 抛 TypeError）、429、403 限流与滥用检测文案、5xx（网关超时等）。
// 退避：指数（1s/2s/4s/...，封顶 30s）；429 与滥用检测优先尊重 retry-after 头；403 限流等到配额重置。
// 每次尝试（含重试）都重新经过 throttleSearch 限速闸门，重试不产生突发请求。
// 不可重试：其余 4xx（查询本身有问题，重试无意义）。
const TRANSIENT_MAX = 5;
const QUOTA_MAX = 10; // 配额类等待次数单独计：等重置窗口是确定性恢复，多等几轮也值得
const backoffMs = (attempt) => Math.min(1000 * 2 ** (attempt - 1), 30000);
function retryAfterMs(res) {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v) * 1000;
  const date = Date.parse(v);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

// 搜索 API 单查询上限 1000 条（10 页 × 100）。二分窗口必须保证 total_count <= 1000。
async function fetchSearchPage(query, page) {
  const url = `${SEARCH_API}${encodeURIComponent(query)}&per_page=100&page=${page}`;
  const tag = `query ${query.slice(0, 60)} page ${page}`;
  let transientRetries = 0, quotaRetries = 0;
  for (;;) {
    await throttleSearch();
    let res;
    try {
      res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      if (++transientRetries > TRANSIENT_MAX) throw new Error(`GitHub search network error after ${TRANSIENT_MAX} retries (${tag}): ${e.message}`);
      const wait = backoffMs(transientRetries);
      console.log(`[sync] network error (${e.message}), retry ${transientRetries}/${TRANSIENT_MAX} in ${wait}ms (${tag})`);
      await sleep(wait);
      continue;
    }
    if (res.ok) return await res.json();
    const body = await res.text().catch(() => "");
    if (res.status === 403 && /rate limit/i.test(body)) {
      if (++quotaRetries > QUOTA_MAX) throw new Error(`GitHub search still rate limited after ${QUOTA_MAX} waits (${tag})`);
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
      const wait = Math.min(reset > Date.now() ? reset - Date.now() + 2000 : 60000, 120000);
      console.log(`[sync] rate limited, waiting ${Math.round(wait / 1000)}s (retry ${quotaRetries}/${QUOTA_MAX}) (${tag})`);
      await sleep(wait);
      continue;
    }
    const transient = res.status === 429 || res.status >= 500 || (res.status === 403 && /abuse/i.test(body));
    if (transient) {
      if (++transientRetries > TRANSIENT_MAX) throw new Error(`GitHub search failed ${res.status} after ${TRANSIENT_MAX} retries (${tag}): ${body.slice(0, 200)}`);
      const wait = res.status === 429 || /abuse/i.test(body)
        ? (retryAfterMs(res) ?? backoffMs(transientRetries) * 3)
        : backoffMs(transientRetries);
      console.log(`[sync] transient ${res.status}, retry ${transientRetries}/${TRANSIENT_MAX} in ${Math.round(wait / 1000)}s (${tag})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`GitHub search failed ${res.status}: ${body.slice(0, 300)}`);
  }
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

// README 拉取：区分"确认无 README"（候选全部 404，合法空串）与"传输失败"（网络异常/5xx）。
// 返回 { text, failed }；failed 由调用方计数，批量失败（如 raw.githubusercontent 全网故障）
// 超过阈值时中止同步，避免全量空 README 被当成"更新"写进数据。
async function fetchReadmeChecked(fullName) {
  const base = `https://raw.githubusercontent.com/${fullName}/HEAD/`;
  let transportErrors = 0;
  for (const name of README_CANDIDATES) {
    try {
      const res = await fetch(base + name, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return { text: (await res.text()).slice(0, 8192), failed: false };
      if (res.status >= 500) transportErrors++;
      // 404 等继续下一个候选名
    } catch { transportErrors++; /* 单个候选传输失败继续下一个 */ }
  }
  return { text: "", failed: transportErrors > 0 };
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

// 游标：meta.json（随数据提交，CI 全新 checkout 后仍可读）。日期字段非法（非 YYYY-MM-DD 或不可解析）
// 一律视为空：坏值会拼出非法 created:>= 查询串让同步 422 硬失败。
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDayOrNone(v) {
  if (typeof v !== "string") return null;
  const day = v.slice(0, 10);
  return ISO_DAY.test(day) && !Number.isNaN(Date.parse(day + "T00:00:00Z")) ? day : null;
}
async function readMeta() {
  try {
    const raw = JSON.parse(await readFile(META_FILE, "utf8"));
    return { lastReconcileAt: validDayOrNone(raw.lastReconcileAt) };
  } catch {
    return { lastReconcileAt: null };
  }
}
async function writeMeta(meta) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFileAtomic(META_FILE, JSON.stringify(meta));
}

// 读取上次数据文件，构造 full_name -> record 的 Map（供 README 缓存与 diff）。
// 新布局：data/plugins/manifest.json + 分片；兼容迁移前遗留的 plugins.json。
async function readPreviousRecords() {
  const shardDir = path.join(DATA_DIR, "plugins");
  try {
    const manifest = JSON.parse(await readFile(path.join(shardDir, "manifest.json"), "utf8"));
    const out = [];
    for (const name of manifest.shards || []) {
      const shard = JSON.parse(await readFile(path.join(shardDir, name), "utf8"));
      if (Array.isArray(shard.plugins)) out.push(...shard.plugins);
    }
    return out;
  } catch {
    try {
      const raw = JSON.parse(await readFile(path.join(DATA_DIR, "plugins.json"), "utf8"));
      return Array.isArray(raw.plugins) ? raw.plugins : [];
    } catch {
      return [];
    }
  }
}

// 增量时 README 缓存：只有 pushed_at 变化（内容真更新）或新仓库才重抓；否则复用上次的 readme_text。
// 对账同样复用：对账只是"全量扫一遍 created 窗口"，pushed_at 未变的仓库 README 不该重抓
// （旧实现对账必全量重抓 4461+ 仓库 × 最多 17 个候选文件名）。
// 返回 { records, readmeStats }。传输失败率超阈值时抛错中止（见 fetchReadmeChecked 注释）。
const README_FAILURE_FATAL_RATIO = 0.05;
async function fetchRecords({ reconcile, meta, prevMap }) {
  const repos = reconcile ? await fetchAllRepos() : await fetchIncrementalRepos(meta.lastReconcileAt);
  let readmeHits = 0, readmeMisses = 0, readmeFailures = 0;
  const readmes = await mapLimit(repos, 10, async (r) => {
    const prev = prevMap.get(r.full_name);
    const pushedChanged = !prev || prev.pushed_at !== r.pushed_at;
    if (prev && !pushedChanged) {
      // 未变化：复用缓存（增量与对账同权）
      readmeHits++;
      return prev.readme_text || "";
    }
    readmeMisses++;
    const { text, failed } = await fetchReadmeChecked(r.full_name);
    if (failed) readmeFailures++;
    return text;
  });
  const failPct = readmeMisses ? (readmeFailures / readmeMisses) * 100 : 0;
  console.log(`[sync] README cache: ${readmeHits} reused, ${readmeMisses} fetched, ${readmeFailures} transport failures (${failPct.toFixed(1)}%)`);
  if (readmeFailures >= 3 && readmeFailures / readmeMisses > README_FAILURE_FATAL_RATIO) {
    // 醒目告警并中止：继续写盘会把网络故障变成"全量 README 清空"提交。
    // 绝对下限 3 次：1-2 个仓库的偶发失败只告警不中止（重试兜底在下一轮同步）。
    console.error(`[sync] !!! README transport failure rate ${failPct.toFixed(1)}% exceeds ${README_FAILURE_FATAL_RATIO * 100}% threshold (${readmeFailures}/${readmeMisses})`);
    console.error(`[sync] !!! Suspected raw.githubusercontent.com outage; aborting to avoid committing empty READMEs.`);
    throw new Error(`README transport failures above threshold: ${readmeFailures}/${readmeMisses}`);
  } else if (readmeFailures > 0) {
    console.warn(`[sync] WARNING: ${readmeFailures}/${readmeMisses} README fetches hit transport errors; affected repos keep stale/empty text this round`);
  }
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

// 向 IndexNow 端点提交 URL（POST JSON；失败重试 2 次）。
// 按 ≤8000 条/批分批（API 单次上限 10000，留余量；INDEXNOW_BATCH 可覆盖，测试用）。
const INDEXNOW_BATCH = Number(process.env.INDEXNOW_BATCH) || 8000;
async function notifyIndexNow(urls) {
  const key = await findIndexNowKey();
  if (!key) throw new Error("no IndexNow key file found in site/public/");
  const endpoint = process.env.INDEXNOW_ENDPOINT || "https://api.indexnow.org/indexnow";
  for (let i = 0; i < urls.length; i += INDEXNOW_BATCH) {
    const batch = urls.slice(i, i + INDEXNOW_BATCH);
    const body = { host: SITE_ORIGIN.replace(/^https?:\/\//, ""), key, keyLocation: `${SITE_ORIGIN}/${key}.txt`, urlList: batch };
    console.log(`[indexnow] notifying ${batch.length} URLs (${changedSummary(batch)})`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "dsh-plugin-directory" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) { console.log(`[indexnow] OK (${res.status})`); break; }
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

// ---------- 墓碑（对账删除保护） ----------
// GitHub Search 分页会漂移（窗口结果不完整）。对账扫描缺席的仓库不立即删除，而是计数；
// 连续 N 次对账缺席才真删并通知 IndexNow——缺席期间数据原样保留，漂移不再变成误删。
const TOMBSTONE_FILE = path.join(DATA_DIR, "tombstones.json"); // { full_name: 连续缺席次数 }
const TOMBSTONE_THRESHOLD = Number(process.env.DSH_TOMBSTONE_THRESHOLD) || 3;
async function readTombstones() {
  try {
    const raw = JSON.parse(await readFile(TOMBSTONE_FILE, "utf8"));
    return raw && typeof raw === "object" ? new Map(Object.entries(raw).map(([k, v]) => [k, Number(v) || 0])) : new Map();
  } catch {
    return new Map();
  }
}
async function writeTombstones(map) {
  if (!map.size) { await rm(TOMBSTONE_FILE, { force: true }); return; } // 清空即删文件，不留空壳
  await writeFileAtomic(TOMBSTONE_FILE, JSON.stringify(Object.fromEntries(map)));
}

// 主流程：决定本次是对账还是增量，取数 -> 合并 -> 校验 -> 写数据 -> IndexNow 通知 -> 更新游标。
async function main() {
  const reconcile = process.argv.includes("--reconcile");
  const meta = await readMeta();
  // 对账时机：--reconcile 强制；无游标（首次）强制；距上次对账超过 RECONCILE_EVERY_HOURS 则到期。
  const doReconcile = reconcile || meta.lastReconcileAt === null || hoursSince(meta.lastReconcileAt) >= RECONCILE_EVERY_HOURS;
  if (doReconcile) console.log(`[sync] mode: RECONCILE (full created scan)`);
  else console.log(`[sync] mode: incremental (pushed ${INCREMENTAL_DAYS}d + created gap)`);

  const prev = await readPreviousRecords();
  const prevMap = new Map(prev.map((p) => [p.full_name, p]));

  const records = await fetchRecords({ reconcile: doReconcile, meta, prevMap });

  // 合并：
  // - 对账：扫描结果与旧数据 merge（非整体替换）；缺席仓库走墓碑——连续 N 次缺席才真删。
  // - 增量：与上次合并（保留未变化仓库）。
  let finalRecords;
  let tombstones = null;
  let tombstonesChanged = false;
  if (doReconcile) {
    tombstones = await readTombstones();
    const nextSet = new Set(records.map((r) => r.full_name));
    const retained = [];
    let reallyDeleted = 0;
    for (const p of prev) {
      if (nextSet.has(p.full_name)) {
        if (tombstones.delete(p.full_name)) tombstonesChanged = true; // 回归即清零
        continue;
      }
      const count = (tombstones.get(p.full_name) || 0) + 1;
      if (count >= TOMBSTONE_THRESHOLD) {
        reallyDeleted++;
        tombstones.delete(p.full_name);
        tombstonesChanged = true;
      } else {
        tombstones.set(p.full_name, count);
        tombstonesChanged = true;
        retained.push(p); // 缺席未达阈值：数据保留
      }
    }
    finalRecords = mergeRecords(retained, records);
    console.log(`[sync] reconcile merge: ${records.length} scanned + ${retained.length} retained-absent = ${finalRecords.length} total (${reallyDeleted} really deleted, ${tombstones.size} pending tombstones)`);
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

  // 数据无实质变化：跳过全部数据写盘（含 generatedAt 刷新）——不产生 commit、不触发 Pages 重建。
  // 墓碑推进是唯一例外状态：只写 tombstones.json 与游标（否则缺席计数无法跨轮累积），
  // 数据文件仍不动。无差异 URL 且无真删，IndexNow 无可通知。
  if (JSON.stringify(prev) === JSON.stringify(finalRecords)) {
    console.log(`[sync] no substantive data change${tombstonesChanged ? " (tombstones advanced)" : ""}; skipping data write`);
    if (doReconcile) {
      meta.lastReconcileAt = new Date().toISOString().slice(0, 10);
      await writeMeta(meta);
    }
    if (tombstones && tombstonesChanged) await writeTombstones(tombstones);
    return;
  }

  // --- IndexNow 通知移到数据写盘成功之后（见下方）：先发布后通知，写失败/中止零通知 ---

  await mkdir(DATA_DIR, { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), count: finalRecords.length, plugins: finalRecords };

  // plugins 分片：单文件曾达 28.8MiB，超出 Cloudflare Pages 25MiB/文件上限。
  // 按 SHARD_SIZE 个/片写入 data/plugins/NNN.json + manifest.json；Worker 与站点构建按 manifest 拉取全部切片。
  // 写序保证崩溃安全：先写全部分片，manifest 最后原子换入（manifest 引用的名字始终对应完整文件）。
  const shardDir = path.join(DATA_DIR, "plugins");
  await mkdir(shardDir, { recursive: true });
  const SHARD_SIZE = 400;
  const shardNames = [];
  for (let i = 0; i < finalRecords.length; i += SHARD_SIZE) {
    const chunk = finalRecords.slice(i, i + SHARD_SIZE);
    const name = String(i / SHARD_SIZE).padStart(3, "0") + ".json";
    await writeFileAtomic(path.join(shardDir, name), JSON.stringify({ generatedAt: payload.generatedAt, count: chunk.length, plugins: chunk }, null, 2));
    shardNames.push(name);
  }
  // 分片数收缩时清理 manifest 未引用的旧分片（如 12 片 -> 11 片时 011.json 不残留成死重）
  const referenced = new Set(shardNames);
  for (const f of await readdir(shardDir)) {
    if (/^\d+\.json$/.test(f) && !referenced.has(f)) await rm(path.join(shardDir, f));
  }
  await writeFileAtomic(path.join(shardDir, "manifest.json"), JSON.stringify({ generatedAt: payload.generatedAt, count: finalRecords.length, shards: shardNames }));
  // 移除旧单文件，避免遗留超限文件再次进入部署
  await rm(path.join(DATA_DIR, "plugins.json"), { force: true });

  // 搜索索引 gzip 压缩：index.json 已达 17.8MiB 且随仓库数增长，逼近 25MiB 上限。
  // 压缩后仅 Worker 消费（DecompressionStream 解压；gzip 在 Node 与 workerd 都支持，brotli 仅 workerd）。
  const index = buildIndex(finalRecords);
  await writeFileAtomic(path.join(DATA_DIR, "index.json.gz"), gzipSync(JSON.stringify(index)));
  await rm(path.join(DATA_DIR, "index.json"), { force: true });

  // 轻量浏览数据（不含 readme_text）：站点端过滤/排序用，避免 ~9MB 全量进客户端
  const browse = finalRecords.map(({ readme_text, ...meta }) => meta);
  await writeFileAtomic(path.join(DATA_DIR, "browse.json"), JSON.stringify({ generatedAt: payload.generatedAt, count: browse.length, plugins: browse }));

  // 更新游标：只有对账推进 lastReconcileAt；增量轮不写 meta（内容无变化，避免无意义重写）。
  if (doReconcile) {
    meta.lastReconcileAt = new Date().toISOString().slice(0, 10);
    await writeMeta(meta);
  }
  // 墓碑落盘（对账轮）：数据不变也要持久化缺席计数，否则计数无法跨轮累积
  if (doReconcile && tombstones && tombstonesChanged) {
    await writeTombstones(tombstones);
  }

  // --- IndexNow 通知（Bing 指南 §4）：数据写盘成功之后才发出（先发布后通知）。
  // 只提交新增/更新/真删的 URL；删除只来自墓碑决议——分页漂移的"假缺席"不通知。 ---
  try {
    const changed = diffChangedUrls(prev, finalRecords);
    // 删除检测：Set 一遍扫描（旧写法 prev × finalRecords 双重 filter 是 O(n²)）
    const finalSet = new Set(finalRecords.map((r) => r.full_name));
    const deleted = prev.filter((p) => !finalSet.has(p.full_name));
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

  console.log(`[sync] OK: plugins/ ${shardNames.length} shards + index.json.gz + browse.json (${finalRecords.length} plugins, ${Object.keys(index.tokens).length} tokens)`);
  const byCat = {};
  for (const rec of finalRecords) for (const c of rec.categories) byCat[c] = (byCat[c] || 0) + 1;
  console.log("[sync] categories:", JSON.stringify(byCat));
}

main().catch((e) => { console.error("[sync] FATAL:", e); process.exit(1); });

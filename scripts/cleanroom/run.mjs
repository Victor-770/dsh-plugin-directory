// 洁净室故障演练入口（Ticket 04 验收）：把 scripts/ + search-core/ 复制进临时沙箱，
// 播种"上次数据"（3 未变化 + 3 已变化 + 1 净新增的场景），再以 fetch-shim 预加载运行 sync，
// 注入脚本化故障并断言结果。不接入 npm test（按 spec 的测试决策走人工/CI 外演练）。
// 用法：node scripts/cleanroom/run.mjs
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { seedPrevRecords } from "./github-fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..", "..");
const TOKEN = "cleanroom-token"; // 任意非空值：让限速按认证 30/min（2s/槽）走，断言才有确定间距

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function makeSandbox() {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "dsh-cleanroom-"));
  await cp(path.join(REPO, "scripts"), path.join(sandbox, "scripts"), { recursive: true });
  await cp(path.join(REPO, "search-core"), path.join(sandbox, "search-core"), { recursive: true });
  await cp(path.join(REPO, "shared"), path.join(sandbox, "shared"), { recursive: true }); // sync.mjs 依赖 shared/site-origin.js
  return sandbox;
}

// 播种上次数据：plugins/ 分片 + meta（昨天对账 -> 距今 <36h，本轮走增量模式）。
// 同时清掉上一场景可能遗留的墓碑，保证场景隔离。
async function seedPrevState(sandbox) {
  const dataDir = path.join(sandbox, "site", "public", "data");
  const shardDir = path.join(dataDir, "plugins");
  await mkdir(shardDir, { recursive: true });
  await rm(path.join(dataDir, "tombstones.json"), { force: true });
  const prev = seedPrevRecords();
  await writeFile(path.join(shardDir, "000.json"), JSON.stringify({ generatedAt: "2026-01-01T00:00:00Z", count: prev.length, plugins: prev }, null, 2));
  await writeFile(path.join(shardDir, "manifest.json"), JSON.stringify({ generatedAt: "2026-01-01T00:00:00Z", count: prev.length, shards: ["000.json"] }));
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await writeFile(path.join(dataDir, "meta.json"), JSON.stringify({ lastReconcileAt: yesterday }));
}

function runSync(sandbox, scenario, extraEnv = {}, args = []) {
  const reqLog = path.join(sandbox, "reqlog.jsonl");
  rmSync(reqLog, { force: true }); // 每个场景独立日志，避免跨场景间距假数据
  const res = spawnSync(process.execPath, [
    "--import", pathToFileURL(path.join(sandbox, "scripts", "cleanroom", "fetch-shim.mjs")).href,
    path.join(sandbox, "scripts", "sync.mjs"),
    ...args,
  ], {
    cwd: sandbox,
    encoding: "utf8",
    timeout: 120000,
    env: {
      ...process.env,
      GITHUB_TOKEN: TOKEN,
      INDEXNOW_KEY: "0123456789abcdef0123456789abcdef",
      CLEANROOM_SCENARIO: JSON.stringify(scenario),
      CLEANROOM_REQLOG: reqLog,
      ...extraEnv,
    },
  });
  const log = existsSync(reqLog) ? readFile(reqLog, "utf8").then((t) => t.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))) : [];
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "", logPromise: log };
}

async function readManifestCount(sandbox) {
  const m = JSON.parse(await readFile(path.join(sandbox, "site", "public", "data", "plugins", "manifest.json"), "utf8"));
  return m.count;
}

const scenarios = [
  {
    name: "steady（无故障基线）",
    scenario: {},
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 0", code === 0, stderr.slice(-300));
      check("增量模式", /mode: incremental/.test(stdout));
      check("README 缓存 3 复用 4 重抓", /README cache: 3 reused, 4 fetched, 0 transport failures/.test(stdout), stdout.match(/README cache:.*/)?.[0]);
      check("合并后 7 条", await readManifestCount(sandbox) === 7);
      check("IndexNow 已通知", /\[indexnow\] OK/.test(stdout));
      check("无 .tmp 残留", await noTmpLeftovers(sandbox));
      check("全部数据 JSON 可解析", await allJsonParse(sandbox));
    },
  },
  {
    name: "shard-shrink（分片收缩清理旧分片）",
    scenario: {},
    async setup(sandbox) {
      // 预置一个 manifest 未引用的旧分片（模拟 12->11 片收缩后的残留），同步后应被清理
      await writeFile(path.join(sandbox, "site", "public", "data", "plugins", "099.json"), JSON.stringify({ generatedAt: "2020-01-01T00:00:00Z", count: 1, plugins: [] }));
    },
    async verify(sandbox, { code, stdout, stderr }, log) {
      const stale = path.join(sandbox, "site", "public", "data", "plugins", "099.json");
      check("exit 0", code === 0, stderr.slice(-300));
      check("旧分片已清理", !existsSync(stale));
      check("manifest 只引用 000.json", JSON.parse(await readFile(path.join(sandbox, "site", "public", "data", "plugins", "manifest.json"), "utf8")).shards.join(",") === "000.json");
    },
  },
  {
    name: "reconcile-readme-cache（对账复用 README 缓存）",
    scenario: {},
    async setup(sandbox) {
      // 3 天前对账 -> 超过 36h，本轮强制全量对账
      const old = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      await writeFile(path.join(sandbox, "site", "public", "data", "meta.json"), JSON.stringify({ lastReconcileAt: old }));
    },
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 0", code === 0, stderr.slice(-300));
      check("走对账模式", /mode: RECONCILE/.test(stdout));
      check("对账复用 README 缓存（3 复用 4 重抓）", /README cache: 3 reused, 4 fetched, 0 transport failures/.test(stdout), stdout.match(/README cache:.*/)?.[0]);
      // 未变化仓库（a/b/c）零 raw 请求
      const rawForUnchanged = log.filter((l) => l.host === "raw.githubusercontent.com" && /\/(a|b|c)\//.test(l.path));
      check("未变化仓库零 README 重抓请求", rawForUnchanged.length === 0, `${rawForUnchanged.length} requests`);
      check("对账 merge 保留全部 7 条", await readManifestCount(sandbox) === 7);
    },
  },
  {
    name: "pagination-drift（对账窗口不完整不误删）",
    scenario: { searchOmit: ["a/unchanged-cli", "d/changed-search"] },
    async setup(sandbox) {
      // 先跑一轮无故障同步，让 prev 与夹具完全同步（否则 e/f/g 的正常变化会掩盖"数据零变化"路径）
      await runSync(sandbox, {});
      const old = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      await writeFile(path.join(sandbox, "site", "public", "data", "meta.json"), JSON.stringify({ lastReconcileAt: old }));
    },
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 0", code === 0, stderr.slice(-300));
      check("数据保留（仍是 7 条，缺席仓库未删）", await readManifestCount(sandbox) === 7);
      check("墓碑已记录（2 个缺席仓库各计 1 次）", (await tombstoneCount(sandbox)).size === 2, JSON.stringify(await readFile(path.join(sandbox, "site", "public", "data", "tombstones.json"), "utf8").catch(() => "none")));
      const notified = indexNowUrls(log).flat();
      check("无错误删除通知（缺席仓库 URL 不在通知里）", !notified.some((u) => u.includes("a/unchanged-cli") || u.includes("d/changed-search")), notified.filter((u) => u.includes("unchanged") || u.includes("changed-search")).join(" "));
      check("数据文件未重写（零 generatedAt 空转）", /no substantive data change \(tombstones advanced\)/.test(stdout));
    },
  },
  {
    name: "tombstone-exhaustion（连续缺席达阈值才真删）",
    scenario: { searchOmit: ["a/unchanged-cli"] },
    async setup(sandbox) {
      // 先跑一轮无故障同步让 a 进入数据；此后连续缺席对账观察墓碑决议
      await runSync(sandbox, {});
      const old = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      await writeFile(path.join(sandbox, "site", "public", "data", "meta.json"), JSON.stringify({ lastReconcileAt: old }));
    },
    env: { DSH_TOMBSTONE_THRESHOLD: "2" },
    async verify(sandbox, first, log) {
      // 本轮（loop 触发）= 第一次缺席对账：记墓碑、数据保留
      check("第一轮 exit 0", first.code === 0, first.stderr.slice(-300));
      check("第一轮缺席仅记墓碑（数据保留 7 条）", (await readManifestCount(sandbox)) === 7 && /retained-absent/.test(first.stdout));
      check("墓碑计数 = 1", (await tombstoneCount(sandbox)).get("a/unchanged-cli") === 1);
      // 第二次缺席对账（阈值 2，强制 --reconcile：上一轮已把游标推到今天）：真删 + 删除通知
      const second = runSync(sandbox, this.scenario, this.env, ["--reconcile"]);
      const log2 = await second.logPromise;
      check("第二轮 exit 0", second.code === 0, second.stderr.slice(-300));
      check("连续缺席达阈值后真删（6 条）", (await readManifestCount(sandbox)) === 6);
      const notified = indexNowUrls(log2).flat();
      check("删除通知包含 a 的 URL", notified.some((u) => u.includes("a/unchanged-cli")), notified.join(" "));
    },
  },
  {
    name: "indexnow-batch（超上限分批 + 写盘后通知）",
    scenario: {},
    env: { INDEXNOW_BATCH: "4" },
    async verify(sandbox, { code, stdout, stderr }, log) {
      const posts = log.filter((l) => l.host === "api.indexnow.org");
      const mtimeMs = statSync(path.join(sandbox, "site", "public", "data", "plugins", "manifest.json")).mtimeMs;
      check("exit 0", code === 0, stderr.slice(-300));
      // 4 个变化插件 × zh+en = 8 条 URL，按 4/批分 2 次提交
      check("8 条 URL 按 4/批分成 2 次提交", posts.length === 2, `${posts.length} posts: ${posts.map((p) => p.urls.length).join(",")}`);
      check("所有提交在数据写盘之后（先发布后通知）", posts.every((p) => p.t >= mtimeMs - 50), `manifest mtime ${mtimeMs}, posts ${posts.map((p) => p.t).join(",")}`);
    },
  },
  {
    name: "meta-bad-date（游标日期非法视为空 -> 全量对账）",
    scenario: {},
    async setup(sandbox) {
      // 播种非法日期：不得拼出坏查询串 422，而是当作无游标走对账
      await writeFile(path.join(sandbox, "site", "public", "data", "meta.json"), JSON.stringify({ lastReconcileAt: "not-a-date" }));
    },
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 0", code === 0, stderr.slice(-300));
      check("走对账模式", /mode: RECONCILE/.test(stdout));
      check("游标被修复为合法日期", await validMetaDate(sandbox), await readFile(path.join(sandbox, "site", "public", "data", "meta.json"), "utf8"));
    },
  },
  {
    name: "netx1（搜索网络中断一次后恢复）",
    scenario: { searchFaults: [{ count: 1, type: "network" }] },
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 0", code === 0, stderr.slice(-300));
      check("走了重试日志", /network error.*retry 1\/5/.test(stdout));
      check("数据完整（7 条）", await readManifestCount(sandbox) === 7);
      check("重试重新过限速闸门（相邻搜索请求间距≥1.9s）", minGap(log) >= 1900, `min gap ${minGap(log)}ms`);
    },
  },
  {
    name: "504x2（网关超时连续两次后恢复）",
    scenario: { searchFaults: [{ count: 2, type: "504" }] },
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 0", code === 0, stderr.slice(-300));
      // 两次 504 分摊在并行的两个窗口探针上，各自重试一次后恢复
      check("两次 504 重试日志", (stdout.match(/transient 504.*retry 1\/5/g) || []).length === 2);
      check("数据完整（7 条）", await readManifestCount(sandbox) === 7);
    },
  },
  {
    name: "rate429（429 尊重 retry-after）",
    scenario: { searchFaults: [{ count: 1, type: "429", retryAfterSeconds: 10 }] },
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 0", code === 0, stderr.slice(-300));
      // 故障请求自己的重试必须等满 retry-after=10s；仅靠闸门（4 个请求、2s/槽）最多排到 6s
      check("重试等待采用 retry-after（日志 in 10s）", /transient 429, retry 1\/5 in 10s/.test(stdout));
      const span = spanAfterLastStatus(log, 429);
      check("时间线：429 后仍有 ≥9.5s 的搜索请求（重试未提前）", span !== null && span >= 9500, `span ${span}ms`);
    },
  },
  {
    name: "abuse403（二级限流文案走重试）",
    scenario: { searchFaults: [{ count: 1, type: "abuse403" }] },
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 0", code === 0, stderr.slice(-300));
      check("403 滥用检测重试日志", /transient 403.*retry 1\/5/.test(stdout));
      check("数据完整（7 条）", await readManifestCount(sandbox) === 7);
    },
  },
  {
    name: "readme-outage（raw 全网故障 -> 中止不写盘）",
    scenario: { readmeFaults: [{ count: 999, type: "network" }] },
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 1（中止）", code === 1);
      check("醒目告警", /README transport failure rate.*exceeds/.test(stderr) && /aborting to avoid committing empty READMEs/.test(stderr));
      check("未写盘（仍是播种的 6 条）", await readManifestCount(sandbox) === 6);
    },
  },
  {
    name: "readme-single（单仓库 README 故障 -> 告警不中止）",
    scenario: { readmeFaults: [{ count: 17, type: "network", match: "d/changed-search" }] },
    async verify(sandbox, { code, stdout, stderr }, log) {
      check("exit 0", code === 0, stderr.slice(-300));
      check("失败计数与告警", /README cache: 3 reused, 4 fetched, 1 transport failures \(25\.0%\)/.test(stdout), stdout.match(/README cache:.*/)?.[0]);
      check("WARNING 行", /WARNING: 1\/4 README fetches/.test(stderr));
    },
  },
];

// 相邻 api.github.com 请求（含失败尝试）的最小间距
function minGap(log) {
  const ts = log.filter((l) => l.host === "api.github.com").map((l) => l.t);
  let min = Infinity;
  for (let i = 1; i < ts.length; i++) min = Math.min(min, ts[i] - ts[i - 1]);
  return min === Infinity ? null : min;
}

// ---- 数据目录卫生断言（Ticket 06） ----
async function walkFiles(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkFiles(p, out);
    else out.push(p);
  }
  return out;
}
async function noTmpLeftovers(sandbox) {
  const files = await walkFiles(path.join(sandbox, "site", "public", "data"));
  return !files.some((f) => f.endsWith(".tmp"));
}
async function allJsonParse(sandbox) {
  const files = (await walkFiles(path.join(sandbox, "site", "public", "data"))).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try { JSON.parse(await readFile(f, "utf8")); } catch { return false; }
  }
  return true;
}
async function validMetaDate(sandbox) {
  try {
    const meta = JSON.parse(await readFile(path.join(sandbox, "site", "public", "data", "meta.json"), "utf8"));
    return typeof meta.lastReconcileAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.lastReconcileAt);
  } catch { return false; }
}
// 墓碑表：full_name -> 连续缺席次数
async function tombstoneCount(sandbox) {
  try {
    return new Map(Object.entries(JSON.parse(await readFile(path.join(sandbox, "site", "public", "data", "tombstones.json"), "utf8"))));
  } catch { return new Map(); }
}
// IndexNow 各次提交的 URL 列表
function indexNowUrls(log) {
  return log.filter((l) => l.host === "api.indexnow.org" && Array.isArray(l.urls)).map((l) => l.urls);
}
// 最后一条该状态记录与整个运行中最后一条搜索请求的时间差（重试是否被推迟的最晚证据）
function spanAfterLastStatus(log, status) {
  const entries = log.filter((l) => l.host === "api.github.com").slice().sort((a, b) => a.t - b.t);
  const faultT = entries.filter((l) => l.status === status).pop()?.t;
  if (faultT === undefined || !entries.length) return null;
  return entries[entries.length - 1].t - faultT;
}

const sandbox = await makeSandbox();
try {
  for (const s of scenarios) {
    console.log(`\n=== ${s.name} ===`);
    await seedPrevState(sandbox);
    if (s.setup) await s.setup(sandbox);
    const result = runSync(sandbox, s.scenario, s.env);
    const log = await result.logPromise;
    await s.verify(sandbox, result, log);
  }

  // 两阶段场景：第一轮正常写盘，第二轮数据零变化 -> 跳过全部写盘（零 commit 内容）
  console.log(`\n=== nochange（数据零变化 -> 零写盘零提交内容） ===`);
  await seedPrevState(sandbox);
  const run1 = runSync(sandbox, {});
  await run1.logPromise;
  const dataFile = (p) => readFile(path.join(sandbox, "site", "public", "data", p), "utf8");
  const m1 = await dataFile("plugins/manifest.json");
  const meta1 = await dataFile("meta.json");
  const run2 = runSync(sandbox, {});
  await run2.logPromise;
  check("第二轮 exit 0", run2.code === 0, run2.stderr.slice(-300));
  check("跳过写盘日志", /no substantive data change; skipping data write/.test(run2.stdout));
  check("manifest 字节不变（数据文件零改动）", m1 === await dataFile("plugins/manifest.json"));
  check("meta.json 不变（增量轮不写游标）", meta1 === await dataFile("meta.json"));
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
console.log(`\n${failures === 0 ? "ALL SCENARIOS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);

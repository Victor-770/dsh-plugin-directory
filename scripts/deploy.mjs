// 一键部署（Worker）：站点构建门禁 -> 全量测试 -> wrangler 部署 Worker -> git 状态提醒。
// 用法：npm run deploy [-- --worker-only]（跳过站点构建，只测试 + 部署 Worker）
//
// 静态站（Pages）不在本脚本范围：本项目 Pages 为 git-connected，push 触发云端构建；
// wrangler pages deploy 不适用于 git-connected 项目。本地构建在此作为门禁——
// dist 产物断言（文件数 ≤ Pages 20k 上限等）在 npm test 里跑，必须先构建出新鲜 dist。
// 顺序即门禁：build（产出 dist）-> test（断言新鲜 dist）-> deploy。
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
const flags = new Set(process.argv.slice(2));
const skipBuild = flags.has("--worker-only") || flags.has("--skip-build");

function run(label, cmd, args, { cwd = ROOT } = {}) {
  console.log(`\n[deploy] ${label}\n          ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: IS_WIN });
  if (r.status !== 0) {
    console.error(`\n[deploy] ✗ ${label} 失败（exit ${r.status}）——部署中止`);
    process.exit(r.status ?? 1);
  }
}

if (!skipBuild) {
  run("站点构建（与 Pages 云端构建同款命令；产物断言的前置门）", "npm", ["run", "build"], { cwd: path.join(ROOT, "site") });
}
run("全量测试（构建后运行：dist 断言验证新鲜产物，含 20k 文件上限）", "npm", ["test"]);
run("部署 Worker", "npx", ["wrangler", "deploy"], { cwd: path.join(ROOT, "worker") });

const st = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8", shell: IS_WIN });
const dirty = (st.stdout || "").trim();
console.log("\n[deploy] Worker 部署完成。");
if (dirty) {
  console.log("[deploy] ⚠ 工作树有未提交改动：Pages 静态站只在 commit + push 后自动重建。");
  console.log("        Worker 已用本地代码生效；要让新数据布局（plugins-meta.json.gz 等）随站点上线，请提交并推送。");
} else {
  console.log("[deploy] 工作树干净；若本地领先远端，push 后 Pages 自动重建。");
}

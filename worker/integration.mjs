// 全链路集成测试（真实生产代码）：站点 /api/search -> 真实 Pages Function -> Worker(HTTP) -> data
// 用法：node worker/integration.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.js";
import { onRequestGet } from "../functions/api/search.js"; // 真实 Pages Function 代码

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "site", "public", "data");

// 层1：数据静态服务（模拟 Pages 的 /data/*）
const dataServer = http.createServer(async (req, res) => {
  const name = req.url === "/data/plugins.json" ? "plugins.json" : req.url === "/data/index.json" ? "index.json" : null;
  if (!name) { res.writeHead(404); res.end(); return; }
  try {
    const buf = await readFile(path.join(dataDir, name));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(buf);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => dataServer.listen(0, "127.0.0.1", r));
const dataOrigin = `http://127.0.0.1:${dataServer.address().port}`;
const workerEnv = { SITE_ORIGIN: dataOrigin };

// 层2：Worker 作为 HTTP 服务（等价于已部署的 Worker 端点）
const workerServer = http.createServer((req, res) => {
  worker.fetch(new Request(`http://127.0.0.1${req.url}`, { headers: { referer: dataOrigin } }), workerEnv)
    .then(async (up) => {
      res.writeHead(up.status, { "content-type": "application/json" });
      res.end(await up.text());
    })
    .catch((e) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); });
});
await new Promise((r) => workerServer.listen(0, "127.0.0.1", r));
const workerOrigin = `http://127.0.0.1:${workerServer.address().port}`;

// 层3：真实 Pages Function（context 模拟）
const callViaFunction = (path) =>
  onRequestGet({ request: new Request("http://site.pages.dev" + path), env: { WORKER_URL: workerOrigin } });

const cases = [
  ["q=皮肤（别名→skin）", "/api/search?q=%E7%9A%AE%E8%82%A4&limit=3"],
  ["q=terminal（别名→终端）", "/api/search?q=terminal&limit=3"],
  ["cat=终端/TUI", "/api/search?cat=%E7%BB%88%E7%AB%AF%2FTUI&limit=3"],
  ["sort=stars", "/api/search?sort=stars&limit=3"],
  ["q=ocr + cat=内容/媒体", "/api/search?q=ocr&cat=%E5%86%85%E5%AE%B9%2F%E5%AA%92%E4%BD%93&limit=3"],
  ["q=不存在词", "/api/search?q=zzzz-no-such-zzzz&limit=3"],
  ["Worker 未配置（无 WORKER_URL）", "/api/search?q=皮肤&limit=3"],
];
const t0 = Date.now();
let pass = 0;
for (const [label, path] of cases) {
  const isUnconfigured = label.includes("未配置");
  const res = isUnconfigured
    ? await onRequestGet({ request: new Request("http://site.pages.dev" + path), env: {} })
    : await callViaFunction(path);
  const j = await res.json();
  const ok = isUnconfigured
    ? res.status === 500 && j.error && j.error.includes("WORKER_URL")
    : res.status === 200 && typeof j.total === "number" && Array.isArray(j.results);
  if (ok) pass++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label} -> status=${res.status} total=${j.total} top=${(j.results || []).slice(0, 2).map((p) => p.full_name).join(", ")}`);
}
const ms = Date.now() - t0;
console.log(`integration: ${pass}/${cases.length} passed, ${ms}ms total`);
dataServer.close(); workerServer.close();
process.exit(pass === cases.length ? 0 : 1);

// 全链路集成测试（本地模拟生产路径）：站点 /api/search -> Pages Function 代理 -> Worker -> data
// 用法：node worker/integration.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.js";

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
const dataPort = dataServer.address().port;
const workerEnv = { SITE_ORIGIN: `http://127.0.0.1:${dataPort}` };
const workerBase = `http://127.0.0.1:${dataPort + 1}`;

// 层2：Worker（直接调 default.fetch，等价于已部署）
// 层3：Pages Function 代理（复刻 functions/api/search.js 的 onRequestGet 逻辑）
const proxy = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/api/search") { res.writeHead(404); res.end(); return; }
  const upstream = await worker.fetch(
    new Request(workerBase + "/api/search" + url.search, { headers: { referer: "http://127.0.0.1:8080" } }),
    workerEnv
  );
  const body = await upstream.text();
  res.writeHead(upstream.status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const proxyPort = proxy.address().port;

const cases = [
  ["q=皮肤（别名→skin）", "/api/search?q=%E7%9A%AE%E8%82%A4&limit=3"],
  ["q=terminal（别名→终端）", "/api/search?q=terminal&limit=3"],
  ["cat=终端/TUI", "/api/search?cat=%E7%BB%88%E7%AB%AF%2FTUI&limit=3"],
  ["sort=stars", "/api/search?sort=stars&limit=3"],
  ["q=ocr + cat=内容/媒体", "/api/search?q=ocr&cat=%E5%86%85%E5%AE%B9%2F%E5%AA%92%E4%BD%93&limit=3"],
  ["q=不存在词", "/api/search?q=zzzz-no-such-zzzz&limit=3"],
];
const t0 = Date.now();
let pass = 0;
for (const [label, path] of cases) {
  const res = await fetch(`http://127.0.0.1:${proxyPort}${path}`);
  const j = await res.json();
  const ok = res.status === 200 && typeof j.total === "number" && Array.isArray(j.results);
  if (ok) pass++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label} -> total=${j.total} top=${(j.results || []).slice(0, 2).map((p) => p.full_name).join(", ")}`);
}
const ms = Date.now() - t0;
console.log(`integration: ${pass}/${cases.length} passed, ${ms}ms total (incl. cold start)`);
dataServer.close(); proxy.close();
process.exit(pass === cases.length ? 0 : 1);

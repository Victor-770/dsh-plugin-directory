// 搜索延迟基准：node worker/bench.mjs [queries]
// 通过真实 Pages Function + Worker + data 链路测量，报告 p50/p95/p99/max。
import http from "node:http";
import worker from "./src/index.js";
import { onRequestGet } from "../functions/api/search.js";
import { startDataServer } from "./lib/data-server.mjs";

const N = Number(process.argv[2]) || 30;

const { server: dataServer, origin: dataOrigin } = await startDataServer();
const workerServer = http.createServer((req, res) => {
  worker.fetch(new Request(`http://127.0.0.1${req.url}`, { headers: { referer: dataOrigin } }), { SITE_ORIGIN: dataOrigin })
    .then(async (up) => { res.writeHead(up.status, { "content-type": "application/json" }); res.end(await up.text()); })
    .catch((e) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); });
});
await new Promise((r) => workerServer.listen(0, "127.0.0.1", r));
const workerOrigin = `http://127.0.0.1:${workerServer.address().port}`;

const queries = ["皮肤", "ocr", "bilibili", "翻译", "tui", "terminal", "微信", "search", "皮肤+cat=皮肤/UI", "zzz-no-such"];
const timings = [];
for (let i = 0; i < N; i++) {
  const q = queries[i % queries.length];
  const path = q.includes("+") ? `/api/search?q=${encodeURIComponent(q.split("+")[0])}&cat=${encodeURIComponent(q.split("+")[1].split("=")[1])}` : `/api/search?q=${encodeURIComponent(q)}&limit=10`;
  const t0 = performance.now();
  const res = await onRequestGet({ request: new Request("http://site.pages.dev" + path), env: { WORKER_URL: workerOrigin } });
  await res.json();
  timings.push(performance.now() - t0);
}
const sorted = [...timings].sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
console.log(`queries=${N}  p50=${pct(0.5).toFixed(1)}ms  p95=${pct(0.95).toFixed(1)}ms  p99=${pct(0.99).toFixed(1)}ms  max=${sorted[sorted.length - 1].toFixed(1)}ms`);
console.log(`spec 目标: P95 < 300ms -> ${pct(0.95) < 300 ? "达标 ✓" : "未达标 ✗"}`);
dataServer.close(); workerServer.close();

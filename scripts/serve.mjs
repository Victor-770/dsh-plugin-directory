// 一键本地全功能体验：node scripts/serve.mjs
// 静态站 + /api/search（真实 Pages Function -> Worker -> data），无需部署任何东西。
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/src/index.js";
import { onRequestGet } from "../functions/api/search.js";
import { startDataServer } from "../worker/lib/data-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "site", "dist");
const PORT = Number(process.env.PORT) || 4321;

// 数据服务（Worker 同源拉取，共享 worker/lib/data-server.mjs）
const { server: dataServer, origin: dataOrigin } = await startDataServer();

// Worker 端点
const workerServer = http.createServer((req, res) => {
  worker.fetch(new Request(`http://127.0.0.1${req.url}`, { headers: { referer: dataOrigin } }), { SITE_ORIGIN: dataOrigin })
    .then(async (up) => { res.writeHead(up.status, { "content-type": "application/json" }); res.end(await up.text()); })
    .catch((e) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); });
});
await new Promise((r) => workerServer.listen(0, "127.0.0.1", r));
const workerOrigin = `http://127.0.0.1:${workerServer.address().port}`;

// MIME 对齐 Pages 实际行为：曾缺 .ico/.webmanifest/.xml/.gz（本地预览 favicon 被当
// 二进制流、manifest 解析失败，与线上表现不一致难排查）
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".xml": "application/xml; charset=utf-8", ".gz": "application/gzip" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/search") {
    try {
      const up = await onRequestGet({ request: new Request("http://127.0.0.1:" + PORT + url.pathname + url.search, { headers: req.headers }), env: { WORKER_URL: workerOrigin } });
      const body = await up.text();
      res.writeHead(up.status, { "content-type": "application/json; charset=utf-8" });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }
  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  const file = path.join(distDir, rel);
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error("not file");
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`DSH Plugin Directory 本地全功能版: http://127.0.0.1:${PORT}`);
  console.log(`试试搜索：http://127.0.0.1:${PORT}/?q=%E7%9A%AE%E8%82%A4（皮肤） 或 /?q=ocr&lang=en`);
});
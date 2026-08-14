// 本地冒烟：不起 wrangler，用 node http 静态服务 data/ 目录 + 直接调 worker fetch。
// 用法：node worker/smoke.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "site", "public", "data");

const server = http.createServer(async (req, res) => {
  const name = req.url === "/data/plugins.json" ? "plugins.json" : req.url === "/data/index.json" ? "index.json" : null;
  if (!name) { res.writeHead(404); res.end(); return; }
  try {
    const buf = await readFile(path.join(dataDir, name));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(buf);
  } catch { res.writeHead(404); res.end(); }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const env = { SITE_ORIGIN: `http://127.0.0.1:${port}` };
const call = (path) => worker.fetch(new Request(`http://127.0.0.1:9${path}`, { headers: { referer: env.SITE_ORIGIN } }), env);

const results = {};
const t0 = Date.now();
for (const [label, path] of [
  ["中文别名: q=皮肤", "/api/search?q=%E7%9A%AE%E8%82%A4&limit=5"],
  ["英文: q=search", "/api/search?q=search&limit=5"],
  ["分类过滤: cat=皮肤/UI", "/api/search?cat=%E7%9A%AE%E8%82%A4%2FUI&limit=5"],
  ["stars排序: sort=stars", "/api/search?sort=stars&limit=5"],
  ["组合: q=ocr&cat=内容/媒体", "/api/search?q=ocr&cat=%E5%86%85%E5%AE%B9%2F%E5%AA%92%E4%BD%93&limit=5"],
]) {
  const r = await call(path);
  const j = await r.json();
  results[label] = { status: r.status, total: j.total, top: (j.results || []).slice(0, 3).map((p) => p.full_name) };
}
const ms = Date.now() - t0;
console.log(JSON.stringify(results, null, 1));
console.log("elapsed:", ms + "ms");
server.close();
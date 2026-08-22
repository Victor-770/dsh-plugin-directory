// 全链路集成测试（真实生产代码）：站点 /api/search -> 真实 Pages Function -> Worker(HTTP) -> data
// 用法：node worker/integration.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import worker, { resolveDataOrigin } from "./src/index.js";
import { onRequestGet } from "../functions/api/search.js"; // 真实 Pages Function 代码

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "site", "public", "data");

// 层1：数据静态服务（模拟 Pages 的 /data/*）
const dataServer = http.createServer(async (req, res) => {
  // 新数据布局：/data/plugins/manifest.json、/data/plugins/NNN.json、/data/index.json.gz
  const rel = req.url.startsWith("/data/") ? req.url.slice("/data/".length) : null;
  if (!rel || !/^plugins\/[\w-]+\.json$|^index\.json\.gz$/.test(rel)) { res.writeHead(404); res.end(); return; }
  try {
    const buf = await readFile(path.join(dataDir, rel));
    res.writeHead(200, { "content-type": rel.endsWith(".br") ? "application/octet-stream" : "application/json" });
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
let failures = 0;
function check(label, ok, detail = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
}
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

// ---------- Ticket 02：Worker 数据源锁定 ----------
// 带自定义头的直连 Worker 调用（模拟绕过 Pages Function 直接打 workers.dev 的流量）
// 兼容两种传入：静态 import 的 handler 对象（自带 .fetch）与动态 import 的模块命名空间（.default.fetch）
const directFetch = (workerMod, env, pathAndQuery, headers = {}) => {
  const handler = workerMod.fetch ? workerMod : workerMod.default;
  return handler.fetch(new Request(`http://worker.example${pathAndQuery}`, { headers }), env);
};

const Q = "/api/search?q=%E7%9A%AE%E8%82%A4&limit=5"; // q=皮肤
const official = await (await directFetch(worker, workerEnv, Q)).json();

{
  // A. 伪造 Referer 直连（SITE_ORIGIN 已配置）：数据仍来自官方 origin，响应与官方一致
  const evil = await (await directFetch(worker, workerEnv, Q, { referer: "https://evil.example.com" })).json();
  const same = evil.total === official.total && JSON.stringify(evil.results) === JSON.stringify(official.results);
  check("伪造 Referer 直连返回官方数据", same, `total ${evil.total} vs ${official.total}`);
}
{
  // B. 伪造 Referer 之后缓存未被污染：后续正常请求仍拿到官方数据
  const after = await (await directFetch(worker, workerEnv, Q)).json();
  check("伪造请求后缓存未被污染", JSON.stringify(after.results) === JSON.stringify(official.results));
}
{
  // C. 未配置 SITE_ORIGIN：非白名单 Referer -> 500 固定文案（不含 origin/路径/状态码等内部细节）
  const mod = await importFresh("?nocfg");
  const res = await directFetch(mod, {}, Q, { referer: "https://evil.example.com" });
  const body = await res.text();
  const leaks = /evil|worker\.example|fetch failed|origin|status/i.test(body) && !/internal error/.test(body);
  check("非白名单 Referer 返回 500 固定文案", res.status === 500 && body.includes("internal error") && !leaks, body.slice(0, 120));
}
{
  // D. resolveDataOrigin 解析规则（纯函数，白名单语义）
  check("origin 解析：SITE_ORIGIN 恒优先", resolveDataOrigin({ SITE_ORIGIN: "https://official.example" }, "https://evil.example.com") === "https://official.example");
  check("origin 解析：*.pages.dev Referer 白名单放行", resolveDataOrigin({}, "https://my-site.a1b2c3.pages.dev") === "https://my-site.a1b2c3.pages.dev");
  check("origin 解析：仿冒后缀拒绝", resolveDataOrigin({}, "https://evil-pages.dev") === null && resolveDataOrigin({}, "https://pages.dev.evil.com") === null);
  check("origin 解析：非法 Referer 拒绝", resolveDataOrigin({}, "http://not a url") === null && resolveDataOrigin({}, null) === null);
}

// ---------- Ticket 03：限流信任边界 ----------
async function importFresh(query) {
  return import(pathToFileURL(path.join(__dirname, "src", "index.js")).href + query);
}

{
  // E. 无密钥：伪造 x-dsh-real-ip 变化不能重置桶（同边缘 IP 连续请求仍被限流）
  const mod = await importFresh("?nokey");
  const env = { SITE_ORIGIN: workerEnv.SITE_ORIGIN, RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_SECONDS: 60 };
  let saw429 = false;
  for (let i = 0; i < 4; i++) {
    const res = await directFetch(mod, env, Q, { "x-dsh-real-ip": `10.0.0.${i}`, "x-dsh-shared-key": "forged" });
    if (res.status === 429) { saw429 = true; break; }
  }
  check("无密钥时伪造转发 IP 不重置限流桶", saw429);
}
{
  // F. 密钥正确：转发 IP 被信任，各 IP 独立计数（同样请求数下不再触发限流）
  const mod = await importFresh("?withkey");
  const env = { SITE_ORIGIN: workerEnv.SITE_ORIGIN, RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_SECONDS: 60, PAGES_WORKER_SHARED_KEY: "s3cret" };
  let all200 = true;
  for (let i = 0; i < 4; i++) {
    const res = await directFetch(mod, env, Q, { "x-dsh-real-ip": `10.1.0.${i}`, "x-dsh-shared-key": "s3cret" });
    if (res.status !== 200) { all200 = false; break; }
  }
  check("密钥匹配时转发 IP 独立计数", all200);
  // 错误密钥 + 变化 IP：退回同一边缘桶（unknown），同样额度下被限
  const mod2 = await importFresh("?wrongkey");
  let saw429 = false;
  for (let i = 0; i < 4; i++) {
    const res = await directFetch(mod2, env, Q, { "x-dsh-real-ip": `10.2.0.${i}`, "x-dsh-shared-key": "WRONG" });
    if (res.status === 429) { saw429 = true; break; }
  }
  check("错误密钥退回边缘 IP 计数（仍被限流）", saw429);
}
{
  // G. 上游 429 的 retry-after 经 Pages Function 透传给客户端
  const mod = await importFresh("?ratelimited");
  const limitedEnv = { SITE_ORIGIN: workerEnv.SITE_ORIGIN, RATE_LIMIT_MAX: 1, RATE_LIMIT_WINDOW_SECONDS: 60 };
  await directFetch(mod, limitedEnv, Q); // 用掉唯一额度
  const limitedServer = http.createServer((req, res) => {
    const handler = mod.fetch ? mod : mod.default;
    handler.fetch(new Request(`http://127.0.0.1${req.url}`, {}), limitedEnv)
      .then(async (up) => {
        const headers = { "content-type": "application/json" };
        const ra = up.headers.get("retry-after");
        if (ra) headers["retry-after"] = ra;
        res.writeHead(up.status, headers);
        res.end(await up.text());
      })
      .catch(() => { res.writeHead(500); res.end(); });
  });
  await new Promise((r) => limitedServer.listen(0, "127.0.0.1", r));
  const clientRes = await onRequestGet({
    request: new Request("http://site.pages.dev/api/search?q=x"),
    env: { WORKER_URL: `http://127.0.0.1:${limitedServer.address().port}` },
  });
  const raHeader = clientRes.headers.get("retry-after");
  check("上游 429 的 retry-after 透传到客户端", clientRes.status === 429 && raHeader && Number(raHeader) > 0, `status=${clientRes.status} retry-after=${raHeader}`);
  limitedServer.close();
}
{
  // H. 上游挂起时代理限时返回 502（不无限等待）
  const hanging = http.createServer(() => { /* 永不响应 */ });
  await new Promise((r) => hanging.listen(0, "127.0.0.1", r));
  const t1 = Date.now();
  const res = await onRequestGet({
    request: new Request("http://site.pages.dev/api/search?q=x"),
    env: { WORKER_URL: `http://127.0.0.1:${hanging.address().port}`, UPSTREAM_TIMEOUT_MS: 200 },
  });
  const elapsed = Date.now() - t1;
  check("挂起的上游 -> 限时 502", res.status === 502 && elapsed < 5000, `status=${res.status} ${elapsed}ms`);
  hanging.close();
}

dataServer.close(); workerServer.close();
process.exit(pass === cases.length && failures === 0 ? 0 : 1);

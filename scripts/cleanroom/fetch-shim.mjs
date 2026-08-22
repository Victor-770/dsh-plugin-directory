// 洁净室 fetch 注入（以 `node --import` 预加载）：拦截 sync 进程的全部出站请求，
// 用 github-fixture 的假数据应答，并按 CLEANROOM_SCENARIO 注入脚本化故障。
// 所有 api.github.com 请求追加记录到 CLEANROOM_REQLOG（JSON Lines），供闸门间距断言。
//
// 场景 schema（CLEANROOM_SCENARIO，JSON）：
//   { searchFaults:  [{ count, type: "network"|"504"|"429"|"abuse403", retryAfterSeconds? }],
//     readmeFaults:  [{ count, type: "network", match?: "owner/repo" }] }
// 故障按出现顺序消耗：第 count 次命中的请求返回该故障，之后恢复。
import { appendFileSync } from "node:fs";
import { REPOS } from "./github-fixture.mjs";

const scenario = JSON.parse(process.env.CLEANROOM_SCENARIO || "{}");
const reqLog = process.env.CLEANROOM_REQLOG;
const searchFaults = (scenario.searchFaults || []).map((f) => ({ ...f, left: f.count }));
const readmeFaults = (scenario.readmeFaults || []).map((f) => ({ ...f, left: f.count }));

const realFetch = globalThis.fetch;
const jsonRes = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...headers },
});

// 同步写日志：异步 append 会乱序，时间间距断言会拿到假数据
function logRequest(host, path, status) {
  if (!reqLog) return;
  try {
    appendFileSync(reqLog, JSON.stringify({ t: Date.now(), host, path, status }) + "\n");
  } catch { /* 日志失败不影响被测进程 */ }
}

// 按序消耗故障额度；type -> Response 或抛出的网络异常
function consumeFault(faults, key) {
  for (const f of faults) {
    if (f.left > 0 && (!f.match || key.includes(f.match))) {
      f.left--;
      return f;
    }
  }
  return null;
}

globalThis.fetch = async function cleanroomFetch(input, init) {
  const url = new URL(typeof input === "string" ? input : input.url);
  const host = url.hostname;

  // ---- GitHub 搜索 API：忽略查询语义，恒返回全量夹具（searchOmit 模拟分页漂移丢结果） ----
  if (host === "api.github.com") {
    const fault = consumeFault(searchFaults, url.pathname + url.search);
    if (fault) {
      if (fault.type === "network") {
        logRequest(host, url.pathname, "network-error");
        throw new TypeError("cleanroom: simulated network failure");
      }
      if (fault.type === "504") {
        logRequest(host, url.pathname, 504);
        return new Response("<!DOCTYPE html><html>504 gateway timeout</html>", { status: 504 });
      }
      if (fault.type === "429") {
        logRequest(host, url.pathname, 429);
        return jsonRes(429, { message: "Too many requests" }, {
          "retry-after": String(fault.retryAfterSeconds ?? 1),
        });
      }
      if (fault.type === "abuse403") {
        logRequest(host, url.pathname, 403);
        return jsonRes(403, { message: "You have triggered an abuse detection mechanism and have been told to slow down" });
      }
    }
    logRequest(host, url.pathname, 200);
    const items = REPOS.filter((r) => !(scenario.searchOmit || []).includes(r.full_name));
    return jsonRes(200, { total_count: items.length, items: items.map(({ _readme, ...r }) => r) });
  }

  // ---- raw README：路径 /{owner}/{repo}/HEAD/{name} ----
  if (host === "raw.githubusercontent.com") {
    const m = url.pathname.match(/^\/([^/]+\/[^/]+)\/HEAD\/(.+)$/);
    const fullName = m ? m[1] : url.pathname;
    const fault = consumeFault(readmeFaults, fullName);
    if (fault) {
      logRequest(host, url.pathname, "network-error");
      throw new TypeError("cleanroom: simulated readme network failure");
    }
    if (m && m[2] === "README.md") {
      const repo = REPOS.find((r) => r.full_name === fullName);
      logRequest(host, url.pathname, 200);
      return new Response(repo ? repo._readme : `# ${fullName}\n`, { status: 200 });
    }
    logRequest(host, url.pathname, 404);
    return new Response("404: Not Found", { status: 404 });
  }

  // ---- IndexNow：恒接受；记录提交的 URL 列表供断言 ----
  if (host === "api.indexnow.org") {
    let urls = [];
    try { urls = JSON.parse(init?.body || "{}").urlList || []; } catch { /* ignore */ }
    try {
      appendFileSync(reqLog, JSON.stringify({ t: Date.now(), host, path: url.pathname, status: 202, urls }) + "\n");
    } catch { /* 日志失败不影响被测进程 */ }
    return new Response("", { status: 202 });
  }

  return realFetch(input, init);
};

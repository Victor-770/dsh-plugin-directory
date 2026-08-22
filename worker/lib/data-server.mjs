// 本地数据静态服务：从 site/public/data 服务 manifest/分片/gzip 索引。
// 此前 serve / smoke / bench / integration 四处逐字重复同一份实现，会各自漂移，收敛为此模块。
// 用法：const { server, origin } = await startDataServer(); ... server.close()
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "site", "public", "data");

export async function startDataServer() {
  const server = http.createServer(async (req, res) => {
    // 数据布局：/data/plugins-meta.json.gz、/data/plugins/manifest.json、/data/plugins/NNN.json、/data/index.json.gz
    const rel = req.url.startsWith("/data/") ? req.url.slice("/data/".length) : null;
    if (!rel || !/^plugins\/[\w-]+\.json$|^index\.json\.gz$|^plugins-meta\.json\.gz$/.test(rel)) { res.writeHead(404); res.end(); return; }
    try {
      const buf = await readFile(path.join(dataDir, rel));
      res.writeHead(200, { "content-type": rel.endsWith(".gz") ? "application/octet-stream" : "application/json" });
      res.end(buf);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

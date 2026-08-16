// 构建期读取 plugins 分片数据（public/data/plugins/*.json + manifest.json）。
// 单文件 plugins.json 曾达 28.8MiB，超出 Cloudflare Pages 25MiB/文件上限，改为分片存储；
// 站点构建与 Worker 都按 manifest 依次读取全部切片，行为与原单文件一致。
import { readFileSync } from "node:fs";
import path from "node:path";

export function loadPlugins() {
  // 构建时 cwd 恒为 site/
  const dir = path.join(process.cwd(), "public", "data", "plugins");
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const plugins = [];
  for (const name of manifest.shards) {
    const shard = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    plugins.push(...(shard.plugins || []));
  }
  return { generatedAt: manifest.generatedAt, count: manifest.count, plugins };
}

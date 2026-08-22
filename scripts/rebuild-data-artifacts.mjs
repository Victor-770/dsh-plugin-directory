// 离线重放数据产物：从现有 data/plugins 分片重建派生文件，不访问网络。
// 用法：node scripts/rebuild-data-artifacts.mjs [--all]
//   默认只补产"新增"产物（plugins-meta.json.gz、browse-top.json）——不动分片与其余产物，
//   git diff 最小；--all 全量重写（产物格式变更后用，会产生大 diff：generatedAt 内嵌每个分片）。
// 记录本体（分片）只读；排序与 sync 写盘一致（star 降序）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic, writeDataArtifacts, readRecordsFromDataDir } from "./lib/artifacts.mjs";
import { gzipSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "site", "public", "data");

const records = await readRecordsFromDataDir(DATA_DIR);
if (!records.length) {
  console.error("[rebuild] no shard records found under site/public/data/plugins — run sync first");
  process.exit(1);
}
records.sort((a, b) => b.stars - a.stars);

if (process.argv.includes("--all")) {
  const stats = await writeDataArtifacts(DATA_DIR, records);
  console.log(`[rebuild] all artifacts rewritten: ${records.length} plugins, ${stats.shardCount} shards, ${stats.tokenCount} tokens`);
} else {
  // 只补产新增产物（与 artifacts.mjs 的实现保持同一字段口径；避免全量重写分片的巨型 diff）
  const generatedAt = new Date().toISOString();
  const liteRecord = (r) => ({
    full_name: r.full_name,
    description: (r.description || "").slice(0, 200),
    stars: r.stars,
    language: r.language ?? null,
    categories: r.categories,
    tags: r.tags,
  });
  const metaPlugins = records.map(({ readme_text, ...meta }) => meta);
  await writeFileAtomic(path.join(DATA_DIR, "plugins-meta.json.gz"), gzipSync(JSON.stringify({ generatedAt, count: metaPlugins.length, plugins: metaPlugins })));
  const catCounts = {};
  const tagCounts = {};
  for (const r of records) {
    for (const c of r.categories || []) catCounts[c] = (catCounts[c] || 0) + 1;
    for (const t of r.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const topTags = Object.fromEntries(Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 100));
  await writeFileAtomic(path.join(DATA_DIR, "browse-top.json"), JSON.stringify({
    generatedAt,
    count: records.length,
    plugins: records.slice(0, 300).map(liteRecord),
    catCounts,
    tagCounts: topTags,
  }));
  console.log(`[rebuild] incremental artifacts written (plugins-meta.json.gz + browse-top.json) for ${records.length} plugins`);
}

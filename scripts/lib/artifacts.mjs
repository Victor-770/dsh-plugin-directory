// 数据产物写盘（sync 管道的产物层，单一实现）：
//   data/plugins/NNN.json + manifest.json   # 全量记录（含 readme_text）；站点构建读（详情页 README 摘要）
//   data/index.json.gz                      # 搜索索引（gzip）；仅 Worker 消费
//   data/plugins-meta.json.gz               # 元数据（无 readme_text，gzip）；仅 Worker 消费
//   data/browse.json                        # 全量元数据（无 readme）；构建期页面读取（SSR 卡片/详情/sitemap）
//   data/browse-lite.json                   # 浏览端精简全量（懒加载）；分类/标签本地过滤 + API 降级
//   data/browse-top.json                    # 浏览端首屏（top 300 + 全语料计数）；首页分阶段加载第一级
// 从 sync.mjs 抽出的动机：产物策略变更（如新增 browse-top）需要在不访问网络的前提下对现有
// 分片数据重放派生（scripts/rebuild-data-artifacts.mjs）。
import { writeFile, mkdir, readdir, rm, rename, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { buildIndex } from "../../search-core/index.js";

// 原子写盘：同目录临时文件 + rename——磁盘满/中途崩溃只可能留下完整旧文件或完整新文件，
// 不会出现半份 JSON 被下一轮 readPreviousRecords 解析失败或被 CI 提交部署。
export async function writeFileAtomic(filePath, data) {
  const tmp = filePath + ".tmp";
  await writeFile(tmp, data);
  await rename(tmp, filePath);
}

// 读取既有分片数据：full_name -> record 的 Map 供 README 缓存与 diff（sync）与离线重放（rebuild）。
// 兼容迁移前遗留的单文件 plugins.json。
export async function readRecordsFromDataDir(dataDir) {
  const shardDir = path.join(dataDir, "plugins");
  try {
    const manifest = JSON.parse(await readFile(path.join(shardDir, "manifest.json"), "utf8"));
    const out = [];
    for (const name of manifest.shards || []) {
      const shard = JSON.parse(await readFile(path.join(shardDir, name), "utf8"));
      if (Array.isArray(shard.plugins)) out.push(...shard.plugins);
    }
    return out;
  } catch {
    try {
      const raw = JSON.parse(await readFile(path.join(dataDir, "plugins.json"), "utf8"));
      return Array.isArray(raw.plugins) ? raw.plugins : [];
    } catch {
      return [];
    }
  }
}

// 浏览端首屏子集规模：SSR 首屏 50 卡 + 渐进渲染 100/页，300 给滚动留余量；更大的列表交给懒加载全量。
const TOP_N = 300;
// 首屏附带的标签计数上限：标签云只展示 top 20，100 键足够且控制文件体积。
const TAG_COUNT_LIMIT = 100;

function liteRecord(r) {
  return {
    full_name: r.full_name,
    description: (r.description || "").slice(0, 200),
    stars: r.stars,
    language: r.language ?? null,
    categories: r.categories,
    tags: r.tags,
  };
}

// 写出全部数据产物。返回 { generatedAt, shardCount, tokenCount } 供调用方打日志。
// 写序保证崩溃安全：分片全部写完，manifest 最后原子换入（manifest 引用的名字始终对应完整文件）。
export async function writeDataArtifacts(dataDir, finalRecords) {
  await mkdir(dataDir, { recursive: true });
  const generatedAt = new Date().toISOString();

  // plugins 分片：单文件曾达 28.8MiB，超出 Cloudflare Pages 25MiB/文件上限。
  const shardDir = path.join(dataDir, "plugins");
  await mkdir(shardDir, { recursive: true });
  const SHARD_SIZE = 400;
  const shardNames = [];
  for (let i = 0; i < finalRecords.length; i += SHARD_SIZE) {
    const chunk = finalRecords.slice(i, i + SHARD_SIZE);
    const name = String(i / SHARD_SIZE).padStart(3, "0") + ".json";
    await writeFileAtomic(path.join(shardDir, name), JSON.stringify({ generatedAt, count: chunk.length, plugins: chunk }, null, 2));
    shardNames.push(name);
  }
  // 分片数收缩时清理 manifest 未引用的旧分片（如 12 片 -> 11 片时 011.json 不残留成死重）
  const referenced = new Set(shardNames);
  for (const f of await readdir(shardDir)) {
    if (/^\d+\.json$/.test(f) && !referenced.has(f)) await rm(path.join(shardDir, f));
  }
  await writeFileAtomic(path.join(shardDir, "manifest.json"), JSON.stringify({ generatedAt, count: finalRecords.length, shards: shardNames }));
  // 移除旧单文件，避免遗留超限文件再次进入部署
  await rm(path.join(dataDir, "plugins.json"), { force: true });

  // 搜索索引 gzip：未压缩已 17.8MiB+ 且随仓库数增长，逼近 25MiB 上限（仅 Worker 消费）。
  const index = buildIndex(finalRecords);
  await writeFileAtomic(path.join(dataDir, "index.json.gz"), gzipSync(JSON.stringify(index)));
  await rm(path.join(dataDir, "index.json"), { force: true });

  // Worker 元数据分片（无 readme_text，gzip）：Worker 冷启动曾拉全部含 README 分片（~61MB）
  // 再在内存里剥离（~80MB 全文）；此产物让冷启动与每 TTL 的后台刷新只拉 ~2MB。
  const metaPlugins = finalRecords.map(({ readme_text, ...meta }) => meta);
  await writeFileAtomic(path.join(dataDir, "plugins-meta.json.gz"), gzipSync(JSON.stringify({ generatedAt, count: metaPlugins.length, plugins: metaPlugins })));

  // 构建期浏览数据（无 readme_text）：SSR 卡片/详情页/sitemap 读取
  const browse = metaPlugins;
  await writeFileAtomic(path.join(dataDir, "browse.json"), JSON.stringify({ generatedAt, count: browse.length, plugins: browse }));

  // 浏览端精简全量：卡片渲染字段（描述截断 200、无 html_url/pushed_at/topics），懒加载第二级
  const lite = finalRecords.map(liteRecord);
  await writeFileAtomic(path.join(dataDir, "browse-lite.json"), JSON.stringify({ generatedAt, count: lite.length, plugins: lite }));

  // 浏览端首屏：top 300 + 全语料分类/标签计数（分阶段加载第一级，首访只下 ~100KB 而非 3MB）
  const catCounts = {};
  const tagCounts = {};
  for (const r of finalRecords) {
    for (const c of r.categories || []) catCounts[c] = (catCounts[c] || 0) + 1;
    for (const t of r.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const topTags = Object.fromEntries(
    Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, TAG_COUNT_LIMIT)
  );
  await writeFileAtomic(path.join(dataDir, "browse-top.json"), JSON.stringify({
    generatedAt,
    count: lite.length,
    plugins: finalRecords.slice(0, TOP_N).map(liteRecord),
    catCounts,
    tagCounts: topTags,
  }));

  return { generatedAt, shardCount: shardNames.length, tokenCount: Object.keys(index.tokens).length };
}

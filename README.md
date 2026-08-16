# DSH Plugin Directory

DeepSeek Harness 插件目录：中英双语、按功能分类、README 全文搜索、按热度排序。

- 数据源：`https://github.com/topics/dsh-plugin`（GitHub Actions 每 6 小时同步，当前 ~990 个仓库）
- 前端：Cloudflare Pages（Astro 静态站，深色开发工具美学）
- 搜索：Cloudflare Worker（search-core 纯函数库，中英别名互搜）
- 测试：`npm test`（node:test 32 例，唯一 seam = search-core）

## 结构

```
scripts/sync.mjs        # 同步管道：拉 GitHub API -> plugins/ 分片 + index.json.gz + browse.json，完成后 IndexNow 通知 Bing
scripts/lib/categories.mjs  # 八分类规则 + top-20 手动兜底
search-core/            # 纯函数库（tokenize/buildIndex/expandAliases/search）+ 测试
worker/                 # Cloudflare Worker：GET /api/search
site/                   # Astro 静态站
site/public/data/       # 同步产物（Pages 静态服务，Worker 同源拉取；plugins 分片 + gzip 索引，规避 Pages 25MiB/文件上限）
site/src/pages/plugin/  # 每插件详情页（构建期生成，SEO 长尾入口；/en/ 下有英文版）
site/src/pages/en/       # 英文版页面树（真实 URL /en/，配 hreflang，zh 在根路径）
site/src/pages/category/ # 分类落地页（/category/{slug}/，中英，空分类不生成）
site/src/pages/sitemap.xml.ts  # 构建期生成 sitemap.xml（中英 URL + hreflang alternate，详情页 lastmod 取 pushed_at）
site/scripts/og-images.mjs  # 构建期生成每插件 OG 图（纯 Node PNG，1200x630）
functions/              # Pages Functions：/api/search 代理到 Worker（必须位于仓库根，Pages 自动检测）
```

## SEO / IndexNow

同步完成后自动向 Bing 通知新增/更新/删除的插件 URL（Bing 站长指南 §4）：

- **Key 文件**：`site/public/<32位hex>.txt`（当前 `e5c18ce8e6c944e39d70920c824b5626.txt`），随静态站部署，地址 `https://dsh-plugin-directory.online/<key>.txt`。
- **触发时机**：每次 `npm run sync` 对比上次 `plugins.json`，只提交 `pushed_at`/`stars`/`description` 变化的插件及其 `/en/` 版本，不做全量批量提交。
- **端点**：默认 `https://api.indexnow.org/indexnow`；可用环境变量 `INDEXNOW_ENDPOINT` 覆盖（自建端点调试）。
- **失败不影响同步**：IndexNow 通知出错仅告警，不会让数据同步失败。
- sitemap 的插件详情页 `lastmod` 使用各插件 GitHub `pushed_at`（而非同步时间），符合 Bing 对准确 freshness 信号的要求。

## 本地开发

```bash
npm test                          # search-core + i18n 测试（32 例）
node scripts/sync.mjs             # 拉取数据（可选 GITHUB_TOKEN=xxx 提速）
cd site && npm install && npm run dev   # 本地浏览站（需先 sync 生成数据）
node worker/smoke.mjs             # Worker 本地冒烟（需先 sync）
```

## 部署（Ticket 06）

> 有向导版：Windows 下执行 `pwsh scripts/deploy.ps1` 逐项检查并打印每一步。

1. **GitHub repo** 推送到远端，仓库 Secrets 添加 `GH_TOKEN`（fine-grained，public repo 只读；不加也能跑，额度低）。
2. **Pages**：连接该 repo → 构建命令 `cd site && npm install && npm run build` → 输出目录 `site/dist`（相对仓库根） → 得到 `xxx.pages.dev`（自定义域名 `dsh-plugin-directory.online`，并在 Cloudflare 配好 pages.dev → 主域 301）。
3. **Worker**：`cd worker` → 把 `wrangler.toml` 的 `SITE_ORIGIN` 改成 Pages 地址 → `npx wrangler deploy`。
4. 上线检查：首页展示"最后同步时间"；`/api/search?q=皮肤` 返回结果。
5. **Bing Webmaster Tools**（可选但推荐）：验证 `dsh-plugin-directory.online`，提交 `https://dsh-plugin-directory.online/sitemap.xml`。IndexNow 通知无需在 BWT 验证（key 文件已部署）。

## 已知取舍（grilling 记档）

- 全量收录（含独立应用/死仓库），无兼容性验证；star 排序靠前的是非插件应用（如 OpenBiliClaw）。
- 默认相关性排序，营销文案 README 排名偏前。
- 中文切词为二元切词 + 尾字，别名表 ~60 条硬编码；不做语义搜索。
- 壳双语：UI 文案中英，插件内容保持原文。
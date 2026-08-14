# DSH Plugin Directory

DeepSeek Harness 插件目录：中英双语、按功能分类、README 全文搜索、按热度排序。

- 数据源：`https://github.com/topics/dsh-plugin`（GitHub Actions 每 6 小时同步，当前 ~990 个仓库）
- 前端：Cloudflare Pages（Astro 静态站，深色开发工具美学）
- 搜索：Cloudflare Worker（search-core 纯函数库，中英别名互搜）
- 测试：`npm test`（node:test，唯一 seam = search-core）

## 结构

```
scripts/sync.mjs        # 同步管道：拉 GitHub API -> plugins.json + index.json + browse.json
scripts/lib/categories.mjs  # 八分类规则 + top-20 手动兜底
search-core/            # 纯函数库（tokenize/buildIndex/expandAliases/search）+ 测试
worker/                 # Cloudflare Worker：GET /api/search
site/                   # Astro 静态站
site/public/data/       # 同步产物（Pages 静态服务，Worker 同源拉取）
```

## 本地开发

```bash
npm test                          # search-core 测试（25 例）
node scripts/sync.mjs             # 拉取数据（可选 GITHUB_TOKEN=xxx 提速）
cd site && npm install && npm run dev   # 本地浏览站（需先 sync 生成数据）
node worker/smoke.mjs             # Worker 本地冒烟（需先 sync）
```

## 部署（Ticket 06）

1. **GitHub repo** 推送到远端，仓库 Secrets 添加 `GH_TOKEN`（fine-grained，public repo 只读；不加也能跑，额度低）。
2. **Pages**：连接该 repo → 构建命令 `cd site && npm install && npm run build` → 输出目录 `dist` → 得到 `xxx.pages.dev`。
3. **Worker**：`cd worker` → 把 `wrangler.toml` 的 `SITE_ORIGIN` 改成 Pages 地址 → `npx wrangler deploy`。
4. 上线检查：首页展示"最后同步时间"；`/api/search?q=皮肤` 返回结果。

## 已知取舍（grilling 记档）

- 全量收录（含独立应用/死仓库），无兼容性验证；star 排序靠前的是非插件应用（如 OpenBiliClaw）。
- 默认相关性排序，营销文案 README 排名偏前。
- 中文切词为二元切词 + 尾字，别名表 ~60 条硬编码；不做语义搜索。
- 壳双语：UI 文案中英，插件内容保持原文。

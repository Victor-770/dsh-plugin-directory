# DSH Plugin Directory 部署向导（Windows / PowerShell）
# 用法: pwsh scripts/deploy.ps1   （只读检查 + 打印步骤，不做任何破坏性操作）
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "`n=== DSH Plugin Directory 部署向导 ===`n" -ForegroundColor Cyan

# 1) 数据与代码就绪
$dataOk = Test-Path "$root/site/public/data/plugins.json"
$dataCount = if ($dataOk) { (Get-Content "$root/site/public/data/plugins.json" -Raw | ConvertFrom-Json).count } else { 0 }
Write-Host "[1/6] 数据就绪: $dataOk ($dataCount 插件)" -ForegroundColor $(if ($dataOk) { "Green" } else { "Yellow" })
if (-not $dataOk) { Write-Host "   -> 先运行: node scripts/sync.mjs" }

# 2) git 状态
$gitClean = (git -C $root status --porcelain | Measure-Object).Count -eq 0
$remote = git -C $root remote get-url origin 2>$null
Write-Host "[2/6] git: 工作树$(if ($gitClean) { "干净" } else { "有未提交改动" }) | remote: $($(if ($remote) { $remote } else { "未设置" }))"
if (-not $remote) {
  Write-Host "   -> 创建 GitHub 仓库后执行:" -ForegroundColor Yellow
  Write-Host "      git remote add origin https://github.com/<你>/<仓库>.git"
  Write-Host "      git push -u origin master"
}

# 3) wrangler / Cloudflare 登录
$wranglerVer = & npx --yes wrangler --version 2>$null | Select-Object -Last 1
Write-Host "[3/6] wrangler: $wranglerVer"
$whoami = & npx --yes wrangler whoami 2>&1 | Out-String
if ($whoami -match "not logged in|You are not authenticated") {
  Write-Host "   -> 未登录 Cloudflare，执行: npx wrangler login" -ForegroundColor Yellow
} else {
  Write-Host "   -> Cloudflare 已登录" -ForegroundColor Green
}

# 4) 测试
Write-Host "[4/6] 运行测试..."
Push-Location $root
$testOut = & npm test 2>&1 | Select-Object -Last 4 | Out-String
Pop-Location
Write-Host "   $testOut"

# 5) 站点构建命令（Pages 面板配置用）
Write-Host "[5/6] Cloudflare Pages 配置（面板）:" -ForegroundColor Cyan
Write-Host "   构建命令: cd site && npm install && npm run build"
Write-Host "   输出目录: dist"
Write-Host "   环境变量 WORKER_URL = <Worker 地址>（见下一步）"

# 6) Worker 部署
Write-Host "[6/6] Worker 部署:" -ForegroundColor Cyan
Write-Host "   cd worker"
Write-Host "   编辑 wrangler.toml: SITE_ORIGIN = 'https://<你的项目>.pages.dev'"
Write-Host "   npx wrangler deploy"
Write-Host "   然后回 Pages 面板把 WORKER_URL 设为 Worker 地址（如 https://dsh-plugin-directory-search.<你的子域>.workers.dev）"

Write-Host "`n=== 上线自检 ===`n" -ForegroundColor Green
Write-Host "1. 打开 https://<你的项目>.pages.dev 首页显示插件卡片与最后同步时间"
Write-Host "2. 访问 /?q=%E7%9A%AE%E8%82%A4 能搜出皮肤插件（中英互搜）"
Write-Host "3. 等待下一个 6 小时 cron 或手动触发 workflow，确认数据自动更新"
Write-Host "`n向导结束。有任何一步失败，把输出发回来即可。`n" -ForegroundColor Cyan
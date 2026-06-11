# setup-v2.ps1 — Windows 一键部署脚本
#
# 功能：
#   1. 检查依赖（Node ≥ 22.5、unar/7z 可选）
#   2. 安装 Playwright + Chromium（用于 refresh-auth）
#   3. 提示首次抓取 Gerrit + Confluence 凭据
#   4. （可选）首批 sync 提示
#
# 用法：
#   PowerShell -ExecutionPolicy Bypass -File scripts\setup-v2.ps1

[CmdletBinding()]
param(
    [switch]$SkipAuthRefresh,
    [switch]$SkipPlaywrightInstall
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot

Write-Host '' -ForegroundColor Cyan
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  whaletv-dev-power v2 setup' -ForegroundColor Cyan
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''

# ── 1. 依赖检查 ──────────────────────────────────────────────────
Write-Host '[1/4] 检查系统依赖...' -ForegroundColor Yellow

$nodeVersion = $null
try {
    $nodeVersion = (& node --version) -replace '^v', ''
}
catch {
    Write-Host '  ✗ Node.js 未安装' -ForegroundColor Red
    Write-Host '    请安装 Node.js ≥ 22.5.0：https://nodejs.org/ 或 winget install OpenJS.NodeJS' -ForegroundColor Yellow
    exit 1
}
$nodeMajor = [int]($nodeVersion.Split('.')[0])
$nodeMinor = [int]($nodeVersion.Split('.')[1])
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 5)) {
    Write-Host "  ✗ Node.js $nodeVersion 太旧（需要 ≥ 22.5.0；knowledge-mcp 用 node:sqlite 内置模块）" -ForegroundColor Red
    Write-Host '    请升级：winget upgrade OpenJS.NodeJS' -ForegroundColor Yellow
    exit 1
}
Write-Host "  ✓ Node.js $nodeVersion" -ForegroundColor Green

function Test-CmdAvailable {
    param([string]$Name)
    return [bool](Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

$hasUnar = Test-CmdAvailable 'unar'
$has7z = Test-CmdAvailable '7z'
if ($hasUnar) {
    Write-Host '  ✓ unar (推荐用于 RAR5 解压)' -ForegroundColor Green
}
elseif ($has7z) {
    Write-Host '  ⚠ unar 未安装；7z 可作 fallback。建议: choco install unar' -ForegroundColor Yellow
}
else {
    Write-Host '  ⚠ unar / 7z 都未安装' -ForegroundColor Yellow
    Write-Host '    建议: choco install unar 7zip （处理 .rar/.7z 附件需要）' -ForegroundColor Yellow
}

# ── 2. Playwright + Chromium ─────────────────────────────────────
Write-Host ''
Write-Host '[2/4] 安装 scripts/ 依赖（Playwright + Chromium）...' -ForegroundColor Yellow

if ($SkipPlaywrightInstall) {
    Write-Host '  - 跳过（-SkipPlaywrightInstall）' -ForegroundColor Yellow
}
else {
    Push-Location $scriptRoot
    try {
        Write-Host '  执行: npm install ...'
        & node (Join-Path $env:APPDATA 'npm\node_modules\npm\bin\npm-cli.js') install --no-audit --no-fund 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            & npm install --no-audit --no-fund 2>&1 | Out-Host
        }
        if ($LASTEXITCODE -eq 0) {
            Write-Host '  ✓ Playwright 已安装' -ForegroundColor Green
        }
        else {
            throw "npm install exit $LASTEXITCODE"
        }
    }
    catch {
        Write-Host "  ✗ 安装失败: $_" -ForegroundColor Red
        Write-Host '    请手动跑：cd scripts && npm install && npx playwright install chromium' -ForegroundColor Yellow
    }
    finally {
        Pop-Location
    }
}

# ── 3. 凭据自动刷新 ──────────────────────────────────────────────
Write-Host ''
Write-Host '[3/4] 凭据配置（refresh-auth）' -ForegroundColor Yellow

if ($SkipAuthRefresh) {
    Write-Host '  - 跳过（-SkipAuthRefresh）；记得后续手动跑 scripts\refresh-auth.ps1' -ForegroundColor Yellow
}
else {
    $answer = Read-Host '现在跑 refresh-auth 抓取 Gerrit + Confluence cookie 吗？(Y/n)'
    if ($answer -ne 'n' -and $answer -ne 'N') {
        & PowerShell -ExecutionPolicy Bypass -File (Join-Path $scriptRoot 'refresh-auth.ps1') -NoSelfInstall
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ✗ refresh-auth 失败 (exit $LASTEXITCODE)。可稍后手动跑：scripts\refresh-auth.ps1" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host '  - 跳过；记得后续手动跑 scripts\refresh-auth.ps1' -ForegroundColor Yellow
    }
}

# ── 4. 提示 ZMIND_API_KEY / OPENGROK 凭据 ────────────────────────
Write-Host ''
Write-Host '[4/4] 还需手动配置以下凭据到 ~/.kiro/settings/mcp.json：' -ForegroundColor Yellow
Write-Host ''
Write-Host '  [zmind-mcp-server]' -ForegroundColor White
Write-Host '    ZMIND_API_KEY      = (登录 zmind.whaletv.com → 我的账户 → API 访问密钥)' -ForegroundColor Gray
Write-Host ''
Write-Host '  [opengrok-mcp-server]' -ForegroundColor White
Write-Host '    OPENGROK_USERNAME  = (公司分配的 OpenGrok 账号)' -ForegroundColor Gray
Write-Host '    OPENGROK_PASSWORD  = (对应密码)' -ForegroundColor Gray
Write-Host ''
Write-Host '  [knowledge-mcp-server] 复用上面凭据；首次跑 sync_zmind/sync_gerrit 后' -ForegroundColor White
Write-Host '  自动下载 BGE-small-zh ONNX 模型到 ./data/models/（~80MB，1-3 分钟）' -ForegroundColor Gray
Write-Host ''

Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  setup-v2 完成。重启 Kiro 让新凭据生效。' -ForegroundColor Green
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''
Write-Host '后续命令：' -ForegroundColor White
Write-Host '  • cookie 过期 → scripts\refresh-auth.ps1' -ForegroundColor Gray
Write-Host '  • 首次同步知识库 → 在 Kiro 内说："用 sync_zmind 拉 1000 条；用 embed_pending 处理 zmind"' -ForegroundColor Gray
Write-Host '  • 一键 PR/Bug 分析 → "用 analyze_issue 分析 #<ID>"' -ForegroundColor Gray
Write-Host ''

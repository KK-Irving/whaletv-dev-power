# setup-v2.ps1 — Windows 一键部署脚本（v2 onboarding 主入口）
#
# 流程：
#   1. 检查依赖（Node ≥ 22.5、unar/7z 可选）
#   2. 安装 Playwright + Chromium（用于 refresh-auth）
#   3. 交互收集 4 套凭据（Zmind API Key / OpenGrok / Gerrit SSO / Confluence）
#   4. 调 setup-creds.mjs 写 Zmind + OpenGrok
#   5. 调 refresh-auth.mjs 抓 Gerrit + Confluence cookie
#   6. 提示重启 Kiro
#
# 安全：
#   - 密码用 SecureString 收集，不回显；脚本结束自动从内存清除
#   - 凭据通过环境变量传给子脚本，不落盘
#
# 用法：
#   PowerShell -ExecutionPolicy Bypass -File scripts\setup-v2.ps1
#   PowerShell -ExecutionPolicy Bypass -File scripts\setup-v2.ps1 -SkipPlaywrightInstall

[CmdletBinding()]
param(
    [switch]$SkipAuthRefresh,
    [switch]$SkipPlaywrightInstall,
    [switch]$SkipCredsSetup
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot

Write-Host '' -ForegroundColor Cyan
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  whaletv-dev-power v2 setup' -ForegroundColor Cyan
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''

# 帮手：把 SecureString 转明文（仅在子进程 env 用，使用完立即 Clear-Variable）
function ConvertTo-PlainText {
    param([SecureString]$Secure)
    if ($null -eq $Secure) { return '' }
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

# ── 1. 依赖检查 ──────────────────────────────────────────────────
Write-Host '[1/5] 检查系统依赖...' -ForegroundColor Yellow

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

if (Test-CmdAvailable 'unar') {
    Write-Host '  ✓ unar (推荐用于 RAR5 解压)' -ForegroundColor Green
}
elseif (Test-CmdAvailable '7z') {
    Write-Host '  ⚠ unar 未安装；7z 可作 fallback。建议: choco install unar' -ForegroundColor Yellow
}
else {
    Write-Host '  ⚠ unar / 7z 都未安装；建议: choco install unar 7zip' -ForegroundColor Yellow
}

# ── 2. Playwright + Chromium ─────────────────────────────────────
Write-Host ''
Write-Host '[2/5] 安装 scripts/ 依赖（Playwright + Chromium）...' -ForegroundColor Yellow

if ($SkipPlaywrightInstall) {
    Write-Host '  - 跳过（-SkipPlaywrightInstall）' -ForegroundColor Yellow
}
else {
    Push-Location $scriptRoot
    try {
        Write-Host '  执行: npm install ...'
        & npm install --no-audit --no-fund 2>&1 | Out-Host
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

# ── 3. 收集 4 套凭据 ─────────────────────────────────────────────
Write-Host ''
Write-Host '[3/5] 收集凭据（4 套独立账号 — 一次性配置完，永久 + 1-4 周刷 cookie）' -ForegroundColor Yellow
Write-Host ''

$zmindKey = ''
$ogUser = ''
$ogPass = $null
$gerritUser = ''
$gerritPass = $null
$confluenceUser = ''
$confluencePass = $null

if ($SkipCredsSetup) {
    Write-Host '  - 跳过（-SkipCredsSetup）' -ForegroundColor Yellow
}
else {
    Write-Host '  ┌─ Zmind' -ForegroundColor Cyan
    Write-Host '  │  https://zmind.whaletv.com → 我的账户 → API 访问密钥（40 位十六进制）' -ForegroundColor Gray
    $zmindKey = (Read-Host '  │  ZMIND_API_KEY (留空跳过)').Trim()

    Write-Host ''
    Write-Host '  ┌─ OpenGrok' -ForegroundColor Cyan
    Write-Host '  │  公司分配的共享只读账号' -ForegroundColor Gray
    $ogUser = (Read-Host '  │  OPENGROK_USERNAME (留空跳过)').Trim()
    if ($ogUser) {
        $ogPassSecure = Read-Host '  │  OPENGROK_PASSWORD' -AsSecureString
        $ogPass = ConvertTo-PlainText -Secure $ogPassSecure
    }

    Write-Host ''
    Write-Host '  ┌─ Gerrit SSO（用于 refresh-auth 抓 cookie）' -ForegroundColor Cyan
    Write-Host '  │  全小写用户名（例 winn.wei）+ SSO 密码' -ForegroundColor Gray
    $gerritUser = (Read-Host '  │  Gerrit 用户名 (留空跳过)').Trim()
    if ($gerritUser) {
        $gerritPassSecure = Read-Host '  │  Gerrit 密码' -AsSecureString
        $gerritPass = ConvertTo-PlainText -Secure $gerritPassSecure
    }

    Write-Host ''
    Write-Host '  ┌─ Confluence（独立账号系统，跟 Gerrit SSO 不同）' -ForegroundColor Cyan
    Write-Host '  │  用户名首字母可能大写（例 Winn.Wei）+ 独立密码' -ForegroundColor Gray
    $confluenceUser = (Read-Host '  │  Confluence 用户名 (留空跳过)').Trim()
    if ($confluenceUser) {
        $confluencePassSecure = Read-Host '  │  Confluence 密码' -AsSecureString
        $confluencePass = ConvertTo-PlainText -Secure $confluencePassSecure
    }
    Write-Host ''
}

# ── 4. setup-creds.mjs 写 Zmind + OpenGrok ──────────────────────
Write-Host '[4/5] 写入 Zmind / OpenGrok 凭据到 ~/.kiro/settings/mcp.json...' -ForegroundColor Yellow

if ($SkipCredsSetup) {
    Write-Host '  - 跳过（-SkipCredsSetup）' -ForegroundColor Yellow
}
elseif (-not $zmindKey -and -not $ogUser) {
    Write-Host '  - Zmind / OpenGrok 凭据均未提供，跳过 setup-creds' -ForegroundColor Yellow
}
else {
    $env:ZMIND_API_KEY = $zmindKey
    $env:OPENGROK_USERNAME = $ogUser
    $env:OPENGROK_PASSWORD = $ogPass
    try {
        & node (Join-Path $scriptRoot 'setup-creds.mjs')
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ✗ setup-creds 退出码 $LASTEXITCODE" -ForegroundColor Red
        }
    }
    finally {
        $env:ZMIND_API_KEY = $null
        $env:OPENGROK_USERNAME = $null
        $env:OPENGROK_PASSWORD = $null
    }
}

# ── 5. refresh-auth.mjs 抓 Gerrit + Confluence cookie ───────────
Write-Host ''
Write-Host '[5/5] 抓 Gerrit + Confluence cookie...' -ForegroundColor Yellow

if ($SkipAuthRefresh) {
    Write-Host '  - 跳过（-SkipAuthRefresh）；记得后续手动跑 scripts\refresh-auth.ps1' -ForegroundColor Yellow
}
elseif (-not $gerritUser) {
    Write-Host '  - Gerrit 凭据未提供，跳过 refresh-auth' -ForegroundColor Yellow
    Write-Host '    后续手动跑：scripts\refresh-auth.ps1' -ForegroundColor Gray
}
else {
    $env:WHALE_USER = $gerritUser
    $env:WHALE_PASSWORD = $gerritPass
    if ($confluenceUser) {
        $env:CONFLUENCE_USER = $confluenceUser
        $env:CONFLUENCE_PASSWORD = $confluencePass
    }
    try {
        & node (Join-Path $scriptRoot 'refresh-auth.mjs')
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ✗ refresh-auth 退出码 $LASTEXITCODE" -ForegroundColor Red
            Write-Host '    可稍后手动跑：scripts\refresh-auth.ps1' -ForegroundColor Gray
        }
    }
    finally {
        $env:WHALE_USER = $null
        $env:WHALE_PASSWORD = $null
        $env:CONFLUENCE_USER = $null
        $env:CONFLUENCE_PASSWORD = $null
    }
}

# 清明文密码
if ($ogPass) { $ogPass = $null }
if ($gerritPass) { $gerritPass = $null }
if ($confluencePass) { $confluencePass = $null }
[System.GC]::Collect()

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  setup-v2 完成。重启 Kiro 让新凭据生效。' -ForegroundColor Green
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''
Write-Host '后续命令：' -ForegroundColor White
Write-Host '  • cookie 过期（401） → scripts\refresh-auth.ps1' -ForegroundColor Gray
Write-Host '  • 更新 Zmind/OpenGrok 凭据 → 重跑 scripts\setup-v2.ps1（仅填要改的）' -ForegroundColor Gray
Write-Host '  • 首次同步知识库 → 在 Kiro 内说："用 sync_zmind 拉 1000 条；用 embed_pending 处理 zmind"' -ForegroundColor Gray
Write-Host '  • 一键 PR/Bug 分析 → "用 analyze_issue 分析 #<ID>"' -ForegroundColor Gray
Write-Host ''

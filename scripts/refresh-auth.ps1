# refresh-auth.ps1 — Windows PowerShell 壳，调用 refresh-auth.mjs
#
# 职责：
#   1. 用 Read-Host -AsSecureString 隐藏密码输入
#   2. 检查 Node + Playwright 已安装；缺失给安装命令
#   3. 通过环境变量 WHALE_USER / WHALE_PASSWORD 透传给 .mjs（避免子进程二次提示）
#
# 使用：
#   PowerShell -ExecutionPolicy Bypass -File scripts\refresh-auth.ps1
#   （第一次跑：会提示先在 scripts/ 跑 npm install 与 playwright install）
#
# 兼容：PowerShell 5.1+ / PowerShell 7+

[CmdletBinding()]
param(
    [string]$User,
    [switch]$NoSelfInstall  # 跳过自动安装 playwright（适合 CI）
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$mjs = Join-Path $scriptRoot 'refresh-auth.mjs'
$pkgJson = Join-Path $scriptRoot 'package.json'
$nodeModules = Join-Path $scriptRoot 'node_modules'

if (-not (Test-Path -LiteralPath $mjs)) {
    Write-Error "找不到 $mjs"
    exit 1
}

# ── 1. 检查 Node ──
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[refresh-auth] 未检测到 Node.js。请安装 Node 18+ 后重试。" -ForegroundColor Red
    Write-Host "  推荐: https://nodejs.org/ 或 winget install OpenJS.NodeJS"
    exit 1
}

# ── 2. 检查 scripts/ 下的 Playwright ──
$needInstall = $false
if (-not (Test-Path -LiteralPath $nodeModules)) {
    $needInstall = $true
}
elseif (-not (Test-Path -LiteralPath (Join-Path $nodeModules 'playwright'))) {
    $needInstall = $true
}

if ($needInstall -and -not $NoSelfInstall) {
    Write-Host "[refresh-auth] scripts/node_modules 缺失，自动安装 playwright..." -ForegroundColor Yellow
    Push-Location $scriptRoot
    try {
        & node (Join-Path $env:APPDATA 'npm\node_modules\npm\bin\npm-cli.js') install --no-audit --no-fund 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            # 回退到普通 npm 调用
            & npm install --no-audit --no-fund 2>&1 | Out-Host
        }
        if ($LASTEXITCODE -ne 0) {
            throw "npm install 失败 (exit $LASTEXITCODE)"
        }
    }
    catch {
        Write-Host "[refresh-auth] 自动安装失败：$_" -ForegroundColor Red
        Write-Host "请手动在 $scriptRoot 下运行：" -ForegroundColor Yellow
        Write-Host "  npm install"
        Write-Host "  npx playwright install chromium"
        Pop-Location
        exit 1
    }
    Pop-Location
}
elseif ($needInstall) {
    Write-Host "[refresh-auth] -NoSelfInstall 启用但 playwright 未安装，跳过安装。脚本将失败。" -ForegroundColor Yellow
}

# ── 3. 收集凭据 ──
if (-not $User -and -not $env:WHALE_USER) {
    $User = Read-Host '请输入 SSO 用户名 (例: winn.wei)'
}
if ($User) {
    $env:WHALE_USER = $User
}

if (-not $env:WHALE_PASSWORD) {
    $secure = Read-Host '请输入 SSO 密码（输入时不回显）' -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $env:WHALE_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

# 文档中心是独立账号系统（form login，不走 SSO），单独收集凭据
# 跳过则只刷新 Gerrit
if (-not $env:CONFLUENCE_USER) {
    $confUser = Read-Host '请输入 Confluence 用户名（独立账号，不同于 SSO；留空跳过）'
    if ($confUser) { $env:CONFLUENCE_USER = $confUser }
}
if ($env:CONFLUENCE_USER -and -not $env:CONFLUENCE_PASSWORD) {
    $confSecure = Read-Host '请输入 Confluence 密码（输入时不回显）' -AsSecureString
    $confBstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($confSecure)
    try {
        $env:CONFLUENCE_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($confBstr)
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confBstr)
    }
}

# ── 4. 调用 .mjs ──
try {
    & node $mjs
    $exit = $LASTEXITCODE
}
finally {
    # 立即清空进程级密码环境变量（防止本进程后续步骤泄漏）
    Remove-Item Env:\WHALE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\CONFLUENCE_PASSWORD -ErrorAction SilentlyContinue
}

exit $exit

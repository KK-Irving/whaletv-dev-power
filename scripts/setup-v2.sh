#!/usr/bin/env bash
# setup-v2.sh — Linux/macOS 一键部署脚本（v2 onboarding 主入口）
#
# 流程：
#   1. 检查依赖（Node ≥ 22.5、unar/7z 可选）
#   2. 安装 Playwright + Chromium（用于 refresh-auth）
#   3. 交互收集 4 套凭据（Zmind API Key / OpenGrok / Gerrit SSO / Confluence）
#   4. 调 setup-creds.mjs 写 Zmind + OpenGrok
#   5. 调 refresh-auth.mjs 抓 Gerrit + Confluence cookie
#
# 安全：
#   - 密码用 read -s 收集（不回显），仅驻留进程内存，调子脚本后清空
#
# 用法：
#   bash scripts/setup-v2.sh
#   bash scripts/setup-v2.sh --skip-auth-refresh --skip-playwright-install --skip-creds-setup

set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

SKIP_AUTH=0
SKIP_PW=0
SKIP_CREDS=0
for arg in "$@"; do
    case "$arg" in
        --skip-auth-refresh) SKIP_AUTH=1 ;;
        --skip-playwright-install) SKIP_PW=1 ;;
        --skip-creds-setup) SKIP_CREDS=1 ;;
    esac
done

echo
echo "════════════════════════════════════════════════════════════"
echo "  whaletv-dev-power v2 setup"
echo "════════════════════════════════════════════════════════════"
echo

# 凭据变量
ZMIND_API_KEY=""
OPENGROK_USERNAME=""
OPENGROK_PASSWORD=""
GERRIT_USER=""
GERRIT_PASS=""
CONFLUENCE_USER=""
CONFLUENCE_PASS=""

# ── 1. 依赖检查 ─────────────────────────────────────────────────
echo "[1/5] 检查系统依赖..."

if ! command -v node >/dev/null 2>&1; then
    echo "  ✗ Node.js 未安装" >&2
    echo "    请安装 Node.js ≥ 22.5.0：https://nodejs.org/" >&2
    exit 1
fi
NODE_VERSION="$(node --version | sed 's/^v//')"
NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"
NODE_MINOR="$(echo "$NODE_VERSION" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
    echo "  ✗ Node.js $NODE_VERSION 太旧（需要 ≥ 22.5.0；knowledge-mcp 用 node:sqlite 内置模块）" >&2
    exit 1
fi
echo "  ✓ Node.js $NODE_VERSION"

if command -v unar >/dev/null 2>&1; then
    echo "  ✓ unar (推荐用于 RAR5 解压)"
elif command -v 7z >/dev/null 2>&1; then
    echo "  ⚠ unar 未安装；7z 可作 fallback"
    if [ "$(uname)" = "Darwin" ]; then
        echo "    建议: brew install unar"
    else
        echo "    建议: apt install unar"
    fi
else
    echo "  ⚠ unar / 7z 都未安装"
    if [ "$(uname)" = "Darwin" ]; then
        echo "    建议: brew install unar p7zip"
    else
        echo "    建议: apt install unar p7zip-full"
    fi
fi

# ── 2. Playwright + Chromium ───────────────────────────────────
echo
echo "[2/5] 安装 scripts/ 依赖（Playwright + Chromium）..."

if [ "$SKIP_PW" = "1" ]; then
    echo "  - 跳过（--skip-playwright-install）"
else
    (
        cd "$SCRIPT_DIR"
        if ! command -v npm >/dev/null 2>&1; then
            echo "  ✗ 找不到 npm" >&2
            exit 1
        fi
        echo "  执行: npm install ..."
        if npm install --no-audit --no-fund; then
            echo "  ✓ Playwright 已安装"
        else
            echo "  ✗ npm install 失败" >&2
            echo "    请手动跑：cd scripts && npm install && npx playwright install chromium" >&2
        fi
    )
fi

# ── 3. 收集 4 套凭据 ───────────────────────────────────────────
echo
echo "[3/5] 收集凭据（4 套独立账号 — 一次性配置完，永久 + 1-4 周刷 cookie）"
echo

if [ "$SKIP_CREDS" = "1" ]; then
    echo "  - 跳过（--skip-creds-setup）"
else
    echo "  ┌─ Zmind"
    echo "  │  https://zmind.whaletv.com → 我的账户 → API 访问密钥（40 位十六进制）"
    printf '  │  ZMIND_API_KEY (留空跳过): '
    read -r ZMIND_API_KEY

    echo
    echo "  ┌─ OpenGrok"
    echo "  │  公司分配的共享只读账号"
    printf '  │  OPENGROK_USERNAME (留空跳过): '
    read -r OPENGROK_USERNAME
    if [ -n "$OPENGROK_USERNAME" ]; then
        printf '  │  OPENGROK_PASSWORD: '
        read -rs OPENGROK_PASSWORD; echo
    fi

    echo
    echo "  ┌─ Gerrit SSO（用于 refresh-auth 抓 cookie）"
    echo "  │  全小写用户名（例 winn.wei）+ SSO 密码"
    printf '  │  Gerrit 用户名 (留空跳过): '
    read -r GERRIT_USER
    if [ -n "$GERRIT_USER" ]; then
        printf '  │  Gerrit 密码: '
        read -rs GERRIT_PASS; echo
    fi

    echo
    echo "  ┌─ Confluence（独立账号系统，跟 Gerrit SSO 不同）"
    echo "  │  用户名首字母可能大写（例 Winn.Wei）+ 独立密码"
    printf '  │  Confluence 用户名 (留空跳过): '
    read -r CONFLUENCE_USER
    if [ -n "$CONFLUENCE_USER" ]; then
        printf '  │  Confluence 密码: '
        read -rs CONFLUENCE_PASS; echo
    fi
    echo
fi

# ── 4. setup-creds.mjs 写 Zmind + OpenGrok ─────────────────────
echo "[4/5] 写入 Zmind / OpenGrok 凭据到 ~/.kiro/settings/mcp.json..."

if [ "$SKIP_CREDS" = "1" ]; then
    echo "  - 跳过（--skip-creds-setup）"
elif [ -z "$ZMIND_API_KEY" ] && [ -z "$OPENGROK_USERNAME" ]; then
    echo "  - Zmind / OpenGrok 凭据均未提供，跳过 setup-creds"
else
    ZMIND_API_KEY="$ZMIND_API_KEY" \
    OPENGROK_USERNAME="$OPENGROK_USERNAME" \
    OPENGROK_PASSWORD="$OPENGROK_PASSWORD" \
    node "$SCRIPT_DIR/setup-creds.mjs" || \
        echo "  ✗ setup-creds 失败"
fi

# ── 5. refresh-auth.mjs 抓 Gerrit + Confluence cookie ──────────
echo
echo "[5/5] 抓 Gerrit + Confluence cookie..."

if [ "$SKIP_AUTH" = "1" ]; then
    echo "  - 跳过（--skip-auth-refresh）；记得后续手动跑 bash scripts/refresh-auth.sh"
elif [ -z "$GERRIT_USER" ]; then
    echo "  - Gerrit 凭据未提供，跳过 refresh-auth"
    echo "    后续手动跑：bash scripts/refresh-auth.sh"
else
    WHALE_USER="$GERRIT_USER" \
    WHALE_PASSWORD="$GERRIT_PASS" \
    CONFLUENCE_USER="$CONFLUENCE_USER" \
    CONFLUENCE_PASSWORD="$CONFLUENCE_PASS" \
    node "$SCRIPT_DIR/refresh-auth.mjs" || \
        echo "  ✗ refresh-auth 失败"
fi

# 清密码变量
unset ZMIND_API_KEY OPENGROK_PASSWORD GERRIT_PASS CONFLUENCE_PASS

echo
echo "════════════════════════════════════════════════════════════"
echo "  setup-v2 完成。重启 Kiro 让新凭据生效。"
echo "════════════════════════════════════════════════════════════"
echo
echo "后续命令："
echo "  • cookie 过期（401） → bash scripts/refresh-auth.sh"
echo "  • 更新 Zmind/OpenGrok 凭据 → 重跑 bash scripts/setup-v2.sh（仅填要改的）"
echo "  • 首次同步知识库 → 在 Kiro 内说：'用 sync_zmind 拉 1000 条；用 embed_pending 处理 zmind'"
echo "  • 一键 PR/Bug 分析 → '用 analyze_issue 分析 #<ID>'"
echo

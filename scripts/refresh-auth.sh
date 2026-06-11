#!/usr/bin/env bash
# refresh-auth.sh — Linux/macOS Bash 壳，调用 refresh-auth.mjs
#
# 职责：
#   1. 用 read -s 隐藏密码输入
#   2. 检查 Node + Playwright 已安装；缺失给安装命令
#   3. 通过环境变量 WHALE_USER / WHALE_PASSWORD 透传给 .mjs
#
# 使用：
#   bash scripts/refresh-auth.sh           # 交互模式
#   WHALE_USER=foo WHALE_PASSWORD=bar bash scripts/refresh-auth.sh   # 非交互
#
# 兼容：bash 4+；macOS 自带 bash 3.2 也能跑

set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
MJS="$SCRIPT_DIR/refresh-auth.mjs"

if [ ! -f "$MJS" ]; then
    echo "[refresh-auth] 找不到 $MJS" >&2
    exit 1
fi

NO_SELF_INSTALL=0
for arg in "$@"; do
    case "$arg" in
        --no-self-install) NO_SELF_INSTALL=1 ;;
        --user=*) WHALE_USER="${arg#--user=}" ;;
    esac
done

# ── 1. 检查 Node ──
if ! command -v node >/dev/null 2>&1; then
    echo "[refresh-auth] 未检测到 Node.js。请安装 Node 18+ 后重试。" >&2
    echo "  推荐: https://nodejs.org/ 或 brew install node / apt install nodejs" >&2
    exit 1
fi

# ── 2. 检查 Playwright 是否已装 ──
NEED_INSTALL=0
if [ ! -d "$SCRIPT_DIR/node_modules" ] || [ ! -d "$SCRIPT_DIR/node_modules/playwright" ]; then
    NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" = "1" ] && [ "$NO_SELF_INSTALL" != "1" ]; then
    echo "[refresh-auth] scripts/node_modules 缺失，自动安装 playwright..."
    (
        cd "$SCRIPT_DIR"
        if ! command -v npm >/dev/null 2>&1; then
            echo "[refresh-auth] 找不到 npm 命令；请安装 Node.js 自带的 npm" >&2
            exit 1
        fi
        npm install --no-audit --no-fund
    )
elif [ "$NEED_INSTALL" = "1" ]; then
    echo "[refresh-auth] --no-self-install 启用但 playwright 未安装，将失败。" >&2
fi

# ── 3. 收集凭据 ──
if [ -z "${WHALE_USER:-}" ]; then
    printf '请输入 SSO 用户名 (例: winn.wei): '
    IFS= read -r WHALE_USER
    export WHALE_USER
fi

if [ -z "${WHALE_PASSWORD:-}" ]; then
    printf '请输入 SSO 密码（输入时不回显）: '
    IFS= read -r -s WHALE_PASSWORD
    echo  # 换行
    export WHALE_PASSWORD
fi

# 文档中心是独立账号系统（form login，不走 SSO），单独收集凭据
# 跳过则只刷新 Gerrit
if [ -z "${CONFLUENCE_USER:-}" ]; then
    printf '请输入 Confluence 用户名（独立账号，不同于 SSO；留空跳过）: '
    IFS= read -r CONFLUENCE_USER
    export CONFLUENCE_USER
fi
if [ -n "${CONFLUENCE_USER:-}" ] && [ -z "${CONFLUENCE_PASSWORD:-}" ]; then
    printf '请输入 Confluence 密码（输入时不回显）: '
    IFS= read -r -s CONFLUENCE_PASSWORD
    echo
    export CONFLUENCE_PASSWORD
fi

# ── 4. 调用 .mjs ──
trap 'unset WHALE_PASSWORD; unset CONFLUENCE_PASSWORD' EXIT
node "$MJS"
exit $?

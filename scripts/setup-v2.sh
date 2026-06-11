#!/usr/bin/env bash
# setup-v2.sh — Linux/macOS 一键部署脚本
#
# 功能：
#   1. 检查依赖（Node ≥ 22.5、unar/7z 可选）
#   2. 安装 Playwright + Chromium（用于 refresh-auth）
#   3. 提示首次抓取 Gerrit + Confluence 凭据
#
# 用法：
#   bash scripts/setup-v2.sh
#   bash scripts/setup-v2.sh --skip-auth-refresh --skip-playwright-install

set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

SKIP_AUTH=0
SKIP_PW=0
for arg in "$@"; do
    case "$arg" in
        --skip-auth-refresh) SKIP_AUTH=1 ;;
        --skip-playwright-install) SKIP_PW=1 ;;
    esac
done

echo
echo "════════════════════════════════════════════════════════════"
echo "  whaletv-dev-power v2 setup"
echo "════════════════════════════════════════════════════════════"
echo

# ── 1. 依赖检查 ─────────────────────────────────────────────────
echo "[1/4] 检查系统依赖..."

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
echo "[2/4] 安装 scripts/ 依赖（Playwright + Chromium）..."

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

# ── 3. 凭据自动刷新 ────────────────────────────────────────────
echo
echo "[3/4] 凭据配置（refresh-auth）"

if [ "$SKIP_AUTH" = "1" ]; then
    echo "  - 跳过（--skip-auth-refresh）；记得后续手动跑 bash scripts/refresh-auth.sh"
else
    printf '现在跑 refresh-auth 抓取 Gerrit + Confluence cookie 吗？(Y/n) '
    read -r answer
    case "$answer" in
        n|N|no|No)
            echo "  - 跳过；记得后续手动跑 bash scripts/refresh-auth.sh"
            ;;
        *)
            bash "$SCRIPT_DIR/refresh-auth.sh" --no-self-install || \
                echo "  ✗ refresh-auth 失败。可稍后手动跑 bash scripts/refresh-auth.sh"
            ;;
    esac
fi

# ── 4. 提示其他必填字段 ────────────────────────────────────────
echo
echo "[4/4] 还需手动配置以下凭据到 ~/.kiro/settings/mcp.json："
echo
echo "  [zmind-mcp-server]"
echo "    ZMIND_API_KEY      = (登录 zmind.whaletv.com → 我的账户 → API 访问密钥)"
echo
echo "  [opengrok-mcp-server]"
echo "    OPENGROK_USERNAME  = (公司分配的 OpenGrok 账号)"
echo "    OPENGROK_PASSWORD  = (对应密码)"
echo
echo "  [knowledge-mcp-server] 复用上面凭据；首次跑 sync_zmind/sync_gerrit 后"
echo "  自动下载 BGE-small-zh ONNX 模型到 ./data/models/（~80MB，1-3 分钟）"
echo

echo "════════════════════════════════════════════════════════════"
echo "  setup-v2 完成。重启 Kiro 让新凭据生效。"
echo "════════════════════════════════════════════════════════════"
echo
echo "后续命令："
echo "  • cookie 过期 → bash scripts/refresh-auth.sh"
echo "  • 首次同步知识库 → 在 Kiro 内说：'用 sync_zmind 拉 1000 条；用 embed_pending 处理 zmind'"
echo "  • 一键 PR/Bug 分析 → '用 analyze_issue 分析 #<ID>'"
echo

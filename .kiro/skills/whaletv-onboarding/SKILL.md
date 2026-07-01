---
name: whaletv-onboarding
description: |
  WhaleTV Developer Power 首次配置引导（v3 单一凭据源架构）。TRIGGERS: "配置" / "setup" / "初始化" / "install power" / "first time" / 用户首次激活 Power / 遇到 "credentials missing" 报错。四步：部署资源 (deploy.mjs) → 收集凭据到 SoT (~/.ai/whaletv.yaml) → 抓 Gerrit+Confluence cookie (refresh-auth) → 验证。Use this skill whenever the user needs to bootstrap the Power for the first time or migrate from v2 mcp.json to v3 SoT. Do NOT use when user only wants to refresh cookies (use whaletv-auth-refresh) or query a specific credential value (just run whaletv-credentials get).
---

# 首次配置引导流程（v3）

## 触发场景

用户首次激活 Power（点击 "Try Power"）或输入"配置"、"setup"、"初始化"等关键词时。

## v3 单一凭据源架构

**v3 起，所有凭据都统一保存在 `~/.ai/whaletv.yaml`**（Single Source of Truth，SoT）。5 个 MCP server 启动时通过 `sot-loader` 读取，无需在 `mcp.json` 里维护 4 份重复的 env。

- **SoT 位置**：`~/.ai/whaletv.yaml`（Windows: `%USERPROFILE%\.ai\whaletv.yaml`）
- **权限**：Linux/macOS 自动 chmod 0600
- **读取工具**：`whaletv-credentials get <dotted.key>`（安装 deploy 后 PATH 里可直接调用）
- **改一处全生效**：一次修改 SoT，5 个 MCP server 全部拿到新值

**MCP server 内部 `sot-loader` 的兼容性设计**：env 优先 —— 如果 `mcp.json` 里已有非空的 env，SoT 不覆盖。这样：
- v2 老用户 mcp.json 里已填 env → 继续工作，无感
- v3 新用户 mcp.json env 为空 / 未设置 → SoT 值填入
- 混合模式也支持

## 关键约束（AI 必读）

### ⚠️ AI 不能直接写 `~/.kiro/settings/mcp.json` 或 `~/.ai/whaletv.yaml`

Kiro IDE 安全限制：AI 只能编辑当前 workspace 内的文件。SoT 和 mcp.json 都在 workspace 外。

**正确做法**：让用户在终端跑 `node scripts/whaletv-credentials.mjs init` 或 `scripts/refresh-auth.{ps1,sh}`。脚本本身没有 workspace 限制，可以写到任意路径。AI 只负责**收集凭据 + 给出运行命令**，不直接 fs 写入。

### ⚠️ Kiro Power namespace 兼容（v3 起大幅简化）

v2 依赖 mcp.json 时，key 前缀 `power-<powername>-` 是个大问题（要 substring 匹配 + 双写）。**v3 起 MCP server 直接从 SoT 读凭据**，与 mcp.json 里的 key 名无关，天然兼容 Kiro Power 的任何 namespace 结构。

`refresh-auth.mjs` / `setup-creds.mjs` 依然保留 mcp.json 双写（默认在 mcp.json 已存在时自动启用），供还没升到 v3 dist 的场景兜底。

## 凭据矩阵（4 套独立账号）

| 系统 | 用户名 | 凭据形式 | 维护方式 |
|---|---|---|---|
| **Zmind** | — | API Key（40 位十六进制） | `setup-creds.mjs` 写入，永久 |
| **Gerrit SSO** | 全小写（如 `winn.wei`） | SSO 密码 | `refresh-auth.{ps1,sh}` 抓 cookie，1-4 周刷新一次 |
| **Confluence** | 首字母大写（如 `Winn.Wei`） | 独立密码（**不同于 SSO**） | `refresh-auth.{ps1,sh}` form login 抓 cookie |
| **OpenGrok** | 共享只读账号 | 共享密码 | `setup-creds.mjs` 写入，永久 |

注意：Gerrit / Confluence 是两套**完全独立**的账号系统，用户名首字母大小写都可能不同；refresh-auth 会分别 prompt。

## 引导流程（v3 标准 — 部署 → 收集 → 抓 cookie → 验证）

### 步骤 ①：一键部署资源（新增，v3）

让用户在终端跑 `deploy.mjs` 把 steering / hooks / skills 同步到 `~/.kiro/` 并把 `bin/` 加入 PATH：

**Windows PowerShell / cmd**：

```powershell
node scripts\deploy.mjs
```

**Linux / macOS**：

```bash
node scripts/deploy.mjs
```

`deploy.mjs` 会：
- **备份**已有 `.kiro/` 到 `.kiro.backup-<ts>/`（保留最近 3 份）
- 部署 12 份 steering / 7 个 hook JSON（含 Kiro schema 校验）/ 9 份 skill
- 把 `<repo>/bin/` 加入 PATH（marker block 幂等，迁移时自动更新）
- 检测 Kiro 是否在跑，若在跑则拒绝写入

**dry-run 模式**：`node scripts/deploy.mjs --dry-run` 只打印动作、不写入，用户可以先看再决定。

如果用户已经在 v2 用 Kiro Power 安装了，这一步可选（Power 自动加载 steering）；但对于**非 Power 场景 / workspace 级部署 / 跨机器同步**，deploy.mjs 是主入口。

### 步骤 ②：收集 4 套凭据并写入 SoT

AI 一次性向用户问清楚 4 套凭据：

```
为了一次性配置好 5 个 MCP server，我需要收集 4 套独立账号信息：

1. Zmind API Key（40 位十六进制）
   登录 https://zmind.whaletv.com → 我的账户 → API 访问密钥 → 复制

2. OpenGrok 账号密码
   公司分配的共享只读账号

3. Gerrit SSO 账号密码
   登录 https://whale-gerrit.zeasn.com 用的 SSO 用户名（全小写，例 winn.wei）+ 密码

4. Confluence 账号密码
   登录 https://docs.whaletv.com 用的独立账号（用户名首字母可能大写，例 Winn.Wei）+ 密码
   注：跟 Gerrit SSO 是两套不同账号

请按以上 4 项依次提供（可以一次贴完）。
```

收到后 **不要在对话里复述完整凭据**，更不要写到任何文件。凭据通过环境变量或交互式输入传给脚本。

**方式 A：交互式（推荐给首次配置）**

```powershell
# Windows / Linux / macOS 都一样
node scripts\whaletv-credentials.mjs init
```

`whaletv-credentials init` 会：
- 依次交互式收集 Zmind / OpenGrok / Gerrit basic / Confluence 凭据（每个都可 Enter 跳过）
- 写入 `~/.ai/whaletv.yaml`（Linux/macOS 自动 chmod 0600）
- 保留占位符供后续 `set` 命令补齐

**方式 B：环境变量 + setup-creds.mjs（脚本化推荐）**

```powershell
# Windows PowerShell
$env:ZMIND_API_KEY="<填>"; $env:OPENGROK_USERNAME="<填>"; $env:OPENGROK_PASSWORD="<填>"
node scripts/setup-creds.mjs
```

```bash
# Linux / macOS
ZMIND_API_KEY='<填>' OPENGROK_USERNAME='<填>' OPENGROK_PASSWORD='<填>' \
  node scripts/setup-creds.mjs
```

**方式 C：v2 迁移（老用户）**

如果用户已经有 `~/.kiro/settings/mcp.json` 且填过 env：

```bash
node scripts/whaletv-credentials.mjs migrate
```

一次性把 mcp.json 里的 env 迁移到 SoT。之后再跑 refresh-auth 补 cookie。

### 步骤 ③：抓 Gerrit + Confluence cookie 到 SoT

跑 `refresh-auth.{ps1,sh}`（v3 起自动写 SoT，同时兼容双写 mcp.json）：

**Windows**：

```powershell
PowerShell -ExecutionPolicy Bypass -File scripts\refresh-auth.ps1
```

**Linux/macOS**：

```bash
bash scripts/refresh-auth.sh
```

脚本会：
- 提示输入 Gerrit SSO 用户名 + 密码（密码不回显、不落盘、不入日志）
- 提示输入 Confluence 用户名 + 密码（独立账号）
- Playwright headless Chromium 走 nginx Basic + Gerrit SAML SSO，抓 `GerritAccount` / `XSRF_TOKEN` cookie
- 同样流程走 Confluence form POST `/dologin.action`，抓 `JSESSIONID` / `seraph.confluence` cookie
- 自检：用新凭据 GET `/changes/?n=1`，必须 200 才算成功
- **写入 `~/.ai/whaletv.yaml`**：`gerrit.auth_header` + `gerrit.cookie` + `confluence.cookie`
- 如果 mcp.json 已存在，**自动双写**（可用 `--sot-only` 关闭；也可显式 `--legacy-mcp-json` 强制启用）

### 步骤 ④：重启 Kiro 加载新凭据

让用户：
1. 在 Kiro 内 ⌘/Ctrl+Shift+P → `Reload Window`
2. 或者退出 Kiro 重开

MCP server 启动时 `sot-loader` 打印 `[sot-loader] 从 ~/.ai/whaletv.yaml 注入 X 个环境变量：...`，可以查 stderr 日志确认。

### 步骤 ⑤：验证连接

AI 调用各 MCP 工具实际连一下：

| 工具 | 期望结果 |
|---|---|
| `list_projects`（zmind） | 返回项目列表 |
| `search_changes`（gerrit）`q="status:open" limit=1` | 返回 JSON（首行 `)]}'` 后跟 changes） |
| `list_spaces`（confluence） | 返回 spaces 数组（**若 403 → 账号无权限，运维侧问题**，详见下面 Confluence 权限说明） |
| `search_code`（opengrok）`query="test" maxresults=1` | 返回结果 |
| `sync_zmind`（knowledge）`limit=10` + `embed_pending` `source="zmind"` | 入库 10 条 + 嵌入完成 |

### 步骤 ⑥：项目-代码映射 + 配置总结

AI 调 `list_projects` 把用户可见的 Zmind 项目展示出来，让用户给出代码路径映射：

```
✅ 配置完成！

系统连接状态：
✅ Zmind — 已连接（API Key 有效）
✅ Gerrit — session 模式（cookie 模式有效，过 nginx 双层认证）
✅ Confluence — cookie 模式有效（list_spaces 通）
✅ OpenGrok — 代码搜索可用（d4_code / stb16_code / x5_code）
✅ Knowledge — 本地索引可用

请告诉我你常用的 Zmind 项目对应的本地代码路径：
- cultraview-dvb-amlogic-t950d4-2k-1g → ~/cvte_code/amlogic/
- stm-amlogic-t962d4-4k-1-5gb → ~/cvte_code/stm/

（可以只配常用的，后续随时补充）
```

记录映射后，告诉用户可以直接说自然语言：

- "查看我的待办" — 获取 Issue 列表
- "用 analyze_issue 分析 #334001" — v2 一键端到端 PR/Bug 分析
- "用 search_local 找'蓝牙连接异常'" — 跨源历史检索
- "把 #332669 cp 到 mp" — Cherry-Pick 同步
- "推送代码到 Gerrit" — push_to_gerrit + 处理评论

## Confluence 403 权限说明

某些 Confluence 工具（特别是 search / 批量 content API）需要 Atlassian 管理员开通权限。常见错误：

```
Error: Confluence HTTP 403: Not permitted to use confluence
```

这是**账号权限问题，不是配置问题**。即使 cookie 有效（能登录看 spaces），调用批量 content API 可能仍被拦。

**排查**：
1. 浏览器登录 https://docs.whaletv.com 是否能看到 spaces？
2. 直接访问 https://docs.whaletv.com/dosearchsite.action?queryString=test 能否搜索？
3. 若网页能搜但 API 403 → 账号缺 "Use Confluence" 或 "Search" 全局权限

**解决**：找运维加 Confluence 全局权限。客户端这边解决不了。

短期 workaround：依赖 confluence-mcp 仍可调 `get_page` 拉单页正文（如果对应空间有 read 权限），但不能用 `search_confluence` 全局搜。

## 网络诊断（连接失败时）

```bash
# DNS
nslookup whale-gerrit.zeasn.com
nslookup docs.whaletv.com
nslookup zmind.whaletv.com
nslookup opengrok.zeasn.com

# 端口
nc -zv whale-gerrit.zeasn.com 443 -w 5
nc -zv whale-gerrit.zeasn.com 29418 -w 5   # SSH 仅 push_to_gerrit 用
nc -zv docs.whaletv.com 443 -w 5

# 代理
echo $http_proxy $https_proxy
```

针对性建议：
- DNS 不通 → 检查 DNS 或 `/etc/hosts`
- 443 不通 → HTTPS 端口被拦截 / 需要代理
- 29418 不通 → SSH 端口被拦截，仅 `push_to_gerrit` 不可用，其他 13 个 REST 工具不受影响
- 端口通但 401/403 → 重跑 `scripts/refresh-auth.*` 抓新 cookie

## 失败回滚

`setup-creds.mjs` / `refresh-auth.mjs` 写入前都备份 mcp.json 到 `<path>.bak.<timestamp>`。

回滚：

```bash
cp ~/.kiro/settings/mcp.json.bak.<timestamp> ~/.kiro/settings/mcp.json
```

重启 Kiro 即可。

## 凭据存储位置（用于排错时手动检查）

### v3 主路径：`~/.ai/whaletv.yaml`

| 凭据 | SoT 键 |
|---|---|
| Zmind API Key | `zmind.api_key` |
| OpenGrok 用户名 | `opengrok.username` |
| OpenGrok 密码 | `opengrok.password` |
| Gerrit Authorization header | `gerrit.auth_header` |
| Gerrit Cookie | `gerrit.cookie` |
| Gerrit basic auth（备用） | `gerrit.username` + `gerrit.http_password` |
| Confluence Cookie | `confluence.cookie` |
| Confluence 独立账号 | `confluence.username` + `confluence.password` |
| S3（可选，供报告上传） | `s3_issue_analysis.access_key_id` 等 |

**读取命令**：`whaletv-credentials get <key>`（如 `whaletv-credentials get zmind.api_key`）
**列出所有键**：`whaletv-credentials list`（不显示值）
**校验完整性**：`whaletv-credentials check`

### v2 兼容路径：`~/.kiro/settings/mcp.json`

如果 SoT 里为空 / 未启用 v3 dist，MCP server 仍会从这里读 env：

| 凭据 | 字段 |
|---|---|
| Zmind API Key | `<server>.env.ZMIND_API_KEY` |
| OpenGrok 用户名 | `<server>.env.OPENGROK_USERNAME` |
| OpenGrok 密码 | `<server>.env.OPENGROK_PASSWORD` |
| Gerrit Authorization header | `<server>.env.GERRIT_AUTH_HEADER` |
| Gerrit Cookie | `<server>.env.GERRIT_COOKIE` |
| Confluence Cookie | `<server>.env.CONFLUENCE_COOKIE` |

`<server>` 形如 `zmind-mcp-server`、`power-whaletv-dev-power-zmind-mcp-server`、`powers.mcpServers.power-whaletv-dev-power-zmind-mcp-server` 三种之一（取决于 Kiro 安装方式）。

**v3 起 sot-loader 使这个 namespace 兼容问题消失**：env 优先规则确保 SoT 值只在 env 为空时才注入，无论 key 名如何。

## 后续补充配置

用户随时可以：
- "补充配置" / "添加项目映射" — 更新代码路径映射
- "cookie 又过期了" — 重跑 `refresh-auth.{ps1,sh}` 抓新 cookie（自动写 SoT + 双写 mcp.json）
- "更新 OpenGrok 密码" — `whaletv-credentials set opengrok.password '<新密码>'`
- "更新 Zmind API Key" — `whaletv-credentials set zmind.api_key '<新 key>'`
- "查看当前配置" — `whaletv-credentials list` / `whaletv-credentials check`

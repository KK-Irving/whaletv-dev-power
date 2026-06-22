---
inclusion: auto
---

# 首次配置引导流程（v2）

## 触发场景

用户首次激活 Power（点击 "Try Power"）或输入"配置"、"setup"、"初始化"等关键词时。

## 关键约束（AI 必读）

### ⚠️ AI 不能直接写 `~/.kiro/settings/mcp.json`

Kiro IDE 安全限制：AI 只能编辑当前 workspace 内的文件。`~/.kiro/settings/mcp.json` 在 workspace 外，直接写会报：

```
Invalid path: c:\Users\xxx\.kiro\settings\mcp.json resolves to a location outside the workspace
```

**正确做法**：让用户在终端跑 `node scripts/setup-creds.mjs` 或 `scripts/refresh-auth.{ps1,sh}`。脚本本身没有 workspace 限制，可以写到任意路径。AI 只负责**收集凭据 + 给出运行命令**，不直接 fs 写入。

### ⚠️ Kiro Power namespace 兼容

Kiro 安装 Power 后，mcp 配置 key 会加 `power-<powername>-` 前缀（也可能在 `powers.mcpServers` 嵌套下）。`scripts/setup-creds.mjs` 与 `scripts/refresh-auth.mjs` 已实现 **substring 匹配 + 双写**：扫描所有以 server 名结尾的 key 全部更新；都不存在时同时创建本地路径和 Power 路径，覆盖两种安装方式。

## 凭据矩阵（4 套独立账号）

| 系统 | 用户名 | 凭据形式 | 维护方式 |
|---|---|---|---|
| **Zmind** | — | API Key（40 位十六进制） | `setup-creds.mjs` 写入，永久 |
| **Gerrit SSO** | 全小写（如 `winn.wei`） | SSO 密码 | `refresh-auth.{ps1,sh}` 抓 cookie，1-4 周刷新一次 |
| **Confluence** | 首字母大写（如 `Winn.Wei`） | 独立密码（**不同于 SSO**） | `refresh-auth.{ps1,sh}` form login 抓 cookie |
| **OpenGrok** | 共享只读账号 | 共享密码 | `setup-creds.mjs` 写入，永久 |

注意：Gerrit / Confluence 是两套**完全独立**的账号系统，用户名首字母大小写都可能不同；refresh-auth 会分别 prompt。

## 引导流程（v2 标准 — 收集 → 写入 → 抓 cookie → 验证）

### 步骤 ①：收集所有 4 套凭据

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

收到后 **不要在对话里复述完整凭据**，更不要写到任何文件。下一步靠环境变量传给脚本。

### 步骤 ②：用脚本一次性写入永久凭据

凭据收齐后，让用户在终端执行（注意密码含特殊字符要单引号）：

**Windows PowerShell**：

```powershell
$env:ZMIND_API_KEY="<填>"; $env:OPENGROK_USERNAME="<填>"; $env:OPENGROK_PASSWORD="<填>"
node scripts/setup-creds.mjs
```

**Linux/macOS**：

```bash
ZMIND_API_KEY='<填>' OPENGROK_USERNAME='<填>' OPENGROK_PASSWORD='<填>' \
  node scripts/setup-creds.mjs
```

`setup-creds.mjs` 会：
- 备份 `~/.kiro/settings/mcp.json` 到 `<path>.bak.<timestamp>`
- 扫描所有以 server 名结尾的 key（兼容 Kiro Power 与本地两种安装方式）
- 写入 `ZMIND_API_KEY`（同时给 zmind-mcp + knowledge-mcp）和 `OPENGROK_*`
- 输出"命中位置"日志（如 `mcpServers.power-whaletv-dev-power-zmind-mcp-server`）

**AI 通过 terminal 调用即可**，不需要直接写 mcp.json。

### 步骤 ③：抓 Gerrit + Confluence cookie

跑 `refresh-auth.{ps1,sh}` 让 Playwright 自动登录抓 cookie：

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
- 写入 `~/.kiro/settings/mcp.json`：`GERRIT_AUTH_HEADER` + `GERRIT_COOKIE` + `CONFLUENCE_COOKIE`，也覆盖 knowledge-mcp 的对应字段
- 命中所有相关 server key（含 Power namespace）

### 步骤 ④：重启 Kiro 加载新凭据

让用户：
1. 在 Kiro 内 ⌘/Ctrl+Shift+P → `Reload Window`
2. 或者退出 Kiro 重开

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

`~/.kiro/settings/mcp.json` 中 server entry 的 `env` 字段：

| 凭据 | 字段 |
|---|---|
| Zmind API Key | `<server>.env.ZMIND_API_KEY` |
| OpenGrok 用户名 | `<server>.env.OPENGROK_USERNAME` |
| OpenGrok 密码 | `<server>.env.OPENGROK_PASSWORD` |
| Gerrit Authorization header | `<server>.env.GERRIT_AUTH_HEADER` |
| Gerrit Cookie | `<server>.env.GERRIT_COOKIE` |
| Confluence Cookie | `<server>.env.CONFLUENCE_COOKIE` |

`<server>` 形如 `zmind-mcp-server`、`power-whaletv-dev-power-zmind-mcp-server`、`powers.mcpServers.power-whaletv-dev-power-zmind-mcp-server` 三种之一（取决于 Kiro 安装方式）。

## 后续补充配置

用户随时可以：
- "补充配置" / "添加项目映射" — 更新代码路径映射
- "cookie 又过期了" — 重跑 `refresh-auth.{ps1,sh}` 抓新 cookie
- "更新 OpenGrok 密码" — 重跑 `setup-creds.mjs`，只设 `OPENGROK_PASSWORD`
- "更新 Zmind API Key" — 重跑 `setup-creds.mjs`，只设 `ZMIND_API_KEY`

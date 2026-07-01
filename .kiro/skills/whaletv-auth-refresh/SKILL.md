---
name: whaletv-auth-refresh
description: |
  凭据自动刷新（Gerrit SSO + Confluence 独立账号 cookie，1-4 周过期时用）。TRIGGERS: "cookie 过期" / "refresh auth" / "401 cookie 已过期" / "302 → /login.action" / "auth_failed" / "gerrit 认证失败" / "刷新登录". 走 Playwright headless Chromium 抓 GerritAccount + XSRF_TOKEN + JSESSIONID cookie，写入 SoT + 双写 mcp.json 兜底。Use this skill when a Gerrit or Confluence MCP tool returns 401/302 and you suspect session cookie expiry. Do NOT use for first-time setup (use whaletv-onboarding) or for changing API keys/passwords (use whaletv-credentials set).
---

# 凭据自动刷新工作流

针对 Gerrit + 文档中心走 nginx + 应用层双层认证、cookie 通常 1-4 周过期的场景，提供一个一键刷新工具，避免每次手动 F12 抓凭据。

## 何时需要刷新

| 触发场景 | 表现 | 处理 |
|---|---|---|
| 首次配置 power | 任何 Gerrit/Confluence 工具调用都报 `config_error: 缺少必需的 Gerrit 环境变量` | 跑刷新脚本生成完整 env |
| cookie 过期（最常见） | Gerrit 工具突然返回 `401 cookie 已过期` | 跑刷新脚本 |
| 改了 SSO 密码 | 新密码后下一次刷新前会一直 401 | 跑刷新脚本（用新密码） |
| 切换账号 / 调试 | 想换一组凭据 | 跑刷新脚本，提示输 `WHALE_USER` 时填新账号 |

## 一键刷新命令

### Windows（PowerShell）

```powershell
# 在仓库根目录运行
PowerShell -ExecutionPolicy Bypass -File scripts\refresh-auth.ps1
```

首次运行会自动 `npm install` + `npx playwright install chromium`（约 150MB，仅首次）。后续刷新只需几秒。

### Linux / macOS

```bash
bash scripts/refresh-auth.sh
```

或加入可执行权限直接跑：

```bash
chmod +x scripts/refresh-auth.sh
./scripts/refresh-auth.sh
```

### 交互过程

1. 提示输入 SSO 用户名（例 `winn.wei`）+ SSO 密码（用于 Gerrit 走 nginx httpCredentials + Gerrit SSO 跳转）
2. 提示输入 Confluence 用户名（**独立账号，可与 SSO 不同**，例 `Winn.Wei` 首字母大写）+ Confluence 密码（留空跳过文档中心刷新）
3. 启动 headless Chromium 完成两段流程：
   - **Gerrit**：nginx Basic Auth 应答 401 → SSO 跳转 → 抓 `GerritAccount + XSRF_TOKEN` cookie
   - **Confluence**：访问 `/login.action` → POST `/dologin.action`（form login，独立账号体系）→ 抓 `JSESSIONID + acw_tc` cookie
4. 计算 `Authorization: Basic <SSO base64>` 字符串（仅 Gerrit 用）
5. 自检：用新 Gerrit 凭据 GET `/changes/?n=1` 必须 200
6. 备份 `~/.kiro/settings/mcp.json` 到 `mcp.json.bak.<时间戳>`
7. 深合并写入：
   - `gerrit-mcp-server.env.GERRIT_AUTH_HEADER` + `GERRIT_COOKIE`
   - `confluence-mcp-server.env.CONFLUENCE_COOKIE`（如有）
   - 其他配置原样保留

整个过程 < 30 秒（首次安装除外）。

> **重要**：Gerrit 与 Confluence 是**两套独立账号系统**：
> - Gerrit 走 SSO（公司单点登录，密码与 OA / 邮箱一致）
> - Confluence 走独立账号（首字母大小写可能不同；密码独立）
> 这是公司部署的现状，不是脚本设计选择。

## 非交互模式（CI / 定时任务）

通过环境变量传凭据，避免 prompt：

```bash
# 同时刷 Gerrit + Confluence
WHALE_USER=winn.wei \
WHALE_PASSWORD='Yg|hR0^UlMv<k}JvK@,wABAk9b' \
CONFLUENCE_USER=Winn.Wei \
CONFLUENCE_PASSWORD='9yPXrbBGjLE7s' \
bash scripts/refresh-auth.sh --no-self-install

# 只刷 Gerrit（Confluence 凭据留空就跳过）
WHALE_USER=winn.wei WHALE_PASSWORD='...' \
bash scripts/refresh-auth.sh --no-self-install
```

`--no-self-install` 跳过自动 `npm install`，CI 镜像里应预先装好。

PowerShell 等价命令：

```powershell
$env:WHALE_USER = 'winn.wei'
$env:WHALE_PASSWORD = '...'
$env:CONFLUENCE_USER = 'Winn.Wei'
$env:CONFLUENCE_PASSWORD = '...'
PowerShell -ExecutionPolicy Bypass -File scripts\refresh-auth.ps1 -NoSelfInstall
Remove-Item Env:\WHALE_PASSWORD
Remove-Item Env:\CONFLUENCE_PASSWORD
```

> **安全提示**：脚本不会把密码写入任何文件、不会回写到日志。但环境变量在父进程仍可见，跑完后请显式 `unset WHALE_PASSWORD CONFLUENCE_PASSWORD` / `Remove-Item Env:\*PASSWORD`。

## 退出码与排查

| 退出码 | 含义 | 排查 |
|---|---|---|
| 0 | 成功 | mcp.json 已更新 + 自检通过 |
| 1 | 用户输入失败 / 缺少凭据 | 重新跑并完整输入 |
| 2 | 浏览器登录失败 | 密码错 / SSO 跳转超时 / 检测到 MFA。看 stderr 详细原因 |
| 3 | mcp.json 文件操作失败 | 检查 `~/.kiro/settings/` 权限；如本次仅写入失败原文件已备份为 `.bak.<时间戳>` |
| 4 | 自检失败 | 用新凭据调 `/changes/` 仍不 200。检查 nginx 是否拒了 + GERRIT_URL 配置 |

## 常见问题

**Q: 我们 SSO 启用了 MFA（短信/动态码），脚本能跑吗？**  
A: 不能。脚本会检测到登录页 URL 含 `mfa/otp/2fa/verify/challenge` 关键字时主动失败，并提示走手动 F12 抓取。建议给 power 工具用单独的非 MFA 服务账号，或者用浏览器扩展自动同步 cookie。

**Q: Confluence 用户名和 SSO 用户名不一样吗？**  
A: 是的。公司部署：
- SSO（Gerrit / 公司 OA / 邮箱等）：`winn.wei`（小写）
- Confluence：`Winn.Wei`（首字母大写）+ 独立密码
两套**独立账号系统**，对应字段：`WHALE_USER` vs `CONFLUENCE_USER`、`WHALE_PASSWORD` vs `CONFLUENCE_PASSWORD`。脚本会分别 prompt。

**Q: 用 SSO 密码登录 Confluence 会发生什么？**  
A: 登录 form 接受任何凭据组合，但 Confluence 内部权限检查会发现这是无应用访问权限的"匿名/外部"用户，所有 REST API 调用返回 `permission_denied (HTTP 403, "Not permitted to use confluence")`。`/dosearchsite.action` 等 webaction 会被重定向到 `permissionViolation=true` 登录页。**必须用 Confluence 独立账号**。

**Q: PowerShell 执行策略报错（脚本无法运行）？**  
A: 脚本运行使用 `PowerShell -ExecutionPolicy Bypass -File ...` 一次性绕过当前会话，不影响系统全局策略。如要永久放开，管理员 PowerShell 跑 `Set-ExecutionPolicy RemoteSigned`。

**Q: macOS 提示 `unsigned/quarantined`？**  
A: 给 .sh 加可执行位后再跑：`chmod +x scripts/refresh-auth.sh`。

**Q: Playwright 下载 Chromium 太慢（中国大陆）？**  
A: 设置镜像后再装：
```bash
export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
cd scripts && npm install
```

**Q: 我已经有一份手抓的 cookie，能跳过 Playwright 直接写吗？**  
A: 直接编辑 `~/.kiro/settings/mcp.json` 的 `mcpServers.gerrit-mcp-server.env`，填 `GERRIT_AUTH_HEADER` 与 `GERRIT_COOKIE` 两个字段即可。Confluence 类似填 `mcpServers.confluence-mcp-server.env.CONFLUENCE_COOKIE`。脚本只是帮你自动化抓取这些字符串。

## 与 v1.x basic 模式的关系

如果你的部署没有 nginx 双层认证（直接打到 Gerrit），可以继续用 v1.x 的方式：在 `mcpServers.gerrit-mcp-server.env` 配 `GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD`，不必跑刷新脚本。

gerrit-mcp-server v1.1.0 启动时会输出当前模式：

```
[gerrit-mcp-server v1.1.0 REST] started (auth_mode=session)
[gerrit-mcp-server v1.1.0 REST] started (auth_mode=basic)
[gerrit-mcp-server v1.1.0 REST] started (auth_mode=missing)
```

`missing` 表示两组凭据都不全，所有工具调用会立即返回 `config_error`。

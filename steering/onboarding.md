---
inclusion: auto
---

# 首次配置引导流程

## 触发场景

用户首次激活 Power（点击 "Try Power"）或输入"配置"、"setup"、"初始化"等关键词时。

## 目的

一次性引导用户完成所有外部系统的配置和验证，确保后续使用时所有功能即开即用，不会中途要求补充配置。

## 引导流程

### ① Zmind 连接验证

**AI 动作**: 调用 `list_projects` 验证 Zmind 连接是否正常。

- IF 成功 → 显示 "✅ Zmind 连接正常"，进入步骤 ②
- IF 失败（ZMIND_API_KEY 未配置）→ 引导用户配置：
  ```
  ❌ Zmind 未连接
  
  请在 mcp.json 中配置 ZMIND_API_KEY：
  1. 登录 https://zmind.whaletv.com
  2. 右上角"我的账户" → 左侧"API 访问密钥" → 显示/重置密钥
  3. 将密钥填入 ~/.kiro/settings/mcp.json 的 env.ZMIND_API_KEY 字段
  
  配置完成后请告诉我，我会重新验证。
  ```

---

### ② 获取项目列表 → 引导匹配代码路径

**AI 动作**: 调用 `list_projects` 获取用户可见的所有项目，展示列表并请用户提供映射。

**展示格式**:
```
✅ Zmind 连接正常

你在 Zmind 上可见的项目：
1. [cultraview-dvb-amlogic-t950d4-2k-1g] CultraView DVB Amlogic T950D4 2K 1G
2. [stm-amlogic-t962d4-4k-1-5gb] STM Amlogic T962D4 4K 1.5GB
3. ...

请告诉我你常用的项目对应的本地代码路径，格式如：
- cultraview-dvb-amlogic-t950d4-2k-1g → ~/cvte_code/amlogic/
- stm-amlogic-t962d4-4k-1-5gb → ~/cvte_code/stm/

（可以只配常用的，后续随时补充）
```

**等待用户提供映射后记录**，然后进入步骤 ③。

---

### ③ Gerrit 连接验证

**AI 动作**: 通过 REST API 验证 Gerrit 连接。**v1.1.0 起 gerrit-mcp-server 支持双通道认证**：

| 模式 | 适用场景 | 配置字段 |
|------|---------|---------|
| **session 模式（首选）** | nginx + Gerrit 双层认证网关（公司默认部署） | `GERRIT_AUTH_HEADER` + `GERRIT_COOKIE` |
| **basic 模式（备选）** | Gerrit 直连无 nginx 网关 | `GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD` |

**推荐：直接跑凭据自动刷新脚本**（详见 [`steering/auth-refresh.md`](./auth-refresh.md)）：

```powershell
# Windows
PowerShell -ExecutionPolicy Bypass -File scripts\refresh-auth.ps1
```
```bash
# Linux / macOS
bash scripts/refresh-auth.sh
```

脚本会：
- 提示输入 SSO 用户名 + 密码（密码不回显、不落盘）
- 自动跑 Playwright headless 浏览器登录 nginx + Gerrit
- 抓取 cookie 写入 `mcp.json`，自检通过才算成功

> 说明：v1.1.0 双通道认证是为了过公司 nginx + Gerrit 双层（HTTP 协议规定一个请求只能有 1 个 Authorization 头，但允许 1 个 Authorization + 1 个 Cookie 同时存在；脚本利用此设计）。脚本不能跑 / 想手动配置时，参考 `auth-refresh.md` 的 F12 抓取流程。

**手动验证（脚本跑成功后用来确认）**:

```bash
# Linux / macOS / Git Bash — session 模式
curl -sS \
  -H "Authorization: $GERRIT_AUTH_HEADER" \
  -H "Cookie: $GERRIT_COOKIE" \
  "https://whale-gerrit.zeasn.com/changes/?n=1"
```

```powershell
# PowerShell — session 模式
$headers = @{
  Authorization = $env:GERRIT_AUTH_HEADER
  Cookie        = $env:GERRIT_COOKIE
}
Invoke-WebRequest -Uri "https://whale-gerrit.zeasn.com/changes/?n=1" -Headers $headers -UseBasicParsing
```

```bash
# basic 模式（无 nginx 时）
curl -sS -u "<用户名>:<HTTP密码>" "https://whale-gerrit.zeasn.com/a/changes/?n=1"
```

- IF 返回 JSON（首行 `)]}'` 后跟 changes 数组）→ ✅ 显示 "Gerrit REST 连接正常（gerrit-mcp-server 14 个工具均可用）"
- IF 401 + realm 含 `Welcomme to ...` → nginx 那一层认证未过，检查 `GERRIT_AUTH_HEADER`（session 模式）或检查 nginx 是否要求其他 header
- IF 401 + realm 含 `Gerrit Code Review` → Gerrit 自身认证未过，session 模式下检查 cookie 是否过期、basic 模式下检查 HTTP_PASSWORD
- IF 连接超时或域名解析失败 → 进入"网络诊断步骤"

**SSH 公钥仍然必要**（仅用于 `push_to_gerrit` 内部的 git push）：

```bash
ssh -p 29418 <用户名>@whale-gerrit.zeasn.com gerrit version
```

- IF 返回 `gerrit version 3.6.0` → ✅ "push_to_gerrit 可用"
- IF 失败 → 引导配置 SSH 公钥（仅影响 push_to_gerrit；其他 13 个 REST 工具不受影响）

**网络诊断步骤**（任一通道失败时执行）：

```bash
# 1. 检查 DNS 解析
nslookup whale-gerrit.zeasn.com

# 2. 检查 HTTPS 端口连通性（REST 主通道）
nc -zv whale-gerrit.zeasn.com 443 -w 5

# 3. 检查 SSH 端口连通性（仅 push_to_gerrit 需要）
nc -zv whale-gerrit.zeasn.com 29418 -w 5

# 4. 检查是否需要代理
echo $http_proxy $https_proxy
```

根据诊断结果给出针对性建议：
- DNS 解析失败 → 检查 DNS 配置或 /etc/hosts
- 443 端口不通 → "HTTPS 端口被拦截，REST 通道不可用，gerrit-mcp-server 全部不可用"
- 29418 端口不通 → "SSH 端口被拦截，push_to_gerrit 不可用；其他 13 个 REST 工具仍可用"
- 端口都通但 REST 401 → 跑 `scripts/refresh-auth.*` 重抓凭据

**可选**: 询问默认 Reviewer 列表（后续推送时使用）。

---

### ④ 内部文档系统连接验证

**AI 动作**: 与 Gerrit 类似，文档中心也走 cookie 认证。**优先用步骤 ③ 同一次跑的 `scripts/refresh-auth.*` 一并完成**——脚本会同时抓 Confluence 的 `JSESSIONID / seraph.confluence` cookie 写入 mcp.json。

如果脚本已跑过，直接验证：

```bash
# 用 mcp.json 里的 CONFLUENCE_COOKIE 验证
curl -sS \
  -H "Cookie: $CONFLUENCE_COOKIE" \
  "https://docs.whaletv.com/rest/api/content?limit=1"
```

- IF 返回 JSON 内容 → ✅ "内部文档系统连接正常"
- IF 返回 401 / 重定向到登录页 → cookie 过期或脚本没抓到，重跑 `scripts/refresh-auth.*`
- IF 用户选择跳过 → 标注 "⚠️ 内部文档暂未配置，后续分析问题时将跳过文档查询"

**手动方式**（不想用脚本）：浏览器登录后 F12 → Network → 任一 `/rest/api/...` 请求 → Headers → 复制 `Cookie:` 后整串 → 填到 `mcp.json` 的 `mcpServers.confluence-mcp-server.env.CONFLUENCE_COOKIE`。

**网络诊断步骤**（连接失败时执行）：
```bash
# 检查 DNS 解析
nslookup docs.whaletv.com

# 检查 HTTPS 端口连通性
nc -zv docs.whaletv.com 443 -w 5

# 检查代理配置
echo $http_proxy $https_proxy
```

根据诊断结果给出建议：
- DNS 不通 → "请检查 DNS 配置，或在 /etc/hosts 中添加 docs.whaletv.com 的 IP 映射"
- 端口不通 → "HTTPS 端口被拦截，请确认是否需要配置代理"
- 端口通但请求失败 → 跑 `scripts/refresh-auth.*` 重抓 cookie

---

### ⑤ OpenGrok 代码搜索配置

**AI 动作**: 获取用户的 OpenGrok 账号密码，然后通过搜索 API 实际验证连通性。

**引导提示**:
```
接下来配置 OpenGrok 代码搜索。

OpenGrok 地址: https://opengrok.zeasn.com
用途：远程搜索公版代码（只读），当本地没有对应项目代码时使用

请提供你的账号信息：
- 用户名：
- 密码：
```

**验证方式**: 用户提供凭据后，执行搜索 API 验证：
```bash
curl -s -u "<用户名>:<密码>" "https://opengrok.zeasn.com/api/v1/search?full=test&maxresults=1"
```

- IF 返回 JSON 搜索结果 → 显示 "✅ OpenGrok 连接正常"，并展示可用项目列表：
  ```
  ✅ OpenGrok 连接正常

  可用项目（公版代码库）：
  • d4_code — D4 平台
  • stb16_code — STB16 平台
  • x5_code — X5 平台
  ```
- IF 返回 401 → 提示认证失败，请重新提供
- IF 用户选择跳过 → 标注 "⚠️ OpenGrok 暂未配置，远程代码搜索不可用"

---

### ⑥ 配置总结

**AI 动作**: 汇总所有配置状态，展示最终结果。

**展示格式**:
```
🎉 配置完成！

系统连接状态：
✅ Zmind — 已连接（API Key 有效）
✅ Gerrit — SSH 连接正常（gerrit version 3.6.0）
✅ 内部文档 — Confluence API 可访问
✅ OpenGrok — 代码搜索可用（d4_code、stb16_code、x5_code）

项目-代码映射：
• cultraview-dvb-amlogic-t950d4-2k-1g → ~/cvte_code/amlogic/
• stm-amlogic-t962d4-4k-1-5gb → ~/cvte_code/stm/

✨ 已自动启用：模块路径地图（D4 / X5 / STB 三平台 ~90+ 业务子模块的精确路径前缀）
   AI 在分析问题、定位代码时会先查地图缩小搜索范围，避免大范围 grep。

你现在可以：
• "查看我的待办" — 获取 Issue 列表
• "帮我处理 PR #12345" — 全链路 PR/CR 处理
• "分析下 #334001" — Bug 自动分析
• "把 #332669 cp 到 mp" — Cherry-Pick 同步
• "推送代码到 Gerrit" — push_to_gerrit + 处理评论
• "回顾经验" — 查看历史经验和错误记录
```

---

## 关键约束

- 引导流程必须**一次性完成所有配置**，不允许跳过步骤（文档系统除外，可跳过）
- 每个步骤验证失败时，必须提供明确的修复指引
- 用户修复后可以说"已配置"或"重试"，AI 重新验证该步骤
- 项目-代码映射可以只配常用的，但必须至少配一个
- 配置总结必须展示所有系统的最终状态
- UI 提示统一使用"用户名"和"密码"，不暴露技术细节（如 HTTP Password、Basic Auth 等）
- 不要在输出中暴露用户的密码或 API Key
- 配置过程中的失败和解决方案记录到 `.learnings/ERRORS.md`，便于后续用户遇到相同问题时快速解决

## 凭据存储说明

各系统凭据的存储位置（统一在 `~/.kiro/settings/mcp.json` 的 `mcpServers.<server>.env`）：
- **Zmind API Key**: `mcpServers.zmind-mcp-server.env.ZMIND_API_KEY`
- **Gerrit (session 模式)**: `mcpServers.gerrit-mcp-server.env.GERRIT_AUTH_HEADER` + `GERRIT_COOKIE`（首选，过 nginx 双层）
- **Gerrit (basic 模式)**: `mcpServers.gerrit-mcp-server.env.GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD`（直连无 nginx）
- **Confluence**: `mcpServers.confluence-mcp-server.env.CONFLUENCE_COOKIE`（cookie 模式）
- **OpenGrok 用户名/密码**: `mcpServers.opengrok-mcp-server.env.OPENGROK_USERNAME` + `OPENGROK_PASSWORD`
- **Gerrit SSH 密钥**: 由系统 SSH agent 管理（仅 push_to_gerrit 用）

**强烈推荐**：跑一次 `scripts/refresh-auth.{ps1,sh}` 让脚本自动维护 Gerrit + Confluence 凭据；后续 cookie 过期（401）时再跑一次即可。详见 [`steering/auth-refresh.md`](./auth-refresh.md)。

## 后续补充配置

用户随时可以说"补充配置"或"添加项目映射"来更新配置：
- 添加新的项目-代码映射
- 更新 Reviewer 列表
- 启用 OpenGrok（当服务开放后）
- 更新 Confluence 密码

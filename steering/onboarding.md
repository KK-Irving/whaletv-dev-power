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

**AI 动作**: 分两步验证 Gerrit 连接 —— 先验 SSH（gerrit-mcp-server **主通道**），再验 REST（保留作 fallback）。

**引导提示**:
```
接下来配置 Gerrit 连接。

请提供你的 Gerrit 账号信息：
- 用户名：（登录 https://whale-gerrit.zeasn.com/ 的用户名）
- HTTP 密码：（Gerrit Settings → HTTP Credentials → Generate Password）
```

> 说明：自 v0.2.0 起 gerrit-mcp-server 全部 14 个工具走 **SSH 通道（端口 29418）**，原因是部署环境 nginx 在 Gerrit 前置 Basic Auth 与 Gerrit 自身的 HTTP 凭据校验形成双层认证，单次 HTTP 请求无法同时满足，所有走 REST `/a/...` 的客户端都会 401。SSH 公钥用于：① `gerrit query` / `gerrit review --json` / `gerrit set-reviewers` 等所有 SSH 命令；② `push_to_gerrit` 内部的 git push；③ `get_unresolved_threads` 内部的 git fetch NoteDb meta ref。HTTP 密码暂保留（用于 fallback 与未来 nginx 配置修复后切回 REST），但 v0.2.0+ 不再依赖。两类凭据在 onboarding 阶段一次性配好。

**验证方式 A（必做）**: SSH 验证 — gerrit-mcp-server 主通道：

```bash
ssh -p 29418 <用户名>@whale-gerrit.zeasn.com gerrit version
```

- IF 返回 `gerrit version 3.6.0` → 显示 "✅ Gerrit SSH 连接正常（gerrit-mcp-server 14 个工具均可用）"
- IF 失败 → 进入"网络诊断步骤"

**验证方式 B（可选）**: REST 验证 — fallback 通道，nginx 配置修复后才能用：

```bash
# Linux / macOS / Git Bash
curl -sS -u "<用户名>:<HTTP密码>" "https://whale-gerrit.zeasn.com/a/accounts/self"

# PowerShell
$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("<用户名>:<HTTP密码>"))
Invoke-WebRequest -Uri "https://whale-gerrit.zeasn.com/a/accounts/self" -Headers @{ Authorization = "Basic $cred" } -UseBasicParsing
```

- IF 返回当前用户的 JSON（前缀 `)]}'` 后跟账户信息）→ 显示 "✅ Gerrit REST 连接正常（fallback 可用）"
- IF 返回 401 + WWW-Authenticate realm 含 `Welcomme to Gerrit Code Review Site!` → 说明 nginx 双层认证生效，REST 不可用是预期的；**只要 SSH 通即可**，不阻塞 onboarding
- IF 返回 401 + realm 是 `Gerrit Code Review` → 提示用户检查 HTTP Credentials 是否正确（仅当未来切回 REST 时需要）
- IF 连接超时或域名解析失败 → 进入"网络诊断步骤"

**网络诊断步骤**（SSH 失败时自动执行）：
```bash
# 1. 检查 DNS 解析
nslookup whale-gerrit.zeasn.com

# 2. 检查 SSH 端口连通性（主通道）
nc -zv whale-gerrit.zeasn.com 29418 -w 5

# 3. 检查 HTTPS 端口连通性（仅 fallback 时需要）
nc -zv whale-gerrit.zeasn.com 443 -w 5

# 4. 检查是否需要代理
echo $http_proxy $https_proxy
```

根据诊断结果给出针对性建议：
- DNS 解析失败 → "请检查 DNS 配置或 /etc/hosts 是否有 whale-gerrit.zeasn.com 的记录"
- 29418 端口不通 → "SSH 端口 29418 被防火墙拦截，gerrit-mcp-server 全部工具不可用。请联系网络管理员开放，或确认是否需要 SSH 代理"
- 443 端口不通 → "HTTPS 端口被拦截，REST fallback 不可用；但只要 SSH 通就足够，不影响主流程"
- DNS 与 29418 都通但 SSH 认证失败 → 引导配置 SSH 密钥：
  ```
  ❌ Gerrit SSH 连接失败（gerrit-mcp-server 全部工具不可用）
  
  请确保你的 SSH 公钥已上传到 Gerrit：
  1. 生成 SSH 密钥（如果没有）：ssh-keygen -t rsa -b 4096
  2. 复制公钥：cat ~/.ssh/id_rsa.pub
  3. 登录 https://whale-gerrit.zeasn.com/ → Settings → SSH Keys → Add Key
  4. 粘贴公钥并保存
  
  配置完成后请告诉我，我会重新验证。
  ```

**可选**: 询问默认 Reviewer 列表（后续推送时使用）。

---

### ④ 内部文档系统连接验证

**AI 动作**: 获取用户的 Confluence 账号密码，然后通过 REST API 实际验证连通性。

**引导提示**:
```
接下来配置内部文档系统（Confluence）连接。

文档地址: https://docs.whaletv.com/
请提供你的账号信息：
- 用户名：（公司账号）
- 密码：（公司密码）
```

**验证方式**: 用户提供凭据后，执行 API 验证：
```bash
# PowerShell
$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("<用户名>:<密码>"))
$headers = @{ Authorization = "Basic $cred" }
Invoke-WebRequest -Uri "https://docs.whaletv.com/rest/api/content?limit=1" -Headers $headers -UseBasicParsing
```

- IF 返回 JSON 内容 → 显示 "✅ 内部文档系统连接正常"
- IF 返回 401 → 提示认证失败：
  ```
  ❌ 文档系统认证失败（HTTP 401）
  
  请确认用户名和密码是否正确（与浏览器登录 docs.whaletv.com 时相同）。
  注意：用户名可能区分大小写。
  
  请重新提供，或输入"跳过"暂时跳过此步骤。
  ```

- IF 连接超时或无法访问 → 执行网络诊断：
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
  - 端口不通 → "HTTPS 端口被拦截，请确认是否需要配置代理。如果浏览器能访问但终端不行，可能需要设置 http_proxy 环境变量"
  - 端口通但请求失败 → "可能是 SSL 证书问题或代理拦截，请尝试：`curl -k https://docs.whaletv.com`"

- IF 用户选择跳过 → 标注 "⚠️ 内部文档暂未配置，后续分析问题时将跳过文档查询"

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

各系统凭据的存储位置：
- **Zmind API Key**: mcp.json 的 `env.ZMIND_API_KEY` 字段
- **OpenGrok 用户名/密码**: mcp.json 的 `env.OPENGROK_USERNAME` 和 `env.OPENGROK_PASSWORD` 字段
- **Gerrit 用户名**: 记录在 skill 上下文中，SSH 密钥由系统管理
- **Confluence 用户名/密码**: 记录在 skill 上下文中，每次 API 调用时使用

## 后续补充配置

用户随时可以说"补充配置"或"添加项目映射"来更新配置：
- 添加新的项目-代码映射
- 更新 Reviewer 列表
- 启用 OpenGrok（当服务开放后）
- 更新 Confluence 密码

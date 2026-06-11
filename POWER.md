---
name: "whaletv-dev-power"
displayName: "WhaleTV Developer Power"
description: "面向 WhaleTV 开发者的 AI 辅助工具包；v2 集成 Zmind/Gerrit/Confluence/OpenGrok 四源 + 本地向量+FTS5 知识库 + analyze_issue 一键端到端工作流"
keywords: ["whaletv", "zmind", "gerrit", "opengrok", "confluence", "knowledge-base", "vector-search", "cherry-pick", "pr", "cr", "android", "项目管理", "代码搜索", "知识库", "issue-workspace", "analyze-issue"]
author: "WhaleTV Team"
---

# WhaleTV Developer Power（v2）

面向 WhaleTV 全体开发者的 Kiro Power 工具包。**v2 平台升级**完成后包含 5 个 MCP 服务器、12 份工作流指南，覆盖：项目管理（Zmind 含 Issue 工作目录 + 全附件类型自动处理）、代码搜索（OpenGrok）、代码评审（Gerrit 14 工具，REST 双通道认证）、文档中心（Confluence）、本地知识库（向量 + FTS5 hybrid 跨源检索 + analyze_issue 端到端工作流）。

## v2 核心升级

- **Gerrit 双通道认证**（v1.1.0）：`session 模式`（`GERRIT_AUTH_HEADER` + `GERRIT_COOKIE`，过 nginx 双层认证网关）+ `basic 模式`（`GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD`，直连）
- **Zmind RAR5 + WAF 应对**（v2.1.1）：unar→unrar→7z 三档降级解压 + 0 字节防御 + Aliyun WAF 限速重试 + 进程级速率/并发门
- **Confluence 文档中心 MCP**（v1.0.0 新增）：cookie 认证（独立账号）+ CQL 全文检索 + 页面详情 + 空间列表
- **本地知识库 MCP**（v1.0.0 新增）：BGE-small-zh ONNX 嵌入 + SQLite BLOB 向量 + FTS5 全文 + hybrid 跨源融合检索；含 AOSP 模块级精搜与 `analyze_issue` 端到端工作流
- **凭据自动刷新**：`scripts/refresh-auth.{ps1,sh,mjs}` Playwright 自动登录抓 cookie + form login 写入 mcp.json，cookie 过期一条命令搞定

## Overview

### 首次使用

激活 Power 后会自动进入配置引导（详见 `steering/onboarding.md`），依次验证：
1. Zmind 连接 → 获取项目列表 → 匹配代码路径
2. **跑 `scripts/refresh-auth`** 一键抓 Gerrit + Confluence cookie 写入 mcp.json
3. Gerrit / Confluence / OpenGrok 验证
4. （可选）knowledge-mcp 首批 sync_zmind / sync_gerrit / embed_pending 建立本地索引

### 功能概览

- **Zmind 项目管理**（v2.1.1）：Issue 全套增删改查 + 工时记录 + 项目成员；`prepare_issue_workspace` 一站式工作目录 + 附件路由（zip/tar/RAR5/7z 三档解压 + 图片/HCI log/PDF 工具检测）；WAF 限速自动重试
- **OpenGrok 代码搜索**：全文搜索 + 符号定义查找
- **Gerrit MCP**（v1.1.0 ★ 双通道认证）：14 个工具（5 读 + 9 写），过公司 nginx 双层认证网关；`cherry_pick_change` 自动执行；`get_unresolved_threads` 直接拿评论 thread + UUID（无需 NoteDb）
- **Confluence 文档中心**（v1.0.0 ★ 新增）：3 个工具（search_confluence / get_page / list_spaces），CQL 自动包装 + HTML 转纯文本
- **本地知识库**（v1.0.0 ★ 新增）：12 个工具
  - sync_*：三源同步 + AOSP 索引
  - embed_*：BGE 嵌入计算
  - search_local（hybrid / vector / fts 三模式 + 跨源融合）
  - search_aosp（模块级精搜，结合 module-path-map）
  - **analyze_issue**：一键端到端 PR/Bug 分析（拉 issue → 三源检索 → 模块推断 → AOSP 精搜 → 渲染 analysis-context.md）
- **PR/CR / Cherry-Pick / Bug 分析 / Code Review 处理 / 智能 Commit Message** 五大工作流（v2 起所有定位代码步骤先查本地索引）
- **模块路径地图（D4 / X5 / STB）**：~90+ 业务子模块精确路径前缀，自动生效
- **凭据自动刷新**：双账号支持（Gerrit SSO + Confluence 独立账号）
- **三层安全防护**：规则约束 + Hook 拦截 + 人工确认

### MCP 服务器（5 个）

| 服务器 | 版本 | 工具数 | 功能 |
|--------|------|--------|------|
| zmind-mcp-server | **v2.1.1** | 16 | Issue 全套 + `prepare_issue_workspace`（v2.0.0）+ RAR5 三档解压 + WAF 重试（v2.1.0）+ bin path 修复（v2.1.1） |
| opengrok-mcp-server | v1.2.0 | 4 | 全文 / 符号 / 路径搜索 + 文件读取 |
| gerrit-mcp-server | **v1.1.0** | 14 | REST 双通道认证（session + basic），cherry_pick 自动执行，14 个工具 100% 兼容 v1.0 |
| confluence-mcp-server | **v1.0.0** | 3 | search_confluence / get_page / list_spaces；cookie 认证（form login） |
| knowledge-mcp-server | **v1.0.0** | 12 | 三源同步 + AOSP 索引 + 嵌入 + hybrid 检索 + analyze_issue 端到端 |

## Available Steering Files

按需加载：

- **onboarding** — 首次配置引导（含 v2 凭据双账号说明），触发示例："配置" / "setup"
- **auth-refresh** — Gerrit + Confluence 凭据自动刷新工作流，触发示例："cookie 过期" / "refresh auth"
- **pr-cr-workflow** — PR/CR 全链路处理（v2 起优先 search_local 找历史相似 PR），触发示例："帮我处理 PR #12345"
- **cherry-pick-workflow** — 跨分支 Cherry-Pick 同步，触发示例："把 #332669 cp 到 mp"
- **bug-analysis-workflow** — Bug 自动分析（v2 起优先调 `analyze_issue` 一键全栈），触发示例："分析下 #334001"
- **gerrit-workflow** — Gerrit 推送与评论处理
- **code-review-handling** — Gerrit-AI / reviewer 评论的三态处理
- **commit-message-workflow** — 智能 Commit Message 生成（v2 起 message 构造前先查 search_gerrit）
- **knowledge-base-workflow** — 本地知识库使用规范（同步 / 嵌入 / 检索 / 重建索引），自动生效
- **module-path-map** — D4/X5/STB 三平台模块路径地图，自动生效
- **local-code-guide** — 本地源码搜索 5 档策略（地图→本地索引→git grep→已知路径→OpenGrok），自动生效
- **safety-rules** — 三层防护体系，自动生效

## Onboarding

### 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10/11 / Ubuntu 20.04+ / macOS |
| Node.js | **22.5+**（knowledge-mcp 用 `node:sqlite` 内置模块） |
| 网络 | 能访问 zmind.whaletv.com / whale-gerrit.zeasn.com / docs.whaletv.com |
| 磁盘 | ≥ 5 GB（含 ONNX 模型 ~80MB + 知识库索引 + 可选 AOSP 索引） |

### 一键配置

```bash
# 1. 跑凭据自动刷新（Playwright 抓 cookie 写 mcp.json）
PowerShell -ExecutionPolicy Bypass -File scripts\refresh-auth.ps1   # Windows
bash scripts/refresh-auth.sh                                         # Linux/macOS

# 2. （可选）首批知识库同步 + 嵌入（在 Kiro 内说自然语言）
"用 sync_zmind 拉 1000 条；用 embed_pending 处理 zmind"
"用 sync_gerrit 拉 1000 条；用 embed_pending 处理 gerrit"
```

详见 `steering/onboarding.md` 和 `steering/auth-refresh.md`。

### mcp.json 配置（5 个 server）

完整模板见仓库根的 `mcp.json`。关键字段说明：

#### zmind-mcp-server (v2.1.1)
| 变量 | 必需 | 说明 |
|---|---|---|
| `ZMIND_API_KEY` | ✅ | Zmind 用户 API 密钥（40 位十六进制；登录 zmind.whaletv.com → 我的账户 → API 访问密钥） |
| `ZMIND_URL` | ❌ | 默认 `https://zmind.whaletv.com` |
| `ZMIND_HTTP_MIN_INTERVAL` | ❌ | 进程级最小请求间隔（毫秒，默认 0=禁用） |
| `ZMIND_FETCH_CONCURRENCY` | ❌ | 进程级并发上限（默认 2） |

#### gerrit-mcp-server (v1.1.0) — **双通道认证**

**模式 A（session，推荐）**：过公司 nginx + Gerrit 双层认证网关
| 变量 | 说明 |
|---|---|
| `GERRIT_AUTH_HEADER` | raw `"Basic <SSO 用户名:SSO 密码 base64>"`（refresh-auth 自动填） |
| `GERRIT_COOKIE` | raw `"GerritAccount=...; XSRF_TOKEN=..."`（refresh-auth 自动填） |

**模式 B（basic，无 nginx 时）**：
| 变量 | 说明 |
|---|---|
| `GERRIT_USERNAME` | Gerrit 用户名 |
| `GERRIT_HTTP_PASSWORD` | Gerrit Settings → HTTP Credentials 生成的 Token（**不是 SSO 密码**） |

> **公司部署优先用模式 A**。两组凭据有任一组完整即可启动；启动 banner 会显示 `auth_mode=session` / `basic` / `missing`。

#### confluence-mcp-server (v1.0.0) — **独立账号系统**
| 变量 | 必需 | 说明 |
|---|---|---|
| `CONFLUENCE_BASE_URL` | ✅ | 默认 `https://docs.whaletv.com` |
| `CONFLUENCE_COOKIE` | ✅ | raw `"JSESSIONID=...; acw_tc=..."`（refresh-auth 自动填，Confluence 走独立账号 form login） |
| `CONFLUENCE_REQUEST_DELAY_MS` | ❌ | 请求最小间隔（默认 150ms 防 Aliyun WAF） |

> ⚠️ Confluence 是独立账号系统，**不走 SSO**（用户名首字母可能与 SSO 不同）。`refresh-auth` 会单独 prompt 收 Confluence 凭据。

#### knowledge-mcp-server (v1.0.0) — **复用三源凭据**
- 主键：`KNOWLEDGE_DB_PATH`（默认 `./data/knowledge.db`）+ `KNOWLEDGE_MODEL_CACHE_DIR`
- 复用：`ZMIND_API_KEY` + `GERRIT_AUTH_HEADER`+`GERRIT_COOKIE` + `CONFLUENCE_COOKIE`（与上面三个 server 同源）

#### opengrok-mcp-server
| 变量 | 必需 | 说明 |
|---|---|---|
| `OPENGROK_URL` | ✅ | 默认 `https://opengrok.zeasn.com` |
| `OPENGROK_USERNAME` + `OPENGROK_PASSWORD` | ✅ | Basic Auth 凭据（共享只读账号或个人账号） |
| `OPENGROK_PROJECT` | ❌ | 默认搜索项目（如 `d4_code`） |

### 配置验证（一键 setup-v2）

```bash
# 自动跑：依赖检查 + 凭据刷新 + 模型下载提示 + 5 个 server 注入到 mcp.json
PowerShell -ExecutionPolicy Bypass -File scripts\setup-v2.ps1   # Windows
bash scripts/setup-v2.sh                                         # Linux/macOS
```

或手动验证：

```bash
# Zmind
curl -s -o /dev/null -w "%{http_code}\n" "https://zmind.whaletv.com/users/current.json?key=$ZMIND_API_KEY"

# Gerrit (session 模式)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: $GERRIT_AUTH_HEADER" \
  -H "Cookie: $GERRIT_COOKIE" \
  "https://whale-gerrit.zeasn.com/changes/?n=1"

# Confluence
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Cookie: $CONFLUENCE_COOKIE" \
  "https://docs.whaletv.com/rest/api/space?type=global&limit=1"

# OpenGrok
curl -s -u "$OPENGROK_USERNAME:$OPENGROK_PASSWORD" \
  "https://opengrok.zeasn.com/api/v1/search?full=test&maxresults=1" | head -c 200
```

### 推荐使用方式

> ⚠️ **Workspace 限制**：Kiro 只能操作当前 workspace 内的文件。源码目录必须作为 workspace 打开。

- **Windows**：`File → Open Folder` 选择源码映射路径（如 `W:\code\950_stm\amlogic`）
- **Linux**：源码根目录启动 `cd ~/cvte_code/amlogic && kiro`

## Common Workflows

### v2 一键 PR/Bug 分析（推荐）

触发："分析下 #334001"

```
analyze_issue 工具（knowledge-mcp）一次串起：
  1. 拉 Zmind issue 详情
  2. 准备 .workspace/issue-<id>/ 工作目录
  3. 提取关键词
  4. 三源（zmind/gerrit/confluence）hybrid 检索 → 找类似 PR + 修复 + 文档
  5. 推断平台（D4/X5/STB）+ 模块（基于 module-path-map）
  6. （可选）AOSP 模块级精搜
  7. 渲染 analysis-context.md 落盘
```

详见 `steering/bug-analysis-workflow.md` + `steering/knowledge-base-workflow.md`

### PR/CR 处理

触发："帮我处理 PR #12345"

完整流程：获取 Issue → 调 `search_local(source="all")` 找历史相似 → 分析问题 → 定位代码 → 修改 → diff 确认 → git add -p → 智能 Commit Message → 推送 Gerrit → 处理 Gerrit-AI 评论 → 更新 Zmind

详见 `steering/pr-cr-workflow.md`

### Cherry-Pick 同步

触发："把 #332669 cp 到 mp"

完整流程：获取 Change → 搜索已合入 master → 发现 MP 分支 → 展示 CP 计划 → 用户确认 → 批量 `cherry_pick_change`（自动执行）→ 分类汇报 → 更新 Zmind

详见 `steering/cherry-pick-workflow.md`

### 知识库同步与维护

触发："同步知识库" / "重建本地索引"

```
sync_zmind / sync_gerrit / sync_confluence       # 拉数据到 SQLite
embed_pending                                     # 计算嵌入
search_local                                      # 三模式检索
analyze_issue                                     # 一键端到端
```

AOSP 索引（可选，需要本地 repo）：

```
list_aosp_modules → index_aosp_module → embed_aosp_pending → search_aosp
```

详见 `steering/knowledge-base-workflow.md`

## 工具列表

### zmind-mcp-server v2.1.1（16 个工具）

读：`get_issue` / `my_issues` / `search_issues` / `list_projects` / `get_versions` / `get_project_members` / `get_issue_statuses` / `get_trackers` / `get_priorities` / `get_time_activities` / `download_attachment`（含 `save_to`）

写：`update_issue` / `create_issue` / `add_comment` / `create_time_entry`

★ 一站式：`prepare_issue_workspace`（自动创建工作目录 + 下载 + 解压 + 路由）

### opengrok-mcp-server（4 个工具）
`search_code` / `search_symbol` / `search_path` / `get_file_content`

### gerrit-mcp-server v1.1.0（14 个工具）

读（5）：`query_change` / `list_branches` / `get_change_comments` / `get_unresolved_threads` / `search_changes`

写（9）：`cherry_pick_change`（★ 自动执行）/ `push_to_gerrit`（git+SSH）/ `submit_review_reply`（批量）/ `add_review_comment` / `reply_inline_comment` / `mark_comment_resolved` / `add_reviewer` / `remove_reviewer` / `set_review_label`

### confluence-mcp-server v1.0.0（3 个工具）
`search_confluence`（CQL 自动包装）/ `get_page`（HTML→8000 字纯文本）/ `list_spaces`

### knowledge-mcp-server v1.0.0（12 个工具）

同步：`sync_zmind` / `sync_gerrit` / `sync_confluence`

嵌入：`embed_pending`（三源）/ `embed_aosp_pending`（AOSP）

检索：`search_local`（三模式 × 单源/跨源）/ `get_indexed`

AOSP：`list_aosp_modules` / `index_aosp_module` / `clear_aosp_index` / `search_aosp`

★ 端到端：`analyze_issue`

## Best Practices

- **代码定位 5 档策略**（v2 升级，详见 `local-code-guide.md`）：先查 `module-path-map` 命中模块前缀 → 再用 `search_local` 找历史命中 → 再 `git grep` → 再已知路径 → 最后 OpenGrok。避免大范围 grep。
- **PR/Bug 分析优先用 `analyze_issue` 一键模式**，无法判断时再分步调 `search_local` + 自定义查询
- 在源码根目录启动 Kiro，确保 AI 可直接访问项目文件
- `git add -p` hunk 级精确暂存
- Commit Message 严格五段式：`[版本号][类型][whaletv][Zmind#ID]简述`
- 跨代码库操作前明确告知用户范围
- knowledge-mcp 首次启动会下 BGE-small-zh ONNX 模型（~80MB），耐心等

## Troubleshooting

### Gerrit `auth_failed (401, cookie 已过期)`
跑 `scripts/refresh-auth.{ps1,sh}` 重新抓 cookie。

### Confluence `auth_failed (302 → /login.action)`
同上，cookie 过期。注意 Confluence 凭据是**独立账号**，refresh-auth 会单独 prompt。

### `auth_mode=missing`（启动 banner）
两组凭据都不全。运行 refresh-auth；或检查 mcp.json 的 `GERRIT_AUTH_HEADER`+`GERRIT_COOKIE`（首选）/ `GERRIT_USERNAME`+`GERRIT_HTTP_PASSWORD`（备选）。

### Zmind WAF 限速 403/429
v2.1.1 自动重试 5 次（`Connection: close` + 退避）。如仍失败，等 5-10 分钟。可调 `ZMIND_HTTP_MIN_INTERVAL=200` + `ZMIND_FETCH_CONCURRENCY=1` 降低烈度。

### RAR 解压失败
v2.1.1 三档降级（unar→unrar→7z）任一可用即解压成功。本机未装时安装：
- Windows: `choco install unar 7zip`
- Linux: `apt install unar p7zip-full`
- macOS: `brew install unar p7zip`

### knowledge-mcp 首次启动慢
BGE-small-zh ONNX 模型下载（~80MB）。中国大陆可设镜像：`HF_ENDPOINT=https://hf-mirror.com`。模型缓存到 `./data/models/`，重启快。

### `node:sqlite` 模块找不到
Node 版本必须 ≥ 22.5.0。检查：`node --version`。

### MCP Server 连接失败
1. `node --version` 验证 ≥ 22.5
2. 手动测：`npx -y @kk-irving/<server>@latest`（启动后等 stdio 输入即正常）
3. `npm ping` 验证 npm registry 可达

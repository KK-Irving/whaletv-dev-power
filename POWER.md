---
name: "whaletv-dev-power"
displayName: "WhaleTV Developer Power"
description: "面向 WhaleTV 开发者的 AI 辅助工具包；v3 架构级升级 = 单一凭据源 SoT + description-driven skills + Kiro 官方 hook + 一键部署"
keywords: ["whaletv", "zmind", "gerrit", "opengrok", "confluence", "knowledge-base", "vector-search", "cherry-pick", "pr", "cr", "android", "项目管理", "代码搜索", "知识库", "issue-workspace", "analyze-issue"]
author: "WhaleTV Team"
---

# WhaleTV Developer Power（v3）

面向 WhaleTV 全体开发者的 Kiro Power 工具包。**v3 架构级升级**完成后包含 5 个 MCP 服务器、16 个 skill、5 份 steering、7 个 Kiro 官方 hook，覆盖：项目管理（Zmind 含 Issue 工作目录 + 全附件类型自动处理）、代码搜索（OpenGrok）、代码评审（Gerrit 14 工具，REST 双通道认证）、文档中心（Confluence）、本地知识库（向量 + FTS5 hybrid 跨源检索 + analyze_issue 端到端工作流）。

## v3 核心升级（本轮）

- **Kiro 官方 hook 格式**（P0 修复）：v2 的 `hooks/safety-hooks.json` 用自定义 schema，Kiro 实际不加载，导致第二层防护是空的。v3 拆成 7 个符合 Kiro 官方 schema 的独立 JSON（block-sudo / block-mp-push / block-git-add-all / block-root-search / block-tmp-write / block-out-search / block-bulk-copy-out），部署后自动生效
- **单一凭据源 SoT**：所有凭据统一存于 `~/.ai/whaletv.yaml`（Single Source of Truth），改一处 5 个 MCP server 全部生效。老 mcp.json env 兼容保留（sot-loader 优先级：env 非空则不覆盖）。CLI `whaletv-credentials get/set/check/list/init/migrate`
- **一键部署脚本 `deploy.mjs`**：把 steering / hooks / skills 一次同步到 `~/.kiro/`（或 workspace 的 `.kiro/`），并把 `bin/` 加入 PATH。幂等 + 备份 + Kiro 运行检测 + hook schema 校验
- **description-driven skills**：v2 的 12 份 workflow steering 迁移到 `.kiro/skills/whaletv-*/SKILL.md` 结构，Kiro 通过 YAML front-matter 的 `description` 语义匹配自动激活，无需 `#steering-name` 硬编码引用
- **精简 steering**：steering 目录只保留 5 份（critical-rules / conventions / execution-rules / module-path-map / safety-rules），全部 `inclusion: always`；深度工作流内容移到 skill，按需触发

## v2 已有能力（继续保留）

- **Gerrit 双通道认证**（v1.1.0）：`session 模式`（`GERRIT_AUTH_HEADER` + `GERRIT_COOKIE`，过 nginx 双层认证网关）+ `basic 模式`（`GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD`，直连）
- **Zmind RAR5 + WAF 应对**（v2.1.1）：unar→unrar→7z 三档降级解压 + 0 字节防御 + Aliyun WAF 限速重试 + 进程级速率/并发门
- **Confluence 文档中心 MCP**（v1.0.0）：cookie 认证（独立账号）+ CQL 全文检索 + 页面详情 + 空间列表
- **本地知识库 MCP**（v1.0.2 → v3 起 **v1.1.0** 新增治理层）：BGE-small-zh ONNX 嵌入 + SQLite BLOB 向量 + FTS5 全文 + hybrid 跨源融合检索；含 AOSP 模块级精搜与 `analyze_issue` 端到端工作流；v1.1.0 新增 `generate_report` + `upload_report`（治理层）
- **凭据自动刷新**：`scripts/refresh-auth.{ps1,sh,mjs}` Playwright 自动登录抓 cookie + form login 写入 SoT + 双写 mcp.json，cookie 过期一条命令搞定

## Overview

### 首次使用（v3 三步）

激活 Power 后会自动进入配置引导（详见 skill `whaletv-onboarding`），依次执行：
1. `node scripts/deploy.mjs` — 部署 5 份 steering + 7 个 hook + 16 个 skill 到 `~/.kiro/`
2. `node scripts/whaletv-credentials.mjs init` — 交互式收集 4 套凭据到 SoT（`~/.ai/whaletv.yaml`）
3. `scripts/refresh-auth.{ps1,sh}` — Playwright 抓 Gerrit + Confluence session cookie 到 SoT
4. （可选）knowledge-mcp 首批 sync_zmind / sync_gerrit / embed_pending 建立本地索引

### 功能概览

- **Zmind 项目管理**（v2.1.1）：Issue 全套增删改查 + 工时记录 + 项目成员；`prepare_issue_workspace` 一站式工作目录 + 附件路由（zip/tar/RAR5/7z 三档解压 + 图片/HCI log/PDF 工具检测）；WAF 限速自动重试
- **OpenGrok 代码搜索**：全文搜索 + 符号定义查找
- **Gerrit MCP**（v1.1.0 ★ 双通道认证）：14 个工具（5 读 + 9 写），过公司 nginx 双层认证网关；`cherry_pick_change` 自动执行；`get_unresolved_threads` 直接拿评论 thread + UUID（无需 NoteDb）
- **Confluence 文档中心**（v1.0.0 ★ 新增）：3 个工具（search_confluence / get_page / list_spaces），CQL 自动包装 + HTML 转纯文本
- **本地知识库**（v1.0.0 → v1.1.0，v3）：14 个工具
  - sync_*：三源同步 + AOSP 索引
  - embed_*：BGE 嵌入计算
  - search_local（hybrid / vector / fts 三模式 + 跨源融合）
  - search_aosp（模块级精搜，结合 module-path-map）
  - **analyze_issue**：一键端到端 PR/Bug 分析（拉 issue → 三源检索 → 模块推断 → AOSP 精搜 → 渲染 analysis-context.md）
  - **generate_report + upload_report**（v1.1.0，v3 新增）：Skill 执行报告治理层（JSON + 自包含 HTML + S3 SigV4 上传）
- **PR/CR / Cherry-Pick / Bug 分析 / Code Review 处理 / 智能 Commit Message** 五大工作流（v2 起所有定位代码步骤先查本地索引；v3 起 workflow 迁移到 skill 通过 description 语义激活）
- **模块路径地图（D4 / X5 / STB）+ 架构分类速查表**：~90+ 业务子模块精确路径前缀 + 三平台差异对比矩阵，自动生效
- **凭据自动刷新**：双账号支持（Gerrit SSO + Confluence 独立账号）；v3 起写入 SoT
- **三层安全防护**：规则约束 + Hook 拦截 + 人工确认（v3 hook 修复后第二层真正生效）

### MCP 服务器（5 个）

| 服务器 | 版本 | 工具数 | 功能 |
|--------|------|--------|------|
| zmind-mcp-server | **v2.1.1** | 16 | Issue 全套 + `prepare_issue_workspace`（v2.0.0）+ RAR5 三档解压 + WAF 重试（v2.1.0）+ bin path 修复（v2.1.1） |
| opengrok-mcp-server | v1.2.0 | 4 | 全文 / 符号 / 路径搜索 + 文件读取 |
| gerrit-mcp-server | **v1.1.0** | 14 | REST 双通道认证（session + basic），cherry_pick 自动执行，14 个工具 100% 兼容 v1.0 |
| confluence-mcp-server | **v1.0.0** | 3 | search_confluence / get_page / list_spaces；cookie 认证（form login） |
| knowledge-mcp-server | **v1.1.0** | 14 | 三源同步 + AOSP 索引 + 嵌入 + hybrid 检索 + analyze_issue 端到端；v1.0.1 修 sync 3 bug；v1.0.2 加 Confluence searchv3 fallback；**v1.1.0 新增 generate_report + upload_report**（治理层，零依赖 SigV4 S3 上传） |

## Available Steering Files（v3 精简）

`inclusion: always`，每次对话都加载：

- **critical-rules** — MUST NOT 硬约束（真实事故驱动）+ GATE 场景清单，每条对应一个 hook
- **conventions** — SHOULD-level 建议：代码搜索 5 档、通信优先级、Issue 识别符、图表标准、commit 五段式
- **execution-rules** — 术语（MUST/SHOULD/[GATE]/[SELF-CHECK]）+ Skill 触发机制 + 凭据管理约定
- **codebase-taxonomy** — D4/X5/STB 三平台架构分类速查（业务代码位置、客户定制机制、CP 策略差异）+ 搜索策略决策树
- **module-path-map** — D4/X5/STB 三平台业务模块路径地图（90+ 模块），代码搜索时优先查表
- **safety-rules** — 三层防护体系描述 + 7 个 hook 索引 + 拦截信息格式

## Available Skills（v3 新架构）

`.kiro/skills/<name>/SKILL.md`，Kiro 根据 YAML front-matter 的 `description` 语义匹配自动激活；用户无需显式引用。

### WhaleTV 专属工作流（10 个）

- **whaletv-onboarding** — 首次配置引导，触发："配置" / "setup" / "初始化"
- **whaletv-auth-refresh** — Gerrit + Confluence cookie 自动刷新，触发："cookie 过期" / "auth_failed"
- **whaletv-pr-cr** — PR/CR Issue 端到端处理，触发："处理 PR #12345"
- **whaletv-cherry-pick** — 跨分支 CP 同步，触发："cp 到 mp" / "cherry-pick I1234567"
- **whaletv-bug-analysis** — Bug 分析（优先 `analyze_issue` 一键），触发："分析下 #334001"
- **whaletv-gerrit** — Gerrit 单点操作（push / 评论查询 / 单 change 处理）
- **whaletv-code-review** — Gerrit-AI 评论三态处理（ACCEPT / REJECT / ACK）
- **whaletv-code-selfaudit** — pre-commit 自审 checklist（编译 / 无调试代码 / 变更范围精确）
- **whaletv-commit-message** — 智能 Commit Message（严格五段式 + Branch_Detector 五级降级 + round-trip 契约）
- **whaletv-knowledge-base** — 本地知识库使用（sync_* / embed / search_local / analyze_issue）
- **whaletv-local-code** — 本地源码 5 档搜索策略

### 通用能力（6 个）

- **brainstorming** — 多方案脑暴 + 用户选择
- **find-skill** — 探索可用 skill 集合
- **project-code-mapping** — Zmind 项目 → 本地代码路径映射管理
- **self-improving** — 错误 / 修正 / 最佳实践沉淀到 `.learnings/`
- **skill-creator** — 创建/迭代 skill（v3 子目录结构）

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

详见 skill `whaletv-onboarding` 和 `whaletv-auth-refresh`（`.kiro/skills/`）。

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

#### knowledge-mcp-server (v1.1.0) — **复用三源凭据**
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

详见 skill `whaletv-bug-analysis` + `whaletv-knowledge-base`（`.kiro/skills/`）

### PR/CR 处理

触发："帮我处理 PR #12345"

完整流程：获取 Issue → 调 `search_local(source="all")` 找历史相似 → 分析问题 → 定位代码 → 修改 → diff 确认 → git add -p → 智能 Commit Message → 推送 Gerrit → 处理 Gerrit-AI 评论 → 更新 Zmind

详见 skill `whaletv-pr-cr`（`.kiro/skills/whaletv-pr-cr/SKILL.md`）

### Cherry-Pick 同步

触发："把 #332669 cp 到 mp"

完整流程：获取 Change → 搜索已合入 master → 发现 MP 分支 → 展示 CP 计划 → 用户确认 → 批量 `cherry_pick_change`（自动执行）→ 分类汇报 → 更新 Zmind

详见 skill `whaletv-cherry-pick`（`.kiro/skills/whaletv-cherry-pick/SKILL.md`）

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

详见 skill `whaletv-knowledge-base`（`.kiro/skills/whaletv-knowledge-base/SKILL.md`）

## 工具列表

所有 MCP 工具按 **`<server> v<version> — <一句话定位>`（工具数）+ 分组表格** 的统一格式列出。**★ 标记**表示 v2/v3 新增或"一站式"能力，值得优先关注。完整用法示例见 README 或对应 skill。

### Zmind v2.1.1 — Issue 全套增删改查 + 一站式工作目录（16 个）

| 分组 | 工具 | 功能 |
|---|---|---|
| Issue 读 | `get_issue` | Issue 详情（含评论、附件、关联、子任务） |
| Issue 读 | `my_issues` | 我的待办 Issue 列表 |
| Issue 读 | `search_issues` | 关键词全文搜索 |
| Issue 写 | `update_issue` | 状态 / 指派 / 优先级 / 完成度 |
| Issue 写 | `create_issue` | 创建新 Issue |
| Issue 写 | `add_comment` | 添加评论 |
| Issue 写 | `create_time_entry` | 工时记录 |
| 附件 | `download_attachment` | 附件下载（含 `save_to` 直落盘） |
| 元信息 | `list_projects` | 项目列表 |
| 元信息 | `get_versions` | 版本列表（用于 target_version 选择） |
| 元信息 | `get_project_members` | 项目成员 |
| 元信息 | `get_issue_statuses` | Issue 状态枚举 |
| 元信息 | `get_trackers` | Tracker 类型枚举（PR / CR / Task） |
| 元信息 | `get_priorities` | 优先级枚举 |
| 元信息 | `get_time_activities` | 工时活动类型 |
| ★ 一站式 | `prepare_issue_workspace` | 创建 `.workspace/issue-<id>/` + 下载 + 路由（zip/tar/RAR5 三档解压、图片/HCI/PDF 工具检测） |

### Gerrit v1.1.0 — REST 双通道认证 + cherry_pick 自动执行（14 个）

| 分组 | 工具 | 功能 |
|---|---|---|
| 读 | `query_change` | 单 change 详情 |
| 读 | `search_changes` | Gerrit query 语法搜索 |
| 读 | `list_branches` | 项目分支列表（支持 pattern 过滤） |
| 读 | `get_change_comments` | 所有 inline 评论（按时间升序） |
| 读 | `get_unresolved_threads` | 未解决 thread + `root_uuid`（无需 NoteDb） |
| ★ 写 | `cherry_pick_change` | 自动执行 REST cherry-pick（禁止本地 CP） |
| 写 | `push_to_gerrit` | git+SSH 推送（**唯一使用 SSH 通道**） |
| 写 | `submit_review_reply` | 批量原子回复评论 |
| 写 | `add_review_comment` | 单条 inline 评论 |
| 写 | `reply_inline_comment` | 回复具体评论（含 `in_reply_to`） |
| 写 | `mark_comment_resolved` | 标记评论已解决 |
| 写 | `add_reviewer` | 添加 reviewer |
| 写 | `remove_reviewer` | 移除 reviewer |
| 写 | `set_review_label` | 设置 Code-Review 标签值（`+1/+2/-1/-2`） |

### OpenGrok v1.2.0 — 公版代码远程搜索（4 个）

可用项目：`d4_code` / `stb16_code` / `x5_code`

| 分组 | 工具 | 功能 |
|---|---|---|
| 搜索 | `search_code` | 全文搜索（按 project / path 过滤） |
| 搜索 | `search_symbol` | 符号定义查找 |
| 搜索 | `search_path` | 路径匹配（收敛文件） |
| 读取 | `get_file_content` | 拿单文件完整内容 |

### Confluence v1.0.0 — 文档中心检索（3 个）

Cookie 认证走独立账号（form login `/dologin.action`），非 SSO。

| 分组 | 工具 | 功能 |
|---|---|---|
| 搜索 | `search_confluence` | CQL 全文搜索（`text~query` 自动包装） |
| 读取 | `get_page` | 单页面详情（HTML 转纯文本，截 8000 字） |
| 元信息 | `list_spaces` | 所有 global 空间 |

### Knowledge v1.1.0 — 本地知识库 + 治理层（14 个，v3 起）

BGE-small-zh ONNX 嵌入 + SQLite BLOB 向量 + FTS5 全文 + 三源 hybrid 跨源检索。首次启动自动下载 ONNX 模型（~80MB）。

| 分组 | 工具 | 功能 |
|---|---|---|
| 同步 | `sync_zmind` | 拉 Zmind issues 到本地（增量水位） |
| 同步 | `sync_gerrit` | 拉 Gerrit changes 到本地（双通道认证） |
| 同步 | `sync_confluence` | 拉 Confluence pages（含 searchv3 fallback，权限低账号可用） |
| 嵌入 | `embed_pending` | 三源批量嵌入（BGE-small-zh ONNX） |
| 嵌入 | `embed_aosp_pending` | AOSP 代码 chunk 批量嵌入 |
| 检索 | `search_local` | 单源 / 跨源 `vector` \| `fts` \| `hybrid` 三模式检索 |
| 检索 | `get_indexed` | 拿单条完整索引数据（不含向量） |
| AOSP | `list_aosp_modules` | 列出可索引的 AOSP 模块（按平台过滤） |
| AOSP | `index_aosp_module` | 索引单个 AOSP 模块（按平台 + 模块名） |
| AOSP | `clear_aosp_index` | 按 platform / module 清理索引 |
| AOSP | `search_aosp` | 模块级 `vector` \| `fts` \| `hybrid` 精搜（结合 module-path-map） |
| ★ 端到端 | `analyze_issue` | 一键 PR/Bug 分析（拉 issue → 工作目录 → 三源检索 → 平台/模块推断 → AOSP 精搜 → 渲染 analysis-context.md） |
| ★ 治理（v3） | `generate_report` | Skill 执行报告 JSON + 自包含 HTML（Report Fact v1 schema） |
| ★ 治理（v3） | `upload_report` | S3 SigV4 上传归档到 `s3://<bucket>/issueAnalysis/{year}/w{week}/`（零依赖） |

## Safety Hooks（v3 起符合 Kiro 官方 schema）

v3 版本把原先自定义格式的 `hooks/safety-hooks.json` 拆成 7 个独立的、符合 Kiro 官方 schema 的 hook JSON 文件。Kiro 会自动加载 `hooks/*.json`，在匹配到相应命令时向 AI 发送 prompt，由 AI 判断是否拦截并给出替代方案。

| Hook 文件 | 触发事件 | 拦截场景 |
|---|---|---|
| `hooks/block-sudo.json` | preToolUse（shell） | 命令包含 `sudo` |
| `hooks/block-mp-push.json` | preToolUse（shell） | `git push` 到 `*_mp` / `*_v3_mp` 保护分支 |
| `hooks/block-root-search.json` | preToolUse（shell） | `find/grep/rg/ag` 搜索 `/` 或 `~/` |
| `hooks/block-tmp-write.json` | preToolUse（shell） | 通过 `>` / `>>` 重定向写入 `/tmp/` |
| `hooks/block-out-search.json` | preToolUse（shell） | 搜索 `out/` 或 `prebuilts/`（数十 GB 大目录） |
| `hooks/block-git-add-all.json` | preToolUse（shell） | `git add .` / `-A` / `--all` / `*` 全量暂存 |
| `hooks/block-bulk-copy-out.json` | preToolUse（shell） | `rsync` / `cp -r` 批量复制 `out/` / `prebuilts/` |

**Hook 与 steering 规则一一对应**（三层防护体系里的第二层）——同一约束在 `steering/safety-rules.md` 中作为规则描述、在 hook JSON 中作为运行时拦截。二者一起构成完整的安全防护。

> v2 → v3 迁移：旧的 `hooks/safety-hooks.json`（自定义 schema）实际上没被 Kiro 加载。v3 修复后所有 hook 都会正常生效。原文件归档在 `.learnings/archive/safety-hooks-v2-legacy.json`。

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

### Confluence `403 Not permitted to use confluence`
账号权限问题。v1.0.2 起 `sync_confluence` 会**自动降级**到 `/rest/searchv3/1.0/cqlSearch`（Confluence 6.x SPA 前端用的 XHR endpoint，权限门槛低于 REST batch），大多数情况能拿到全量数据。
- `sync_confluence` 自动切 fallback（auto 模式，默认）
- 若还要强制走 fallback：`KNOWLEDGE_CONFLUENCE_SYNC_MODE=html` 环境变量或 `sync_confluence({mode:"html"})` 参数
- 若 searchv3 也 403：账号 read 权限也缺，找运维加"Use Confluence" 全局权限
- `search_confluence`（confluence-mcp 工具）仍走原 REST API 无 fallback；受影响时用 `search_local(source="confluence")` 走已 sync 的本地库

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

# WhaleTV Developer Power v2 — 开发者 AI 工作流助手

> 让每一个 WhaleTV 开发者在处理 PR/CR、Bug 分析、Cherry-Pick 时，都能像资深工程师一样高效闭环。

[![Kiro Power](https://img.shields.io/badge/Kiro-Power-purple)](https://kiro.dev)
[![Type](https://img.shields.io/badge/Type-MCP%20%2B%20Steering-blue)]()
[![License](https://img.shields.io/badge/License-UNLICENSED-red)]()
[![Version](https://img.shields.io/badge/Version-v2.0.0-brightgreen)]()

## 简介

WhaleTV Developer Power 是一个面向 WhaleTV 全体开发者的 [Kiro Power](https://kiro.dev)，把团队验证过的 MCP 服务器、工作流指南、知识库集成与凭据管理脚本打包成"开箱即用"的工具集：

- 🔧 把 Zmind Issue 变成**可执行的代码修改**
- 🔄 把 Cherry-Pick 变成**一键批量同步**
- 🐛 把 Bug 日志变成**结构化分析报告**
- 📚 把跨源历史经验变成**毫秒级检索**
- 🔐 把过期 cookie 变成**一条命令搞定**
- 🛡️ 把危险操作变成**三层防护拦截**

## v2.0.0 核心能力（已发布）

5 个 MCP 服务器、49 个工具、12 份工作流指南，覆盖项目管理 / 代码搜索 / 代码评审 / 文档检索 / 本地知识库五大领域。

### MCP 服务器一览

| 服务器 | 版本 | 工具 | 作用 |
|---|---|---|---|
| **zmind-mcp-server** | v2.1.1 | 16 | Issue 全套增删改查 + `prepare_issue_workspace` 一站式工作目录 + RAR5 三档解压 + Aliyun WAF 限速重试 |
| **gerrit-mcp-server** | v1.1.0 | 14 | REST 双通道认证（session 过 nginx 双层网关 / basic 直连），`cherry_pick_change` 自动执行，`get_unresolved_threads` 直接拿 uuid（无需 NoteDb） |
| **opengrok-mcp-server** | v1.2.0 | 4 | 全文 / 符号 / 路径搜索 + 文件读取 |
| **confluence-mcp-server** | v1.0.0（新） | 3 | `search_confluence`（CQL 自动包装）/ `get_page` / `list_spaces`，cookie 认证（独立账号 form login） |
| **knowledge-mcp-server** | v1.0.0（新） | 12 | 三源同步（zmind/gerrit/confluence）+ BGE-small-zh ONNX 嵌入 + SQLite BLOB 向量 + FTS5 全文 + hybrid 跨源检索 + AOSP 模块级精搜 + **`analyze_issue` 端到端工作流** |

### 工作流亮点

- **5 档代码搜索策略**：模块地图 → 本地知识库 → git grep → 已知路径 → OpenGrok（详见 `steering/local-code-guide.md`）
- **`analyze_issue` 一键端到端**：拉 issue → 准备工作目录 → 提取关键词 → 三源 hybrid 检索 → 平台/模块推断 → AOSP 精搜（可选）→ 渲染 `analysis-context.md`
- **凭据自动刷新**：`scripts/refresh-auth.{ps1,sh}` Playwright 一条命令搞定 Gerrit SSO + Confluence form login，自动写入 mcp.json

## 项目结构

```
whaletv-dev-power/
├── POWER.md                              # Kiro Power 元数据 + 概览（用户视角的功能说明）
├── README.md                             # 本文件（开发者视角的安装、配置、贡献指南）
├── mcp.json                              # MCP 服务器配置模板（5 个 server）
├── LICENSE
│
├── mcp-servers/
│   ├── zmind-mcp-server/                 # v2.1.1 — 16 个工具
│   │   └── src/
│   │       ├── index.ts                  # 工具注册 + stdio 启动
│   │       ├── attachment-handler.ts     # zip/tar/RAR5/7z 三档降级解压 + 0 字节防御
│   │       └── http-client.ts            # zmindFetch（WAF 重试 + 速率/并发门）
│   ├── opengrok-mcp-server/              # v1.2.0 — 4 个工具
│   ├── gerrit-mcp-server/                # v1.1.0 — 14 个工具（双通道认证）
│   │   └── src/
│   │       ├── index.ts                  # 14 个工具注册
│   │       ├── auth.ts                   # session / basic 双模式决策
│   │       ├── http-client.ts            # 按模式构造 headers + path
│   │       ├── errors.ts | types.ts | tool-helpers.ts
│   │       └── tools/                    # query / threads / cherry-pick / push / comment / reviewer
│   ├── confluence-mcp-server/            # v1.0.0（新）— 3 个工具
│   │   └── src/
│   │       ├── index.ts | auth.ts | http-client.ts | html-strip.ts
│   │       └── tools/                    # search / get-page / list-spaces
│   └── knowledge-mcp-server/             # v1.0.0（新）— 12 个工具
│       └── src/
│           ├── index.ts                  # 12 个工具注册
│           ├── db.ts                     # node:sqlite（Node 22.5+ 内置）+ FTS5 + 触发器
│           ├── embedder.ts               # @xenova/transformers BGE-small-zh ONNX
│           ├── index-store.ts            # 进程内 lazy Float32Array 矩阵
│           ├── search.ts                 # vector / fts / hybrid 三模式 + 跨源融合
│           ├── embed-pending.ts          # 三源批量嵌入
│           ├── analyze-issue.ts          # 端到端 PR/Bug 分析工作流
│           ├── sources/                  # zmind / gerrit / confluence 同步实现
│           └── aosp/                     # chunker / module-map-loader / indexer / search / embed
│
├── scripts/                              # v2 运维脚本
│   ├── package.json                      # Playwright ^1.48
│   ├── refresh-auth.mjs                  # 核心：Playwright 抓 cookie + form login + 写 mcp.json
│   ├── refresh-auth.ps1                  # Windows 壳（隐藏密码）
│   ├── refresh-auth.sh                   # Linux/macOS 壳
│   ├── setup-v2.ps1                      # Windows 一键部署（依赖检查 + Playwright 安装 + 凭据刷新）
│   └── setup-v2.sh                       # Linux/macOS 一键部署
│
├── steering/                             # 12 份工作流指南
│   ├── onboarding.md                     # 首次配置引导（v2 双账号说明）
│   ├── auth-refresh.md                   # 凭据自动刷新工作流（新）
│   ├── pr-cr-workflow.md                 # PR/CR 9 步处理（v2 起优先 search_local 找历史相似）
│   ├── cherry-pick-workflow.md           # Cherry-Pick 同步
│   ├── bug-analysis-workflow.md          # Bug 分析（v2 起优先 analyze_issue 一键模式）
│   ├── gerrit-workflow.md                # Gerrit 推送
│   ├── code-review-handling.md           # 评论三态处理（ACCEPT/REJECT/ACK）
│   ├── commit-message-workflow.md        # 智能 Commit + Branch_Detector 五级降级
│   ├── knowledge-base-workflow.md        # 本地知识库使用规范（新）
│   ├── module-path-map.md                # D4/X5/STB 模块路径地图
│   ├── local-code-guide.md               # 5 档代码搜索策略
│   └── safety-rules.md                   # 三层防护体系
│
├── hooks/
│   └── safety-hooks.json                 # 命令拦截规则
├── agent/
│   └── whaletv-dev.json                  # Kiro CLI Agent 配置（v2 prompt + 5 server）
├── .kiro/
│   ├── skills/                           # AI 行为指导（9 个 auto-inclusion）
│   └── specs/
│       ├── whaletv-dev-power/            # 原始 spec
│       └── v2-platform-upgrade/          # v2 升级三件套（requirements / design / tasks）
└── .learnings/                           # 经验沉淀（顶级，不在 .kiro 内）
    ├── LEARNINGS.md
    ├── ERRORS.md
    ├── FEATURE_REQUESTS.md               # FR-001 模块地图 + FR-002~009 v2 平台升级
    ├── v2-smoke-test-results.md          # smoke 19/19 通过
    └── v2-release-checklist.md           # 发布命令清单
```

## 安装

### 前置条件

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| [Kiro IDE](https://kiro.dev) | 最新 | AI 开发环境 |
| Node.js | **≥ 22.5.0** | knowledge-mcp 用 `node:sqlite` 内置模块 |
| 网络 | — | 能访问 zmind.whaletv.com / whale-gerrit.zeasn.com / docs.whaletv.com |
| 磁盘 | ≥ 5 GB | 含 ONNX 模型 ~80MB + 知识库索引 + 可选 AOSP 索引 |
| unar / 7z（可选） | — | 处理 .rar/.7z 附件用；Windows: `choco install unar 7zip` |

### Step 1：安装 Power

1. 打开 Kiro IDE → 左侧 **Powers** 面板 → **Add Power**
2. 选择 **From GitHub URL**，输入：
   ```
   https://github.com/KK-Irving/whaletv-dev-power
   ```
3. 等待安装完成

### Step 2：跑一键部署（推荐）

```powershell
# Windows
PowerShell -ExecutionPolicy Bypass -File scripts\setup-v2.ps1
```

```bash
# Linux / macOS
bash scripts/setup-v2.sh
```

脚本会：

1. 检查 Node ≥ 22.5、unar/7z 可选警告
2. 安装 Playwright + Chromium（首次约 150MB，后续刷新秒级）
3. 调用 `refresh-auth` 抓 Gerrit + Confluence cookie 写入 `~/.kiro/settings/mcp.json`
4. 提示手填的 `ZMIND_API_KEY` / `OPENGROK_*` 凭据位置

### Step 3：手填两组凭据

打开 `~/.kiro/settings/mcp.json`，在对应 `env` 字段填入：

```jsonc
{
  "mcpServers": {
    "zmind-mcp-server": {
      "env": {
        "ZMIND_API_KEY": "<40 位十六进制>"  // 登录 zmind.whaletv.com → 我的账户 → API 访问密钥
      }
    },
    "opengrok-mcp-server": {
      "env": {
        "OPENGROK_USERNAME": "<公司分配账号>",
        "OPENGROK_PASSWORD": "<对应密码>"
      }
    },
    "knowledge-mcp-server": {
      "env": {
        "ZMIND_API_KEY": "<同上>"  // knowledge-mcp 复用 zmind 凭据做 sync_zmind
      }
    }
  }
}
```

完整模板见仓库根的 [`mcp.json`](mcp.json)。

### Step 4：重启 Kiro

让 5 个 MCP server 用新凭据启动。Kiro 重启后在对话中说 `配置` / `setup` 触发 `onboarding` 流程做最终验证。

## 凭据管理（v2 关键）

公司四大系统用**四套独立凭据**，需求各异：

| 系统 | 用户名 | 凭据形式 | 进 mcp.json | 由什么填入 |
|---|---|---|---|---|
| **Zmind** | — | API Key（40 位） | ✅ `ZMIND_API_KEY` | 手填一次，永久 |
| **Gerrit SSO** | `winn.wei`（小写） | SSO 登录密码 | ❌（仅刷新时输入） | `refresh-auth` 抓 cookie 后只存 `GERRIT_AUTH_HEADER + GERRIT_COOKIE` |
| **Gerrit HTTP Credentials** | `winn.wei` | 应用 Token | ❌（公司部署用不上） | — |
| **Confluence** | `Winn.Wei`（首字母大写） | 独立密码（不同于 SSO） | ❌（仅刷新时输入） | `refresh-auth` form login 后存 `CONFLUENCE_COOKIE` |
| **OpenGrok** | `zeasnrd` | 共享只读密码 | ✅ `OPENGROK_USERNAME + PASSWORD` | 手填一次，永久 |

### Gerrit 双通道认证（v1.1 关键）

公司 Gerrit 部署在 nginx + Gerrit 双层认证网关后。HTTP 协议规定单请求只能携带 1 个 `Authorization` 头，但允许 1 个 `Authorization` + 1 个 `Cookie` 同时存在：

```
Authorization: Basic <SSO 用户名:SSO 密码 b64>     ← 满足 nginx 那一层
Cookie: GerritAccount=...; XSRF_TOKEN=...        ← 满足 Gerrit 自身 session
请求路径：non-/a/（如 /changes/...，不是 /a/changes/）
```

启动 banner 会显示当前模式：`auth_mode=session` / `basic` / `missing`。

### Confluence 是独立账号

跟 Gerrit SSO 是**两套不同账号**：用户名首字母可能大写、密码独立。`refresh-auth` 会单独 prompt 收 Confluence 凭据，走 form POST `/dologin.action` 登录，不走 SSO。

### cookie 过期（典型 1-4 周）

任何 Gerrit / Confluence 工具返回 `auth_failed (401)` / `302 → /login.action` → 跑：

```powershell
PowerShell -ExecutionPolicy Bypass -File scripts\refresh-auth.ps1   # Windows
bash scripts/refresh-auth.sh                                         # Linux/macOS
```

详见 [`steering/auth-refresh.md`](steering/auth-refresh.md)。

## 使用方式

### Workspace 要求

Kiro 只能操作**当前 workspace 目录内**的文件。源码目录必须作为 workspace 打开。

- **Windows（Samba 映射）**：File → Open Folder → 源码映射路径（如 `W:\code\950_stm\amlogic`）
- **Linux**：在源码根启动 Kiro CLI（如 `cd ~/cvte_code/amlogic && kiro`）

### 自然语言触发示例

```
# v2 一键端到端（推荐）
"用 analyze_issue 分析 #334001"
"用 analyze_issue 分析 #334001，include_aosp=true，platform=X5"

# 跨源知识检索
"用 search_local 找'蓝牙连接异常'相关历史记录"
"在 confluence 搜 OTA 升级"

# PR/CR 处理
"帮我处理 PR #12345"
"处理下这个 CR"

# Bug 分析（分步）
"分析下 #334001"          # 触发 bug-analysis-workflow

# Cherry-Pick
"把 #332669 cp 到 mp"
"cherry-pick I1234567 到 mp 分支"

# Gerrit 操作
"推送代码到 Gerrit"
"查询 #332669 的 Gerrit 提交记录"

# Zmind 日常
"查看我的待办"
"记录 2 小时工时到 #12345"
"创建一个 Issue，项目是 xxx，标题是 xxx"

# 知识库维护
"用 sync_zmind 拉 1000 条；用 embed_pending 处理 zmind"
"重建 X5 平台 tvsystemui 模块的 AOSP 索引"
```

## 工具列表

### Zmind v2.1.1（16 个）

| 工具 | 功能 |
|---|---|
| `get_issue` | Issue 详情（评论、附件、关联、子任务） |
| `my_issues` | 我的 Issue 列表 |
| `search_issues` | 关键词搜索 |
| `update_issue` | 状态/指派/优先级/完成度 |
| `create_issue` | 创建 Issue |
| `add_comment` | 添加评论 |
| `create_time_entry` | 工时记录 |
| `download_attachment` | 附件下载（v2.0 新增 `save_to`） |
| `list_projects` / `get_versions` / `get_project_members` / `get_issue_statuses` / `get_trackers` / `get_priorities` / `get_time_activities` | 元信息查询 |
| ★ `prepare_issue_workspace` | **一站式**创建 `.workspace/issue-<id>/` + 下载 + 路由（zip/tar/RAR5 三档解压、图片/HCI/PDF 工具检测） |

### Gerrit v1.1.0（14 个）

**读（5）**：`query_change` / `list_branches` / `get_change_comments` / `get_unresolved_threads`（直接拿 uuid，无需 NoteDb） / `search_changes`

**写（9）**：`cherry_pick_change`（★ 自动执行）/ `push_to_gerrit`（git+SSH，唯一 SSH 通道）/ `submit_review_reply`（批量原子）/ `add_review_comment` / `reply_inline_comment` / `mark_comment_resolved` / `add_reviewer` / `remove_reviewer` / `set_review_label`

### OpenGrok（4 个）

`search_code` / `search_symbol` / `search_path` / `get_file_content`

可用项目：`d4_code` / `stb16_code` / `x5_code`（公版代码）

### Confluence v1.0.0（3 个）

`search_confluence`（CQL 自动包装）/ `get_page`（HTML 转纯文本，截 8000 字）/ `list_spaces`

### Knowledge v1.0.0（12 个）

**同步**：`sync_zmind` / `sync_gerrit` / `sync_confluence`

**嵌入**：`embed_pending`（三源）/ `embed_aosp_pending`

**检索**：`search_local`（hybrid / vector / fts × 单源/all 跨源融合）/ `get_indexed`

**AOSP 精搜**：`list_aosp_modules` / `index_aosp_module` / `clear_aosp_index` / `search_aosp`

★ **端到端**：`analyze_issue`

## 外部系统集成

```
┌──────────────────────────────────────────────────────────────┐
│  whaletv-dev-power v2                                         │
│                                                                │
│  MCP Server 层（5 个 server，49 个工具）：                       │
│  ├── zmind-mcp-server    (v2.1.1, 16 tools)                   │
│  │     └─ prepare_issue_workspace + RAR5 + WAF retry          │
│  ├── gerrit-mcp-server   (v1.1.0, 14 tools)                   │
│  │     └─ session/basic 双通道，cherry_pick 自动执行          │
│  ├── opengrok-mcp-server (v1.2.0, 4 tools)                    │
│  ├── confluence-mcp-server (v1.0.0, 3 tools)                  │
│  │     └─ cookie 认证（form login 独立账号）                    │
│  └── knowledge-mcp-server (v1.0.0, 12 tools)                  │
│        └─ 三源同步 + 向量+FTS5 + analyze_issue                 │
│                                                                │
│  Steering 层（12 份工作流指南）：                                │
│  ├── 流程：pr-cr / cherry-pick / bug-analysis / gerrit /        │
│  │         code-review-handling / commit-message              │
│  ├── 配置：onboarding / auth-refresh                          │
│  ├── 知识：knowledge-base-workflow / module-path-map /         │
│  │         local-code-guide                                   │
│  └── 安全：safety-rules                                        │
│                                                                │
│  运维脚本：refresh-auth + setup-v2                             │
└──────────────────────────────────────────────────────────────┘
            │                │              │            │
            ▼                ▼              ▼            ▼
     ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐
     │  Zmind   │  │   Gerrit     │  │Confluence│  │ OpenGrok │
     │ (Redmine)│  │ (REST + SSH) │  │  (cookie)│  │  (Basic) │
     └──────────┘  └──────────────┘  └──────────┘  └──────────┘
```

| 系统 | 地址 | 认证方式 |
|---|---|---|
| Zmind | https://zmind.whaletv.com | API Key (`X-Redmine-API-Key`) |
| Gerrit | https://whale-gerrit.zeasn.com | session 模式 = Authorization Basic + Cookie（推荐，过 nginx 双层）/ basic 模式 = HTTP Credentials（直连无 nginx）/ SSH 公钥（仅 push_to_gerrit） |
| Confluence | https://docs.whaletv.com | Cookie（独立账号 form login，不走 SSO） |
| OpenGrok | https://opengrok.zeasn.com | HTTP Basic Auth（共享或个人账号） |

## mcp.json 完整模板

完整模板见仓库根的 [`mcp.json`](mcp.json)。配置文件位置：`~/.kiro/settings/mcp.json`。

```jsonc
{
  "mcpServers": {
    "zmind-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/zmind-mcp-server@latest"],
      "env": {
        "ZMIND_URL": "https://zmind.whaletv.com",
        "ZMIND_API_KEY": "<填>",
        "ZMIND_HTTP_MIN_INTERVAL": "0",
        "ZMIND_FETCH_CONCURRENCY": "2"
      },
      "disabled": false
    },
    "opengrok-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/opengrok-mcp-server@latest"],
      "env": {
        "OPENGROK_URL": "https://opengrok.zeasn.com",
        "OPENGROK_USERNAME": "<填>",
        "OPENGROK_PASSWORD": "<填>"
      },
      "disabled": false
    },
    "gerrit-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/gerrit-mcp-server@latest"],
      "env": {
        "GERRIT_URL": "https://whale-gerrit.zeasn.com",
        "GERRIT_AUTH_HEADER": "<refresh-auth 自动填>",
        "GERRIT_COOKIE": "<refresh-auth 自动填>",
        "GERRIT_USERNAME": "",
        "GERRIT_HTTP_PASSWORD": "",
        "GERRIT_TIMEOUT_MS": "30000"
      },
      "disabled": false
    },
    "confluence-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/confluence-mcp-server@latest"],
      "env": {
        "CONFLUENCE_BASE_URL": "https://docs.whaletv.com",
        "CONFLUENCE_COOKIE": "<refresh-auth 自动填>",
        "CONFLUENCE_REQUEST_DELAY_MS": "150"
      },
      "disabled": false
    },
    "knowledge-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/knowledge-mcp-server@latest"],
      "env": {
        "ZMIND_API_KEY": "<同 zmind 字段>",
        "GERRIT_AUTH_HEADER": "<同 gerrit 字段>",
        "GERRIT_COOKIE": "<同 gerrit 字段>",
        "CONFLUENCE_COOKIE": "<同 confluence 字段>"
      },
      "disabled": false
    }
  }
}
```

> 💡 用 `@latest` 标签让 npx 启动时自动检查并拉最新版本。
> ⚠️ Gerrit 优先 session 模式（`GERRIT_AUTH_HEADER + GERRIT_COOKIE`），公司部署 nginx 双层认证下 basic 模式无法穿透。
> ⚠️ knowledge-mcp 复用三源凭据，避免重复维护；填值与对应单 server 保持一致。

## 安全机制

| 层级 | 机制 | 示例 |
|---|---|---|
| 第一层 | 规则约束 | MP 分支禁止自动推送、`git add` 必须用 `-p`、target version 必须用户指定 |
| 第二层 | Hook 拦截 | 禁止 sudo、禁止搜索 out/prebuilts、禁止 `git add .` / `git add -A` |
| 第三层 | 人工确认 | push 前展示 commit 信息等待确认、cherry_pick conflict 不盲目继续 |

详见 [`steering/safety-rules.md`](steering/safety-rules.md)。

## 开发

### 编译检查

```bash
# 5 个 server 全编译
cd mcp-servers/zmind-mcp-server      && npx tsc --noEmit
cd ../gerrit-mcp-server              && npx tsc --noEmit
cd ../opengrok-mcp-server            && npx tsc --noEmit
cd ../confluence-mcp-server          && npx tsc --noEmit
cd ../knowledge-mcp-server           && npx tsc --noEmit
```

### MCP Inspector 调试

```bash
# Zmind
cd mcp-servers/zmind-mcp-server
ZMIND_API_KEY=your_key npx @modelcontextprotocol/inspector npx tsx src/index.ts

# Gerrit（需先跑 refresh-auth 拿到 GERRIT_AUTH_HEADER + GERRIT_COOKIE）
cd mcp-servers/gerrit-mcp-server
GERRIT_URL=https://whale-gerrit.zeasn.com \
  GERRIT_AUTH_HEADER="$GERRIT_AUTH_HEADER" \
  GERRIT_COOKIE="$GERRIT_COOKIE" \
  npx @modelcontextprotocol/inspector npx tsx src/index.ts

# Knowledge（首次启动会下载 BGE-small-zh ONNX 模型 ~80MB）
cd mcp-servers/knowledge-mcp-server
ZMIND_API_KEY=your_key \
  GERRIT_AUTH_HEADER="..." GERRIT_COOKIE="..." \
  CONFLUENCE_COOKIE="..." \
  npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

### 发布到 npm

```bash
# 单 server 发布
cd mcp-servers/<server-name>
npm version patch                  # patch / minor / major
npm publish --access=public        # 用户级 ~/.npmrc 已存 token

# v2 整版发布命令清单见 .learnings/v2-release-checklist.md
```

## 技术栈

| 技术 | 用途 |
|---|---|
| TypeScript ES2022 | 5 个 MCP server 实现 |
| @modelcontextprotocol/sdk 1.12.1 | MCP 协议框架 |
| zod 3.24.4 | 运行时参数校验 |
| node:sqlite（Node 22.5+ 内置） | knowledge-mcp 的本地数据库（无 native 编译依赖） |
| @xenova/transformers 2.17 | BGE-small-zh ONNX 嵌入（CPU 推理，无 GPU 依赖） |
| yauzl + tar | zip / tar.gz 解压（zmind-mcp） |
| unar / unrar / 7z（外部命令） | RAR5 / 7z 三档降级解压 |
| Playwright 1.48 + Chromium | refresh-auth 自动登录抓 cookie |
| stdio JSON-RPC | MCP 传输协议 |
| HTTPS REST API | 各系统集成 |
| HTTP Basic Auth + Cookie | Gerrit 双通道 / Confluence cookie 认证 |
| git + SSH (29418) | gerrit-mcp 的 push_to_gerrit（唯一 SSH 通道） |

## 与 FAE Power 的关系

```
┌──────────────────────────────────────────────────────┐
│  whaletv-dev-power v2 (本项目)                        │
│  └── 5 MCP server (49 tools) + 12 steering           │
└──────────────────────────────────────────────────────┘
              ↑ 提供工具能力
              │
┌──────────────────────────────────────────────────────┐
│  fae-power                                            │
│  └── steering/fae-skill.md (FAE 行为指导)             │
│      - 技术问答、完整性检查、日志收集                    │
│      - 工单管理、客户沟通、风险评估                      │
└──────────────────────────────────────────────────────┘
```

**分工**：
- `whaletv-dev-power` = **工具层** + 开发者工作流（提供 Zmind / Gerrit / Confluence / OpenGrok / 本地知识库五大能力）
- `fae-power` = **FAE 行为层**（指导 AI 如何为 FAE 工程师服务）

两者同时安装时，AI 自动组合能力。

## Roadmap

### ✅ Phase 1 (v1.x)
- Zmind / OpenGrok / Gerrit MCP 三件套
- PR/CR、Cherry-Pick、Bug 分析、Gerrit 推送、Code Review 五大工作流
- 智能 Commit Message 生成（Branch_Detector 五级降级）
- 模块路径地图（D4 / X5 / STB 三平台）
- 三层安全防护

### ✅ Phase 2 (v2.0.0 — 已发布)
- **Gerrit 双通道认证**（v1.1.0 — 过公司 nginx 双层认证网关）
- **Zmind RAR5 + WAF 应对**（v2.1.1 — 三档降级解压 + 限速重试）
- **Confluence MCP**（v1.0.0 — 文档中心检索）
- **Knowledge MCP**（v1.0.0 — 三源同步 + 向量+FTS5 hybrid 跨源检索 + analyze_issue 端到端工作流 + AOSP 模块级精搜）
- **凭据自动刷新**（refresh-auth — Playwright 一键搞定 Gerrit + Confluence cookie）
- **一键部署**（setup-v2.{ps1,sh}）
- 5 档代码搜索策略升级

### 🔜 Phase 3（计划中）
- [ ] Kiro CLI Agent 完整支持（`kiro-cli chat --agent whaletv-dev`，CLI 端 steering/skills 加载）
- [ ] 知识库定时同步（cron / 后台任务）
- [ ] AOSP 全平台预编译索引（D4/X5/STB 完整模块覆盖）
- [ ] 多代码库批量操作支持

### 🔮 Phase 4（远期）
- [ ] 自动识别 Issue 类型并推荐工作流
- [ ] 跨项目 Issue 关联分析
- [ ] 团队代码提交统计与趋势分析
- [ ] 与钉钉 / 企业微信集成

## 贡献

欢迎团队成员贡献：

- 补充 / 修正 Steering 文件中的工作流步骤
- 新增 MCP 工具或扩展现有工具能力
- 完善安全规则与 Hook 拦截模式
- 补充模块路径地图（D4/X5/STB 漏掉的子模块）
- 提交新的 Skill 文件

提交前请：

1. 在 `.learnings/FEATURE_REQUESTS.md` 登记新需求
2. 大改动建议先在 `.kiro/specs/` 走 requirements / design / tasks 三件套
3. 改动 MCP server 后跑 `npx tsc --noEmit` 编译检查
4. 改动 steering 后用 `kiro_powers` activate 验证不破坏其他 Power

## License

⚠️ **UNLICENSED** — 本项目为 WhaleTV / Zeasn 内部专有软件，仅限内部使用。

未经授权，禁止复制、分发、修改或以任何形式对外使用本软件。详见 [LICENSE](./LICENSE) 文件。

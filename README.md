# WhaleTV Developer Power v3 — 开发者 AI 工作流助手

> 让每一个 WhaleTV 开发者在处理 PR/CR、Bug 分析、Cherry-Pick 时，都能像资深工程师一样高效闭环。

[![Kiro Power](https://img.shields.io/badge/Kiro-Power-purple)](https://kiro.dev)
[![Type](https://img.shields.io/badge/Type-MCP%20%2B%20Steering%2B%20Skills-blue)]()
[![License](https://img.shields.io/badge/License-UNLICENSED-red)]()
[![Version](https://img.shields.io/badge/Version-v3.0.0-brightgreen)]()

## 简介

WhaleTV Developer Power 是一个面向 WhaleTV 全体开发者的 [Kiro Power](https://kiro.dev)，把团队验证过的 MCP 服务器、工作流指南、知识库集成与凭据管理脚本打包成"开箱即用"的工具集：

- 🔧 把 Zmind Issue 变成**可执行的代码修改**
- 🔄 把 Cherry-Pick 变成**一键批量同步**
- 🐛 把 Bug 日志变成**结构化分析报告**
- 📚 把跨源历史经验变成**毫秒级检索**
- 🔐 把过期 cookie 变成**一条命令搞定**
- 🛡️ 把危险操作变成**三层防护拦截**

## v3.0.0 架构级升级（本轮）

**v3 聚焦架构治理，v2 已发布的所有功能能力完整保留**：

- **Kiro 官方 hook 格式修复**（P0）：v2 的 `hooks/safety-hooks.json` 用自定义 schema，Kiro 实际不加载 —— 三层防护第二层是空的。v3 拆成 7 个符合 Kiro 官方 schema 的独立 JSON，部署后立即生效
- **单一凭据源 SoT**：`~/.ai/whaletv.yaml` 一处修改 5 个 MCP server 全部生效；`whaletv-credentials` CLI 提供 get/set/check/list/init/migrate
- **一键部署脚本**：`node scripts/deploy.mjs` 把 steering / hooks / skills 一次同步到 `~/.kiro/`
- **description-driven skills**：12 份 workflow steering 迁移到 `.kiro/skills/whaletv-*/SKILL.md`，Kiro 通过 YAML front-matter 语义匹配自动激活
- **精简 steering**：只保留 5 份 `inclusion: always` 的核心规则（critical / conventions / execution / module-path-map / safety-rules）
- **跨终端 CLI**：`whaletv-credentials` / `gerrit-api` / `gerrit-show` 三个 CLI 工具，Kiro 之外的终端也能用

## v2.0.0 核心能力（已发布）

5 个 MCP 服务器、49 个工具、12 份工作流指南，覆盖项目管理 / 代码搜索 / 代码评审 / 文档检索 / 本地知识库五大领域。

### MCP 服务器一览

| 服务器 | 版本 | 工具 | 作用 |
|---|---|---|---|
| **zmind-mcp-server** | v2.1.1 | 16 | Issue 全套增删改查 + `prepare_issue_workspace` 一站式工作目录 + RAR5 三档解压 + Aliyun WAF 限速重试 |
| **gerrit-mcp-server** | v1.1.0 | 14 | REST 双通道认证（session 过 nginx 双层网关 / basic 直连），`cherry_pick_change` 自动执行，`get_unresolved_threads` 直接拿 uuid（无需 NoteDb） |
| **opengrok-mcp-server** | v1.2.0 | 4 | 全文 / 符号 / 路径搜索 + 文件读取 |
| **confluence-mcp-server** | v1.0.0（新） | 3 | `search_confluence`（CQL 自动包装）/ `get_page` / `list_spaces`，cookie 认证（独立账号 form login） |
| **knowledge-mcp-server** | v1.0.2 → **v1.1.0**（v3） | 12 → **14** | 三源同步（zmind/gerrit/confluence）+ BGE-small-zh ONNX 嵌入 + SQLite BLOB 向量 + FTS5 全文 + hybrid 跨源检索 + AOSP 模块级精搜 + `analyze_issue` 端到端工作流；v1.0.2 加 Confluence searchv3 fallback；**v1.1.0 新增 `generate_report` + `upload_report`（治理层）** |

### 工作流亮点

- **5 档代码搜索策略**：模块地图 → 本地知识库 → git grep → 已知路径 → OpenGrok（详见 skill `whaletv-local-code`）
- **`analyze_issue` 一键端到端**：拉 issue → 准备工作目录 → 提取关键词 → 三源 hybrid 检索 → 平台/模块推断 → AOSP 精搜（可选）→ 渲染 `analysis-context.md`
- **凭据自动刷新**：`scripts/refresh-auth.{ps1,sh}` Playwright 一条命令搞定 Gerrit SSO + Confluence form login，v3 起写入 SoT（`~/.ai/whaletv.yaml`）+ 兼容双写 mcp.json

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
│   └── knowledge-mcp-server/             # v1.0.2 → v1.1.0（v3）— 14 个工具
│       └── src/
│           ├── index.ts                  # 14 个工具注册（v3 加 generate_report + upload_report）
│           ├── tools/
│           │   ├── report-schema.ts      # v3: Report Fact v1 类型 + runtime 验证
│           │   ├── report-template.ts    # v3: 自包含 HTML 模板（内嵌 CSS+JS）
│           │   ├── generate-report.ts    # v3: 生成 JSON + HTML 落盘
│           │   └── upload-report.ts      # v3: S3 SigV4 上传（零依赖）
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
│   ├── refresh-auth.mjs                  # 核心：Playwright 抓 Gerrit/Confluence cookie，深合并写 mcp.json（含 Power namespace 双写）
│   ├── refresh-auth.ps1                  # Windows 壳（隐藏密码）
│   ├── refresh-auth.sh                   # Linux/macOS 壳
│   ├── setup-creds.mjs                   # Zmind / OpenGrok 永久凭据写入（绕过 Kiro IDE workspace 限制）
│   ├── setup-v2.ps1                      # Windows 一键部署（依赖 + Playwright + 4 套凭据交互 + setup-creds + refresh-auth）
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
├── hooks/                                # v3 起符合 Kiro 官方 schema，一 hook 一 JSON
│   ├── block-sudo.json                   # 拦截 sudo 命令
│   ├── block-mp-push.json                # 拦截推送到 *_mp 保护分支
│   ├── block-root-search.json            # 拦截根目录/家目录大范围搜索
│   ├── block-tmp-write.json              # 拦截写入 /tmp
│   ├── block-out-search.json             # 拦截搜索 out/ 与 prebuilts/
│   ├── block-git-add-all.json            # 拦截 git add . / -A / --all
│   └── block-bulk-copy-out.json          # 拦截 rsync/cp -r 批量复制大目录
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

**必需依赖**：

| 依赖 | 版本要求 | 说明 | 安装 |
|---|---|---|---|
| [Kiro IDE](https://kiro.dev) | 最新 | AI 开发环境 | 官网下载 |
| Node.js | **≥ 22.5.0** | knowledge-mcp 用 `node:sqlite` 内置模块；`whaletv-credentials` CLI 用 native fs | Windows: `winget install OpenJS.NodeJS`<br>macOS: `brew install node`<br>Linux: [nodejs.org](https://nodejs.org/) |
| 网络访问 | — | 能访问 `zmind.whaletv.com` / `whale-gerrit.zeasn.com` / `docs.whaletv.com` / `opengrok.zeasn.com`（都是内网）+ `astral.sh` / `npmjs.org`（首次安装用） | 公司内网 |
| 磁盘 | ≥ 5 GB | 含 ONNX 模型 ~80MB + 知识库索引 ~500MB + 可选 AOSP 索引（几个 G） | — |

**可选依赖**（有更好，无也能跑）：

| 依赖 | 用途 | Windows | Linux | macOS |
|---|---|---|---|---|
| unar | RAR5 附件解压（推荐） | `choco install unar` | `apt install unar` | `brew install unar` |
| 7-Zip | RAR / 7z 附件解压（fallback） | `choco install 7zip` | `apt install p7zip-full` | `brew install p7zip` |
| unrar | RAR 附件解压（fallback） | — | `apt install unrar` | `brew install unrar` |
| pdftotext | PDF 附件转文本 | `choco install poppler` | `apt install poppler-utils` | `brew install poppler` |
| tshark | HCI / btsnoop 日志分析 | Wireshark 安装包含 | `apt install tshark` | `brew install wireshark` |
| 4 套账号 | 详见"凭据管理"章节 | Zmind + Gerrit SSO + Confluence + OpenGrok | | |

**权限要求**：无 sudo，不修改系统。所有安装都到 `~/.kiro/` / `~/.ai/` / 仓库目录内。

---

### v2 → v3 迁移路径

从 v2.x 升级到 v3，一条命令完成：

```bash
# 1. 拉最新代码
git pull

# 2. 部署 v3 结构（会自动备份旧 ~/.kiro/ 到 .kiro.backup-<ts>/）
node scripts/deploy.mjs

# 3. 迁移凭据 mcp.json → SoT
node scripts/whaletv-credentials.mjs migrate

# 4. 检查
node scripts/whaletv-credentials.mjs check

# 5. 重启 Kiro（Reload Window）
```

`migrate` 会读现有 `~/.kiro/settings/mcp.json` 中的 env 值，写入 `~/.ai/whaletv.yaml`。原 mcp.json 不动（sot-loader 的 env 优先规则保证向后兼容）。

**v2 → v3 变化清单**（用户感知层面）：

| 维度 | v2 | v3 |
|---|---|---|
| Hook | `hooks/safety-hooks.json`（自定义 schema，Kiro **不加载**）| 7 个独立 JSON `hooks/*.json`（Kiro 官方 schema，自动加载）|
| 凭据 | 分散在 mcp.json 5 个 server 的 env | 单一真源 `~/.ai/whaletv.yaml` + `whaletv-credentials` CLI |
| Workflow | 12 份长 steering | 10 个 `.kiro/skills/whaletv-*/SKILL.md`（description-driven）+ 6 个通用 skill |
| Steering | 12 份混合内容 | 5 份精简 rules（critical / conventions / execution / module-path-map / safety-rules）|
| 部署 | 手工复制 / Power 安装 | `node scripts/deploy.mjs` 一键幂等 |
| CLI 工具 | 无 | `whaletv-credentials` / `gerrit-api` / `gerrit-show` 三个跨终端工具 |
| MCP servers | 5 个（v2.1.1 / v1.1.0 / v1.2.0 / v1.0.0 / v1.0.2）| 5 个（内部加了 sot-loader；**knowledge-mcp bump 到 v1.1.0** 新增 generate_report + upload_report；其他 4 个工具集不变，向后兼容 v2 env）|

**回滚 v3 → v2**：如果 v3 有问题，`.kiro.backup-<ts>/` 有 v2 部署的完整快照。手工恢复即可（v3 部署不会删除 mcp.json）。

### Step 1：安装 Power

1. 打开 Kiro IDE → 左侧 **Powers** 面板 → **Add Power**
2. 选择 **From GitHub URL**，输入：
   ```
   https://github.com/KK-Irving/whaletv-dev-power
   ```
3. 等待安装完成

### Step 2：跑一键部署（v3 推荐流程）

**v3 起提供 `scripts/deploy.mjs`** —— 把 steering / hooks / .kiro/skills 一次同步到目标 `~/.kiro/` 或 workspace 的 `.kiro/`，并把 `bin/` 加入 PATH。适用于**非 Kiro Power 安装场景**（如直接 clone 仓库、跨机器同步、workspace 级部署）。

```powershell
# Windows — 部署到 ~/.kiro/（用户级，所有 workspace 都能用）
node scripts\deploy.mjs

# 或部署到指定 workspace 的 .kiro/（workspace 级）
node scripts\deploy.mjs --workspace D:\code\my-workspace

# 先看会做什么，不实际写入（dry-run）
node scripts\deploy.mjs --dry-run
```

```bash
# Linux / macOS
node scripts/deploy.mjs                             # 默认 ~/.kiro/
node scripts/deploy.mjs --workspace ~/code/xxx      # 指定 workspace
node scripts/deploy.mjs --dry-run                   # 预演
```

`deploy.mjs` 特性：

- **幂等**：重复运行不产生副作用；每次运行前自动备份 `.kiro/` 到 `.kiro.backup-<ts>/`（保留最近 3 份）
- **迁移检测**：如果之前部署到别的仓库路径，会在 PATH 里替换旧条目并提示旧位置
- **锁检测**：Kiro IDE 运行时拒绝写入，避免文件锁失败
- **schema 校验**：hook JSON 部署前校验必需字段（name/version/when/then），不合规则拒绝写入
- **可选跳过**：`--skip-hooks` / `--skip-steering` / `--skip-skills` / `--no-path`

### Step 3：配置凭据（v3 单一真源）

**v3 起凭据统一由 `~/.ai/whaletv.yaml` 管理**（Single Source of Truth，SoT），所有 MCP server 与 CLI 工具通过 `whaletv-credentials get <key>` 读取。

**初次配置**（三选一）：

```bash
# 方式 A：交互式创建 SoT（推荐，最简洁）
whaletv-credentials init

# 方式 B：从旧的 mcp.json 一次性迁移
whaletv-credentials migrate

# 方式 C（兼容）：仍支持 v2 的 setup-v2.{ps1,sh} 全流程一键部署
PowerShell -ExecutionPolicy Bypass -File scripts\setup-v2.ps1   # Windows
bash scripts/setup-v2.sh                                          # Linux / macOS
```

**session 凭据刷新**（Gerrit + Confluence cookie 1-4 周会过期）：

```bash
# 跑 Playwright 自动抓 cookie 写入 SoT（v3 起自动写 SoT，兼容 v2 写 mcp.json）
PowerShell -ExecutionPolicy Bypass -File scripts\refresh-auth.ps1   # Windows
bash scripts/refresh-auth.sh                                         # Linux / macOS
```

**校验与查询**：

```bash
whaletv-credentials check                    # 校验必需字段
whaletv-credentials list                     # 列出已配置键（不含值）
whaletv-credentials get zmind.api_key        # 拿单个值
whaletv-credentials set gerrit.cookie "..."  # 手动更新单字段
whaletv-credentials path                     # 打印 SoT 文件路径
```

四套账号系统（**Gerrit SSO 与 Confluence 是完全独立的账号系统**，用户名/密码可能不同）：

| 系统 | 用户名规则 | 密码 | 键 |
|---|---|---|---|
| Zmind | — | 40 位十六进制 API Key（我的账户 → API 访问密钥） | `zmind.api_key` |
| OpenGrok | 全小写 | 共享或个人密码 | `opengrok.username` / `opengrok.password` |
| Gerrit SSO | 全小写（如 `winn.wei`） | SSO 密码（refresh-auth 抓 cookie） | `gerrit.auth_header` / `gerrit.cookie` |
| Confluence | 首字母大写（如 `Winn.Wei`） | 独立密码（refresh-auth 抓 cookie） | `confluence.cookie`（+ `confluence.username`/`password` 用于刷新时输入） |

### Step 4：重启 Kiro 加载新凭据

`Reload Window`（⌘/Ctrl+Shift+P）或退出重开。

5 个 MCP server 从 SoT 读凭据启动，可在 Kiro 内直接使用所有功能。

完整模板见 [`templates/whaletv.yaml.tmpl`](templates/whaletv.yaml.tmpl)。重启后在对话中说"配置" / "setup"触发 `onboarding` 流程做最终验证。

## 凭据管理（v2 关键）

公司四大系统用**四套独立凭据**，需求各异：

| 系统 | 用户名 | 凭据形式 | 进 mcp.json | 由什么填入 |
|---|---|---|---|---|
| **Zmind** | — | API Key（40 位） | ✅ `ZMIND_API_KEY` | `setup-creds.mjs`（setup-v2 自动调），永久 |
| **Gerrit SSO** | `winn.wei`（小写） | SSO 登录密码 | ✅ `GERRIT_AUTH_HEADER` + `GERRIT_COOKIE` | `refresh-auth.mjs`（setup-v2 自动调）抓 cookie，1-4 周刷新 |
| **Gerrit HTTP Credentials** | `winn.wei` | 应用 Token | ❌（公司双层认证下用不上） | — |
| **Confluence** | `Winn.Wei`（首字母大写） | 独立密码（不同于 SSO） | ✅ `CONFLUENCE_COOKIE` | `refresh-auth.mjs` form login 抓 cookie |
| **OpenGrok** | `zeasnrd` | 共享只读密码 | ✅ `OPENGROK_USERNAME + PASSWORD` | `setup-creds.mjs`（setup-v2 自动调），永久 |

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

详见 skill `whaletv-auth-refresh`（[`.kiro/skills/whaletv-auth-refresh/SKILL.md`](.kiro/skills/whaletv-auth-refresh/SKILL.md)）。

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

所有 MCP 工具按 **`<server> v<version> — <一句话定位>`（工具数）+ 分组表格** 的统一格式列出。**★ 标记**表示 v2/v3 新增或"一站式"能力，值得优先关注。

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

## CLI 工具（跨终端，v3 新增）

除了 MCP 工具（在 Kiro 内使用）外，v3 提供 3 个跨终端 CLI 工具。在**任意终端**（Windows cmd/PowerShell、Linux bash、macOS zsh）都可直接调用，无需打开 Kiro。

**前置条件**：先跑 `node scripts/deploy.mjs` 部署到 `~/.kiro/`，deploy 会把 `<repo>/bin` 加入 PATH。重启终端后 CLI 命令即可直接使用。

### whaletv-credentials — 单一凭据源管理

```bash
whaletv-credentials init             # 交互式创建 SoT
whaletv-credentials migrate          # 从 mcp.json 一次性迁移
whaletv-credentials get <key>        # 读单个凭据（如 zmind.api_key）
whaletv-credentials set <key> <val>  # 写单个凭据
whaletv-credentials check            # 校验必需字段（Zmind + OpenGrok + Gerrit 至少一组齐全）
whaletv-credentials list             # 列出已配置的键（不含值）
whaletv-credentials path             # 打印 SoT 路径
```

**示例**：

```bash
# 只更新一个字段（不覆盖其他）
whaletv-credentials set gerrit.cookie "GerritAccount=xxx; XSRF_TOKEN=yyy"

# 校验后启动 Kiro
whaletv-credentials check && echo "OK, launch Kiro"
```

**特性**：
- 零第三方依赖（自己解析 YAML；避免 `npm install` 依赖）
- 每次写入自动备份 `~/.ai/whaletv.yaml.bak.<ts>`（保留最近 3 份）
- Linux/macOS 自动 `chmod 0600`

### gerrit-api — Gerrit REST API 通用客户端

```bash
gerrit-api <path>                                       # GET
gerrit-api <path> -d '<json>'                           # POST（自动检测）
gerrit-api <path> -d @body.json                         # 从文件读 body
gerrit-api <path> -X PUT -d '<json>'                    # 显式 PUT
gerrit-api <path> -X DELETE                             # DELETE
gerrit-api --debug <path>                               # 打印请求详情
```

**示例**：

```bash
# 查我打开的 change
gerrit-api "/changes/?q=owner:self+status:open&n=10"

# 查某个 change 详情
gerrit-api "/changes/12345/detail"

# 回复评论
gerrit-api "/changes/12345/revisions/current/review" -d '{"message":"LGTM"}'

# 添加 reviewer
gerrit-api "/changes/12345/reviewers" -d '{"reviewer":"alice@example.com"}'

# 移除 reviewer
gerrit-api "/changes/12345/reviewers/alice@example.com" -X DELETE
```

**特性**：
- 自动 XSSI 前缀 `)]}'` 剥离
- 按认证模式自动决定 /a/ 前缀（session 走 non-/a/、basic 走 /a/）
- 401 时给出针对性诊断（cookie 过期 → 建议跑 `refresh-auth`）
- 从 SoT 读凭据；无凭据时报错 + 提示怎么配

### gerrit-show — Gerrit change diff 快速查看

```bash
gerrit-show <change-id>                    # 完整 diff（commit message + unified diff）
gerrit-show <change-id> -s                 # 只文件列表（A/M/D 状态 + 行数）
gerrit-show <change-id> -m                 # JSON metadata（subject / owner / branch / status）
gerrit-show <change-id> --revision <n>     # 指定 revision（默认 current）
```

**示例**：

```bash
# 分页查看完整 diff
gerrit-show 12345 | less

# 快速看改了哪些文件
gerrit-show 12345 -s

# 拿 change 标题（配合 jq）
gerrit-show 12345 -m | jq -r .subject
```

**特性**：
- 无需本地 git clone（Gerrit REST 直接拿）
- 对任何 change 都能看（未合入 / abandoned / draft 均可）
- 输出可管道到 `less` / `patch` / `diff2html` 等工具
- 支持三种 change-id 格式：数字 ID / Change-Id 字符串 / `project~branch~Change-Id` 三元组

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
│  └── knowledge-mcp-server (v1.1.0, 14 tools) ★ v3 治理新增    │
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
| 第一层 | 规则约束（steering） | MP 分支禁止自动推送、`git add` 必须用 `-p`、target version 必须用户指定 |
| 第二层 | Hook 拦截（`hooks/*.json`） | 7 个符合 Kiro 官方 schema 的独立 hook JSON，触发时 AI 依据 prompt 拦截并给出替代方案 |
| 第三层 | 人工确认 | push 前展示 commit 信息等待确认、cherry_pick conflict 不盲目继续 |

**v3 起 hook 修复**：v2 使用的 `hooks/safety-hooks.json` 是自定义 schema，Kiro 不加载，实际第二层是空的。v3 修复后 7 个独立 hook 都会被 Kiro 自动加载并触发。详见 [`steering/safety-rules.md`](steering/safety-rules.md)。

## Troubleshooting（常见问题）

### 部署与环境

**`node scripts/deploy.mjs` 报 "Node.js xxx 太旧"**
- 检查 Node 版本：`node --version`，必须 ≥ 22.5.0
- 升级：Windows `winget upgrade OpenJS.NodeJS`、macOS `brew upgrade node`、Linux 从 [nodejs.org](https://nodejs.org/) 装最新

**`node scripts/deploy.mjs` 报 "检测到 Kiro IDE 正在运行"**
- deploy 前必须关闭 Kiro，否则配置文件被锁定写入失败
- 关掉 Kiro 后重跑（`--dry-run` 可以在 Kiro 运行时预览动作但不写入）

**`~/.ai/whaletv.yaml` 权限错误 / SoT 读不到**
- Linux/macOS 检查文件权限：`ls -la ~/.ai/whaletv.yaml`，应为 `-rw-------`（0600）
- 手工修：`chmod 0600 ~/.ai/whaletv.yaml`
- 如果误设了 root 拥有 → `sudo chown $USER ~/.ai/whaletv.yaml`

**PowerShell 报 "npm.ps1 无法加载因为执行策略"**
- 用 `npm.cmd` 直调而不是 `npm`（避开 ExecutionPolicy）
- 或临时开：`Set-ExecutionPolicy -Scope Process Bypass`

### MCP Server 启动

**MCP server 启动失败 / Kiro 显示红色感叹号**
1. 检查 Node 版本：`node --version` ≥ 22.5
2. 手动测启动：`npx -y @kk-irving/zmind-mcp-server@latest`（应停在 stdio 等待输入，Ctrl+C 退出）
3. `npm ping` 验证 npm registry 可达
4. 检查 `~/.kiro/settings/mcp.json` JSON 语法（用 `node -e "console.log(JSON.parse(require('fs').readFileSync('~/.kiro/settings/mcp.json')))"`）

**MCP server 起来但工具调用报 "credentials missing"**
- 跑 `whaletv-credentials check` 看哪些字段缺
- 缺 Zmind → `whaletv-credentials set zmind.api_key <40 位十六进制>`
- 缺 Gerrit cookie → 跑 `scripts/refresh-auth.{ps1,sh}`
- 缺 OpenGrok → `whaletv-credentials set opengrok.username <>` + `set opengrok.password <>`

**启动 banner 没有 `[sot-loader] 注入 X 个环境变量`**
- 说明 SoT 完全未加载（可能 SoT 文件不存在、YAML 语法错、或 sot-loader dist 未 rebuild）
- 手工验证：`node scripts/whaletv-credentials.mjs list`（应列出已配置键）
- 强制 rebuild 5 个 dist：`cd mcp-servers/<name> && npm.cmd run build`

### 认证

**Gerrit 报 `auth_failed (401, cookie 已过期)`**
- session 模式 cookie 通常 1-4 周过期
- 跑 `scripts/refresh-auth.{ps1,sh}` 重新抓 cookie（Playwright 自动登录）
- 首次跑会装 Playwright + Chromium（~150MB），后续几秒

**Confluence 报 `302 → /login.action` 或 `auth_failed`**
- Confluence cookie 也过期了（与 Gerrit 独立管理）
- 同上跑 `refresh-auth`（脚本会同时刷新 Gerrit + Confluence）
- ⚠️ Confluence 是**独立账号**（用户名首字母可能大写，密码不同于 Gerrit SSO）

**Confluence 报 `403 Not permitted to use confluence`**
- 账号缺 "Use Confluence" 全局权限（运维侧问题）
- v1.0.2 起 `sync_confluence` 自动降级到 `/rest/searchv3/1.0/cqlSearch`（权限门槛低于 REST batch）
- 若还是 403 → 找运维加权限

**Gerrit 启动 banner 显示 `auth_mode=missing`**
- 两组凭据都不全（`gerrit.auth_header + gerrit.cookie` 与 `gerrit.username + gerrit.http_password` 都缺）
- 跑 `whaletv-credentials check` 确认，用 `set` 补齐

### Kiro Power namespace

**MCP server 在 Kiro Power 模式安装后没生效**
- Kiro 会给 server key 加 `power-<powername>-` 前缀，v2 时代要靠 substring 匹配双写
- v3 起 sot-loader 直接从 SoT 读，与 mcp.json key 名**无关**，天然兼容任何 namespace
- 老 v2 的 `refresh-auth` / `setup-creds` 仍支持 substring 匹配 mcp.json，向后兼容

### Zmind 与附件

**Zmind WAF 限速 403/429**
- v2.1.1 自动重试 5 次（`Connection: close` + 退避）
- 若仍失败，等 5-10 分钟
- 可降低烈度：`whaletv-credentials set _meta.zmind_min_interval 200` 后重启 Kiro（或直接 mcp.json env 里加 `ZMIND_HTTP_MIN_INTERVAL=200` `ZMIND_FETCH_CONCURRENCY=1`）

**RAR 附件解压失败**
- v2.1.1 三档降级（unar → unrar → 7z），本机任一可用即成功
- 都没装 → 参见 Prerequisites "可选依赖" 章节安装

### Knowledge MCP

**knowledge-mcp 首次启动很慢**
- 会下 BGE-small-zh ONNX 模型（~80MB）到 `./data/models/`
- 中国大陆可设镜像：`whaletv-credentials set _meta.hf_endpoint https://hf-mirror.com`（或环境变量 `HF_ENDPOINT`）
- 后续启动秒级

**`node:sqlite` 模块找不到**
- Node < 22.5.0，升级 Node
- knowledge-mcp 严格要求 22.5+（用了 `node:sqlite` 内置模块，替代 native better-sqlite3）

**AOSP 索引占用磁盘太大**
- `clear_aosp_index({ platform, module })` 单独清理某个模块
- 或整个 SQLite 文件：`~/.kiro/knowledge/knowledge.db` 直接删（会重建）

### CLI 工具

**`whaletv-credentials` 命令找不到**
- 说明 PATH 里没 `<repo>/bin`
- 跑 `node scripts/deploy.mjs`（会自动加 PATH，marker block 幂等）
- 重启终端后 PATH 生效
- 手工测：`node <repo>/bin/whaletv-credentials --help`

**`gerrit-api` / `gerrit-show` 报 "缺 Gerrit 凭据"**
- SoT 里 Gerrit 段是空的
- 跑 `refresh-auth` 抓 session cookie，或 `whaletv-credentials set gerrit.username <> && set gerrit.http_password <>` 走 basic mode

**`gerrit-show 12345` 卡住 / 超时**
- 检查网络：`curl -o /dev/null -w "%{http_code}\n" https://whale-gerrit.zeasn.com`
- 检查 SoT `gerrit.url` 是否正确：`whaletv-credentials get gerrit.url`
- 用 `--debug` 看实际请求：`gerrit-show 12345 --debug 2>&1 | head -20`（等等，这个应该在 gerrit-api，gerrit-show 也可以）

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
- **Knowledge MCP**（v1.0.2 — 三源同步 + 向量+FTS5 hybrid 跨源检索 + analyze_issue 端到端工作流 + AOSP 模块级精搜；v1.0.1 修复 sync 3 bug；v1.0.2 加 Confluence searchv3 fallback 应对 REST batch 403）
- **凭据自动刷新**（refresh-auth — Playwright 一键搞定 Gerrit + Confluence cookie）
- **一键部署**（setup-v2.{ps1,sh}）
- 5 档代码搜索策略升级

### ✅ Phase 3 (v3.0.0 — 架构级治理升级)
- **Kiro 官方 hook 格式修复**（P0）—— 7 个独立 hook JSON 替代自定义 `safety-hooks.json`，三层防护第二层真正生效
- **单一凭据源 SoT**（`~/.ai/whaletv.yaml`）—— `whaletv-credentials` CLI + 5 个 MCP server 内嵌 sot-loader；env 优先兼容
- **一键部署脚本 `deploy.mjs`** —— 幂等 + 备份 + Kiro 运行检测 + hook schema 校验
- **description-driven skills** —— 12 份 workflow steering 迁移到 `.kiro/skills/whaletv-*/SKILL.md`（10 个）+ 6 个通用 skill
- **精简 steering**（5 份 `always inclusion` rules + module-path-map + codebase-taxonomy + safety-rules + MIGRATED 索引 = 7 份）
- **跨终端 CLI**：`whaletv-credentials` / `gerrit-api` / `gerrit-show`
- **治理层**：knowledge-mcp v1.1.0 新增 `generate_report`（JSON + 自包含 HTML）+ `upload_report`（S3 SigV4 零依赖）
- **Codebase 分类速查表**（D4/X5/STB 三平台差异 + 搜索策略决策树）

### 🔜 Phase 4（计划中）
- [ ] Kiro CLI Agent 完整支持（`kiro-cli chat --agent whaletv-dev`，CLI 端 steering/skills 加载）
- [ ] 知识库定时同步（cron / 后台任务）
- [ ] AOSP 全平台预编译索引（D4/X5/STB 完整模块覆盖）
- [ ] 多代码库批量操作支持

### 🔮 Phase 5（远期）
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

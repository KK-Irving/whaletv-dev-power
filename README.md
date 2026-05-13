# WhaleTV Developer Power — 开发者 AI 工作流助手

> 让每一个 WhaleTV 开发者在处理 PR/CR、Bug 分析、Cherry-Pick 时，都能像资深工程师一样高效闭环。

[![Kiro Power](https://img.shields.io/badge/Kiro-Power-purple)](https://kiro.dev)
[![Type](https://img.shields.io/badge/Type-MCP%20%2B%20Steering-blue)]()
[![License](https://img.shields.io/badge/License-UNLICENSED-red)]()

## 简介

WhaleTV Developer Power 是一个面向 WhaleTV 全体开发者的 [Kiro Power](https://kiro.dev)。它将团队已验证的 MCP 服务器、工作流指南和安全防护机制打包为一个可直接导入使用的 Power：

- 🔧 把 Zmind Issue 变成**可执行的代码修改**
- 🔄 把 Cherry-Pick 变成**一键批量同步**
- 🐛 把 Bug 日志变成**结构化分析报告**
- 🛡️ 把危险操作变成**三层防护拦截**

## 项目结构

```
whaletv-dev-power/
├── POWER.md                              # Kiro Power 元数据 + 概览文档
├── README.md                             # 本文件
├── mcp-servers/
│   ├── zmind-mcp-server/                 # Zmind (Redmine) MCP 服务器
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/index.ts                  # 14 个工具实现
│   └── opengrok-mcp-server/              # OpenGrok 代码搜索（暂停）
│       ├── package.json
│       ├── tsconfig.json
│       └── src/index.ts                  # 2 个工具实现
├── steering/
│   ├── onboarding.md                     # 首次配置引导流程
│   ├── pr-cr-workflow.md                 # PR/CR 处理工作流（9 步）
│   ├── cherry-pick-workflow.md           # Cherry-Pick 同步工作流
│   ├── bug-analysis-workflow.md          # Bug 分析工作流
│   ├── gerrit-workflow.md                # Gerrit 推送与评论处理
│   ├── local-code-guide.md              # 本地源码操作指南
│   └── safety-rules.md                  # 安全规则（三层防护）
├── hooks/
│   └── safety-hooks.json                 # 命令拦截规则（4 条）
└── .kiro/
    ├── skills/                           # AI 行为指导
    │   ├── project-code-mapping.md       # 项目-代码路径匹配
    │   ├── gerrit-integration.md         # Gerrit SSH 集成
    │   └── internal-docs.md              # Confluence 文档查询
    └── specs/                            # Spec 文档（需求/设计/任务）
```

## 核心能力

| # | 能力模块 | 说明 |
|---|---------|------|
| 1 | **Zmind 项目管理** | 14 个 MCP 工具，覆盖 Issue 全生命周期管理 |
| 2 | **PR/CR 全链路处理** | 9 步标准流程：获取 Issue → 修改代码 → 推送 Gerrit → 更新状态 |
| 3 | **Cherry-Pick 同步** | 批量 CP 到 MP 分支，自动发现目标分支，分类汇报结果 |
| 4 | **Bug 自动分析** | 日志解析 + 异常提取 + 代码定位 + 结构化报告 |
| 5 | **Gerrit 集成** | SSH 查询提交记录、处理 Gerrit-AI 评论、gerritpush 推送 |
| 6 | **内部文档查询** | Confluence CQL 搜索，自动关联已知问题和设计文档 |
| 7 | **安全防护** | 三层体系：规则约束 + Hook 拦截 + 人工确认 |
| 8 | **项目-代码匹配** | Zmind 项目自动映射到本地代码路径 |

### Zmind MCP Server 工具列表（14 个）

| 工具 | 功能 |
|------|------|
| `get_issue` | 获取 Issue 完整详情（含评论、附件、关联、子任务） |
| `my_issues` | 获取我的 Issue 列表（按更新时间排序） |
| `search_issues` | 按关键词搜索 Issue |
| `update_issue` | 更新 Issue 状态/指派/优先级/完成度 |
| `create_issue` | 创建新 Issue |
| `add_comment` | 添加评论（支持私密评论） |
| `create_time_entry` | 记录工时 |
| `list_projects` | 获取项目列表 |
| `get_versions` | 获取项目版本列表 |
| `get_project_members` | 获取项目成员及角色 |
| `get_issue_statuses` | 获取所有状态 |
| `get_trackers` | 获取所有 Tracker 类型 |
| `get_priorities` | 获取所有优先级 |
| `get_time_activities` | 获取工时活动类型 |

### 安全机制

| 层级 | 机制 | 示例 |
|------|------|------|
| 第一层 | 规则约束 | MP 分支禁止自动推送、git add 必须用 -p |
| 第二层 | Hook 拦截 | 禁止 sudo、禁止搜索 out/prebuilts 目录 |
| 第三层 | 人工确认 | push 前展示 commit 信息等待确认 |

## 安装

### 前置条件

| 依赖 | 说明 |
|------|------|
| [Kiro IDE](https://kiro.dev) | AI 开发环境 |
| Node.js 18+ | MCP Server 运行时 |
| SSH 密钥 | 已上传到 Gerrit（用于代码查询） |

### 安装步骤

#### Step 1：安装 Power

1. 打开 Kiro IDE
2. 点击左侧边栏的 **Powers** 图标（或通过命令面板搜索 "Powers"）
3. 在 Powers 面板中点击 **"Add Power"** 按钮
4. 选择 **"From GitHub URL"**
5. 输入仓库地址：
   ```
   https://github.com/KK-Irving/whaletv-dev-power
   ```
6. 点击确认，等待安装完成

安装成功后，Powers 面板中会出现 **whaletv-dev-power**。

#### Step 2：激活 Power

1. 在 Powers 面板中找到 **whaletv-dev-power**
2. 点击展开查看详情
3. 点击 **"Try Power"** 按钮开始使用

此时 AI 会自动进入首次配置引导流程。

#### Step 3：跟随引导完成配置

Power 激活后会依次引导你完成以下配置（全程与 AI 对话交互）：

**3.1 Zmind 连接配置**

AI 会检测 Zmind 连接状态。如果未配置，会引导你获取 API 密钥并配置到 mcp.json。

你可以直接告诉 AI：
> "我的 ZMIND_API_KEY 是 a1b2c3d4e5f6...，请帮我配置"

**3.2 项目-代码路径匹配**

AI 会自动获取你在 Zmind 上的项目列表，然后请你提供项目与本地代码路径的对应关系。

你可以这样告诉 AI：
> "cultraview-dvb-amlogic-t950d4-2k-1g 对应 ~/cvte_code/amlogic/"

**3.3 Gerrit 连接配置**

AI 会请你提供 Gerrit 的用户名和密码，然后通过 SSH 实际验证连通性。

你可以这样告诉 AI：
> "我的 Gerrit 用户名是 xxx，密码是 xxx"

验证通过后会显示 Gerrit 版本信息（如 `gerrit version 3.6.0`）。

> 前提：你的 SSH 公钥需要已上传到 Gerrit（Settings → SSH Keys）

**3.4 内部文档系统配置**

AI 会请你提供文档系统（docs.whaletv.com）的用户名和密码，然后通过 API 实际验证连通性。

你可以这样告诉 AI：
> "文档系统的用户名是 xxx，密码是 xxx"

> 注意：用户名区分大小写

**3.5 配置完成**

所有系统验证通过后，AI 会展示配置总结，你就可以开始正式使用了。

#### Step 4：开始正式使用

配置完成后，直接用自然语言触发各种功能。

## 使用方式

安装配置完成后，在 Kiro 对话中直接使用自然语言触发：

```
# 查看待办
"查看我的待办"
"我有哪些未完成的 Issue？"

# PR/CR 处理
"帮我处理 PR #12345"
"处理下这个 CR"

# Bug 分析
"分析下 #334001"
"帮我看看这个 Bug"

# Cherry-Pick
"把 #332669 cp 到 mp"
"cherry-pick I1234567 到 mp 分支"

# Gerrit 操作
"推送代码到 Gerrit"
"查询 #332669 的 Gerrit 提交记录"

# 文档查询
"查一下文档里有没有关于 OTA 升级的说明"

# 工时记录
"记录 2 小时工时到 #12345"

# 创建 Issue
"创建一个 Issue，项目是 xxx，标题是 xxx"
```

## 外部系统集成

```
┌─────────────────────────────────────────────────────────┐
│  whaletv-dev-power (本项目)                               │
│                                                          │
│  MCP Server 层:                                          │
│  ├── zmind-mcp-server (14 tools) ──→ Zmind (Redmine)    │
│  └── opengrok-mcp-server (暂停) ──→ OpenGrok            │
│                                                          │
│  Skill 层（SSH/HTTP 直接调用）:                            │
│  ├── gerrit-integration ──→ Gerrit (SSH:29418)          │
│  └── internal-docs ──→ Confluence (REST API)            │
│                                                          │
│  Steering 层（工作流指导）:                                │
│  ├── pr-cr-workflow (9 步)                               │
│  ├── cherry-pick-workflow                                │
│  ├── bug-analysis-workflow                               │
│  ├── gerrit-workflow                                     │
│  └── safety-rules (三层防护)                              │
└─────────────────────────────────────────────────────────┘
         │              │              │            │
         ▼              ▼              ▼            ▼
┌──────────┐  ┌──────────────┐  ┌─────────┐  ┌──────────┐
│  Zmind   │  │   Gerrit     │  │  Docs   │  │ OpenGrok │
│ (Redmine)│  │ (SSH:29418)  │  │(Confl.) │  │ (暂停)   │
└──────────┘  └──────────────┘  └─────────┘  └──────────┘
```

| 系统 | 地址 | 认证方式 | 配置需提供 |
|------|------|---------|-----------|
| Zmind | https://zmind.whaletv.com | API Key | API 密钥 |
| Gerrit | https://whale-gerrit.zeasn.com | SSH 密钥 + HTTP 密码 | 用户名、密码 |
| Confluence | https://docs.whaletv.com | HTTP Basic Auth | 用户名、密码 |
| OpenGrok | http://opengrok.zeasn.com:8080 | 无 | ⏸️ 暂停 |

## mcp.json 配置参考

> ⚠️ **环境变量必须配置在 mcp.json 的 `env` 字段中**，仅设置系统环境变量不会生效。

配置文件位置：`~/.kiro/settings/mcp.json`

```json
{
  "mcpServers": {
    "zmind-mcp-server": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "<power安装路径>/mcp-servers/zmind-mcp-server",
      "env": {
        "ZMIND_API_KEY": "你的40位API密钥",
        "ZMIND_URL": "https://zmind.whaletv.com"
      },
      "disabled": false
    },
    "opengrok-mcp-server": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "<power安装路径>/mcp-servers/opengrok-mcp-server",
      "env": {
        "OPENGROK_URL": "http://opengrok.zeasn.com:8080"
      },
      "disabled": true
    }
  }
}
```

> 💡 通常 Power 安装后 mcp.json 会自动生成基础配置，你只需要填入 `ZMIND_API_KEY` 即可。也可以在引导流程中直接告诉 AI 你的密钥。

## 开发

### 编译检查

```bash
cd mcp-servers/zmind-mcp-server && npx tsc --noEmit
cd ../opengrok-mcp-server && npx tsc --noEmit
```

### 使用 MCP Inspector 调试

```bash
cd mcp-servers/zmind-mcp-server
ZMIND_API_KEY=your_key npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

### 本地运行

```bash
cd mcp-servers/zmind-mcp-server
ZMIND_API_KEY=your_key npx tsx src/index.ts
# Server 启动后等待 stdio 输入（正常行为）
```

## 技术栈

| 技术 | 用途 |
|------|------|
| TypeScript (ES2022) | MCP Server 实现 |
| @modelcontextprotocol/sdk 1.12.1 | MCP 协议框架 |
| zod 3.24.4 | 运行时参数校验 |
| stdio | MCP 传输协议 |
| SSH (端口 29418) | Gerrit 查询 |
| HTTP Basic Auth | Confluence API |
| Kiro Steering | AI 工作流定义 |
| Kiro Skills | AI 行为指导 |

## 与 FAE Power 的关系

```
┌─────────────────────────────────────────────────────┐
│  whaletv-dev-power (本项目)                           │
│  ├── zmind-mcp-server (14 tools) ← FAE Power 调用   │
│  ├── opengrok-mcp-server (暂停) ← FAE Power 调用    │
│  └── steering/ (PR/CR/Cherry-Pick — 开发者用)        │
└─────────────────────────────────────────────────────┘
         ↑ 提供 MCP 工具能力
         │
┌─────────────────────────────────────────────────────┐
│  fae-power                                           │
│  └── steering/fae-skill.md (FAE 行为指导)            │
│      - 技术问答、完整性检查、日志指导                   │
│      - 工单管理、客户沟通、风险评估                     │
└─────────────────────────────────────────────────────┘
```

**分工：**
- `whaletv-dev-power` = 工具层 + 开发者工作流（提供 Zmind/Gerrit/Docs 能力）
- `fae-power` = FAE 行为层（指导 AI 如何为 FAE 工程师服务）

两者同时安装时，AI 自动组合能力。

## Roadmap

### ✅ Phase 1（已完成）
- [x] Zmind MCP Server（14 个工具）
- [x] PR/CR 全链路工作流（9 步）
- [x] Cherry-Pick 同步工作流
- [x] Bug 分析工作流
- [x] Gerrit SSH 集成（查询提交记录）
- [x] Confluence 文档搜索集成
- [x] 安全防护三层体系
- [x] 首次配置引导流程（onboarding）
- [x] 项目-代码路径匹配

### 🔜 Phase 2（计划中）
- [ ] Gerrit MCP Server（独立 MCP 服务器，支持 Cherry-Pick/评论等写操作）
- [ ] OpenGrok 全面启用
- [ ] 知识库集成（问题沉淀和检索）
- [ ] 多代码库批量操作支持
- [ ] Commit Message 智能生成（基于 diff 自动填充 what/why/how）

### 🔮 Phase 3（远期）
- [ ] 自动识别 Issue 类型并推荐工作流
- [ ] 跨项目 Issue 关联分析
- [ ] 团队代码提交统计和趋势分析
- [ ] 与钉钉/企业微信集成

## 贡献

欢迎开发团队成员贡献：
- 补充 Steering 文件中的工作流步骤
- 添加新的 Zmind MCP 工具
- 完善安全规则和 Hook 拦截模式
- 提交新的 Skill 文件

## License

⚠️ **UNLICENSED** — 本项目为 WhaleTV / Zeasn 内部专有软件，仅限内部使用。

未经授权，禁止复制、分发、修改或以任何形式对外使用本软件。详见 [LICENSE](./LICENSE) 文件。

# WhaleTV Developer Power

面向 WhaleTV 全体 AOSP 开发者的 Kiro Power 工具包。集成 Zmind 项目管理、OpenGrok 代码搜索和团队标准工作流，使开发者在远程 Linux 服务器上通过 Kiro CLI 即可获得完整的 AI 辅助开发能力。

## 项目结构

```
whaletv-dev-power/
├── POWER.md                              # Power 元数据与使用文档（Kiro 标准格式）
├── mcp.json                              # MCP 服务器配置（Kiro 标准格式）
├── README.md                             # 本文件
├── mcp-servers/
│   ├── zmind-mcp-server/                 # Zmind (Redmine) MCP 服务器
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts                  # 14 个工具实现
│   └── opengrok-mcp-server/              # OpenGrok 代码搜索 MCP 服务器
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts                  # 2 个工具实现
├── steering/
│   ├── pr-cr-workflow.md                 # PR/CR 处理工作流（9 步）
│   ├── cherry-pick-workflow.md           # Cherry-Pick 同步工作流
│   ├── bug-analysis-workflow.md          # Bug 分析工作流
│   ├── gerrit-workflow.md                # Gerrit 推送与评论处理
│   ├── local-code-guide.md              # 本地源码操作指南
│   └── safety-rules.md                  # 安全规则（三层防护）
└── hooks/
    └── safety-hooks.json                 # 命令拦截规则参考（4 条）
```

## 功能概览

### MCP 服务器

| 服务器 | 工具数 | 功能 |
|--------|--------|------|
| zmind-mcp-server | 14 | Issue 查询/创建/更新、工时记录、项目管理 |
| opengrok-mcp-server | 2 | AOSP 源码全文搜索、符号定义查找 |

**Zmind MCP Server 工具列表：**
- `get_issue` — 获取 Issue 完整详情
- `my_issues` — 获取我的 Issue 列表
- `search_issues` — 按关键词搜索 Issue
- `update_issue` — 更新 Issue 状态/指派/优先级
- `create_issue` — 创建新 Issue
- `add_comment` — 添加评论
- `create_time_entry` — 记录工时
- `list_projects` — 获取项目列表
- `get_versions` — 获取项目版本列表
- `get_project_members` — 获取项目成员
- `get_issue_statuses` — 获取所有状态
- `get_trackers` — 获取所有 Tracker 类型
- `get_priorities` — 获取所有优先级
- `get_time_activities` — 获取工时活动类型
- `delete_issue` — 删除 Issue

**OpenGrok MCP Server 工具列表：**
- `search_code` — 全文关键词搜索
- `search_symbol` — 符号定义位置搜索

### Steering 工作流

| 文件 | 用途 | 触发示例 |
|------|------|---------|
| pr-cr-workflow.md | PR/CR 全链路处理 | "帮我处理 PR #12345" |
| cherry-pick-workflow.md | 跨分支 CP 同步 | "把 #332669 cp 到 mp" |
| bug-analysis-workflow.md | Bug 自动分析 | "分析下 #334001" |
| gerrit-workflow.md | Gerrit 推送与评论 | "推送代码到 Gerrit" |
| local-code-guide.md | 本地源码操作规范 | 自动生效 |
| safety-rules.md | 安全防护规则 | 自动生效 |

### 安全机制

三层防护体系：

1. **规则约束** — AI 自律（MP 分支禁止自动推送、git add 必须用 -p、target version 必须用户指定）
2. **Hook 拦截** — 自动阻断危险命令（sudo、根目录搜索、/tmp 写入、out/prebuilts 搜索）
3. **人工确认** — 高风险操作等待用户授权（push 前、跨代码库操作前）

## 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Ubuntu 20.04+（远程 Linux 服务器） |
| Node.js | 18+ |
| 运行环境 | CLI，无需 GUI |

## 快速开始

### 1. 配置环境变量

```bash
# 必需
export ZMIND_API_KEY="你的40位API密钥"
export OPENGROK_URL="http://opengrok.zeasn.com:8080"

# 可选
export ZMIND_URL="https://zmind.whaletv.com"       # 默认值
export OPENGROK_PROJECT="d4_code"
```

### 2. 安装依赖

```bash
cd mcp-servers/zmind-mcp-server && npm install
cd ../opengrok-mcp-server && npm install
```

### 3. 验证配置

```bash
# 检查环境变量
echo "ZMIND_API_KEY: ${ZMIND_API_KEY:+已设置}"
echo "OPENGROK_URL: ${OPENGROK_URL:+已设置}"

# 验证 Zmind 连接（应返回 200）
curl -s -o /dev/null -w "%{http_code}" \
  "${ZMIND_URL:-https://zmind.whaletv.com}/users/current.json?key=$ZMIND_API_KEY"

# 验证 OpenGrok 连接（应返回 200）
curl -s -o /dev/null -w "%{http_code}" \
  "$OPENGROK_URL/api/v1/configuration"
```

### 4. 安装 Power

**方式一：本地目录安装（开发测试）**

1. 在 Kiro 中打开 Powers 面板
2. 点击 "Add Custom Power"
3. 选择 "Local Directory"
4. 输入本项目的完整路径

**方式二：Git 仓库安装（团队共享）**

将本项目推送到 GitHub 公开仓库后，团队成员可通过仓库 URL 安装。

### 5. 使用

在 AOSP 源码目录下启动 Kiro CLI：

```bash
cd ~/cvte_code/amlogic && kiro
```

激活 Power 后即可使用所有工作流。

## 开发

### 编译检查

```bash
cd mcp-servers/zmind-mcp-server && npx tsc --noEmit
cd ../opengrok-mcp-server && npx tsc --noEmit
```

### 本地运行 MCP Server

```bash
# Zmind
cd mcp-servers/zmind-mcp-server
ZMIND_API_KEY=your_key npx tsx src/index.ts

# OpenGrok
cd mcp-servers/opengrok-mcp-server
OPENGROK_URL=http://your-server:8080 npx tsx src/index.ts
```

### 使用 MCP Inspector 调试

```bash
cd mcp-servers/zmind-mcp-server
ZMIND_API_KEY=your_key npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

## 技术栈

- **语言**: TypeScript (ES2022, ESM)
- **MCP 框架**: @modelcontextprotocol/sdk 1.12.1
- **传输协议**: stdio
- **参数校验**: zod 3.24.4
- **HTTP 客户端**: Node.js 内置 fetch

## Kiro Power 标准

本项目遵循 Kiro Power 标准结构：

- `POWER.md` — 使用标准 frontmatter（name, displayName, description, keywords, author）
- `mcp.json` — 标准 MCP 服务器配置格式
- `steering/` — 按需加载的工作流指南

## 已知问题

- `@modelcontextprotocol/sdk` 1.12.1 在 TypeScript strict 模式下存在泛型递归过深问题（TS2589），已通过 `(server.tool as any)()` 绕过，不影响运行时行为
- MCP Server 设计为在 Linux 服务器上运行，Windows 环境仅用于开发和编译验证

## 许可证

内部项目，仅限 WhaleTV 团队使用。

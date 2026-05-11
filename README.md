# WhaleTV Developer Power

面向 WhaleTV 全体开发者的 Kiro Power 工具包。集成 Zmind 项目管理、Gerrit 代码评审、内部文档查询和团队标准工作流，使开发者通过 Kiro CLI 即可获得完整的 AI 辅助开发能力。

## 项目结构

```
whaletv-dev-power/
├── POWER.md                              # Power 元数据与使用文档
├── README.md                             # 本文件
├── mcp-servers/
│   ├── zmind-mcp-server/                 # Zmind (Redmine) MCP 服务器（14 个工具）
│   └── opengrok-mcp-server/              # OpenGrok 代码搜索（暂停，disabled）
├── steering/
│   ├── pr-cr-workflow.md                 # PR/CR 处理工作流（9 步）
│   ├── cherry-pick-workflow.md           # Cherry-Pick 同步工作流
│   ├── bug-analysis-workflow.md          # Bug 分析工作流
│   ├── gerrit-workflow.md                # Gerrit 推送与评论处理
│   ├── local-code-guide.md              # 本地源码操作指南
│   └── safety-rules.md                  # 安全规则（三层防护）
└── hooks/
    └── safety-hooks.json                 # 命令拦截规则（4 条）
```

## 功能概览

### MCP 服务器

| 服务器 | 状态 | 工具数 | 功能 |
|--------|------|--------|------|
| zmind-mcp-server | ✅ 启用 | 14 | Issue 查询/创建/更新、工时记录、项目管理 |
| opengrok-mcp-server | ⏸️ 暂停 | 2 | 源码全文搜索（待开放后启用） |

### Skills（自动生效）

| Skill | 用途 |
|-------|------|
| project-code-mapping | 将 Zmind 项目与本地代码库路径匹配 |
| gerrit-integration | Gerrit (whale-gerrit.zeasn.com) 交互规范 |
| internal-docs | 内部文档 (docs.whaletv.com) 查询辅助 |

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

## 快速开始

### 1. 配置 mcp.json（关键步骤）

> ⚠️ **环境变量必须配置在 mcp.json 的 `env` 字段中**，仅设置系统环境变量不会生效。

在 `~/.kiro/settings/mcp.json`（用户级）中添加：

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

### 2. 获取 Zmind API 密钥

登录 https://zmind.whaletv.com → 右上角"我的账户" → 左侧"API 访问密钥" → 显示/重置密钥

### 3. 安装依赖

```bash
cd mcp-servers/zmind-mcp-server && npm install
```

### 4. 使用

在源码目录下启动 Kiro CLI，激活 Power 后即可使用。

## 外部系统集成

### Zmind 项目管理

- **地址**: https://zmind.whaletv.com/
- **功能**: Issue 查询/创建/更新、工时记录、项目成员查询
- **项目链接格式**: `https://zmind.whaletv.com/projects/<identifier>`

### Gerrit 代码评审

- **地址**: https://whale-gerrit.zeasn.com/
- **功能**: 代码推送、Change 查询、Cherry-Pick、评论处理
- **推送命令**: `gerritpush`
- **Change 链接格式**: `https://whale-gerrit.zeasn.com/c/<project>/+/<number>`

### 内部文档

- **地址**: https://docs.whaletv.com/
- **功能**: 技术文档查询、已知问题检索、设计规范参考
- **使用方式**: AI 在分析问题时会建议查阅相关文档

### OpenGrok 代码搜索（暂停）

- **地址**: http://opengrok.zeasn.com:8080
- **状态**: 未全面开放，当前 disabled
- **启用方式**: 在 mcp.json 中将 `disabled` 改为 `false`

## 项目-代码匹配

首次使用时，AI 会调用 `list_projects` 获取你的 Zmind 项目列表，然后请你提供项目与本地代码路径的映射关系：

```
Zmind 项目                                    → 本地代码路径
cultraview-dvb-amlogic-t950d4-2k-1g          → ~/cvte_code/amlogic/
stm-amlogic-t962d4-4k-1-5gb                  → ~/cvte_code/stm/
...
```

映射建立后，处理 Issue 时 AI 会自动定位到正确的代码目录。

## Zmind MCP Server 工具列表

- `get_issue` — 获取 Issue 完整详情（含评论、附件、关联、子任务）
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

## 技术栈

- **语言**: TypeScript (ES2022, ESM)
- **MCP 框架**: @modelcontextprotocol/sdk 1.12.1
- **传输协议**: stdio
- **参数校验**: zod 3.24.4
- **HTTP 客户端**: Node.js 内置 fetch

## 许可证

内部项目，仅限 WhaleTV 团队使用。

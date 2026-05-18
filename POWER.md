---
name: "whaletv-dev-power"
displayName: "WhaleTV Developer Power"
description: "面向 WhaleTV 开发者的 AI 辅助工具包，集成 Zmind 项目管理、OpenGrok 代码搜索和团队标准工作流"
keywords: ["whaletv", "zmind", "gerrit", "opengrok", "cherry-pick", "pr", "cr", "android", "项目管理", "代码搜索"]
author: "WhaleTV Team"
---

# WhaleTV Developer Power

面向 WhaleTV 全体开发者的 Kiro Power 工具包。集成 Zmind 项目管理、OpenGrok 代码搜索和团队标准工作流，使开发者在远程 Linux 服务器上通过 Kiro CLI 即可获得完整的 AI 辅助开发能力。

## Overview

### 首次使用

激活 Power 后会自动进入配置引导流程，依次验证：
1. Zmind 连接 → 获取项目列表 → 匹配代码路径
2. Gerrit 连接验证
3. 内部文档系统验证
4. 配置总结

所有系统一次性配好后即可开始使用，无需后续再逐个配置。

### 功能概览

- **Zmind 项目管理**：查询/创建/更新 Issue、工时记录、项目成员查询等工具
- **OpenGrok 代码搜索**：全文搜索和符号定义查找，快速定位源码
- **PR/CR 工作流**：从获取 Issue 到推送 Gerrit 的全链路自动化
- **Cherry-Pick 工作流**：跨代码库批量 CP 同步到 MP 分支
- **Bug 分析工作流**：自动下载日志、解析异常、定位代码、生成报告
- **安全防护**：三层安全机制（规则约束 + Hook 拦截 + 人工确认）

### MCP 服务器

| 服务器 | 工具数 | 功能 |
|--------|--------|------|
| zmind-mcp-server | 15 | Issue 查询/创建/更新、附件下载、工时记录、项目管理 |
| opengrok-mcp-server | 4 | 全文搜索、符号定义搜索、路径搜索、文件内容获取 |

## Available Steering Files

本 Power 包含以下工作流指南，按需加载：

- **pr-cr-workflow** — PR/CR 全链路处理工作流（9 步），触发示例："帮我处理 PR #12345"
- **cherry-pick-workflow** — 跨分支 Cherry-Pick 同步工作流，触发示例："把 #332669 cp 到 mp"
- **bug-analysis-workflow** — Bug 自动分析工作流，触发示例："分析下 #334001"
- **gerrit-workflow** — Gerrit 推送与评论处理，触发示例："推送代码到 Gerrit"
- **local-code-guide** — 本地源码操作规范（搜索策略、目录结构），自动生效
- **safety-rules** — 安全规则与三层防护体系，自动生效
- **onboarding** — 首次配置引导流程（Zmind → 项目映射 → Gerrit → 文档系统），触发示例："配置" / "setup"

## Onboarding

### 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Ubuntu 20.04+（远程 Linux 服务器） |
| Node.js | 18+ |
| 运行环境 | CLI，无需 GUI |

### mcp.json 配置（关键步骤）

Power 的 MCP 服务器需要通过 Kiro 的 `mcp.json` 配置环境变量。请在用户级配置文件 `~/.kiro/settings/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "zmind-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/zmind-mcp-server@latest"],
      "env": {
        "ZMIND_API_KEY": "你的40位API密钥",
        "ZMIND_URL": "https://zmind.whaletv.com"
      },
      "disabled": false
    },
    "opengrok-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/opengrok-mcp-server@latest"],
      "env": {
        "OPENGROK_URL": "https://opengrok.zeasn.com",
        "OPENGROK_USERNAME": "你的OpenGrok用户名",
        "OPENGROK_PASSWORD": "你的OpenGrok密码",
        "OPENGROK_PROJECT": ""
      },
      "disabled": false
    }
  }
}
```

> ⚠️ **注意**：
> - 使用 `@latest` 标签确保每次启动时自动获取最新版本
> - `ZMIND_API_KEY` 必须配置在 mcp.json 的 `env` 字段中，仅设置系统环境变量不会生效
> - `OPENGROK_USERNAME` 和 `OPENGROK_PASSWORD` 同样需要配置在 mcp.json 的 `env` 字段中
> - 获取 Zmind API 密钥：登录 https://zmind.whaletv.com → 右上角"我的账户" → 左侧"API 访问密钥"

### 环境变量说明

| 变量名 | 用途 | 必需 | 默认值 |
|--------|------|------|--------|
| ZMIND_API_KEY | Zmind 用户 API 密钥 | ✅ 是 | 无 |
| ZMIND_URL | Zmind 服务地址 | ❌ 否 | https://zmind.whaletv.com |
| OPENGROK_URL | OpenGrok 服务地址 | ✅ 是 | 无 |
| OPENGROK_USERNAME | OpenGrok 用户名 | ✅ 是 | 无 |
| OPENGROK_PASSWORD | OpenGrok 密码 | ✅ 是 | 无 |
| OPENGROK_PROJECT | 默认搜索项目名 | ❌ 否 | 无（搜索所有项目） |

### 配置验证

```bash
# 检查环境变量
echo "ZMIND_API_KEY: ${ZMIND_API_KEY:+已设置}"
echo "OPENGROK_URL: ${OPENGROK_URL:+已设置}"

# 验证 Zmind 连接（应返回 200）
curl -s -o /dev/null -w "%{http_code}" "${ZMIND_URL:-https://zmind.whaletv.com}/users/current.json?key=$ZMIND_API_KEY"

# 验证 OpenGrok 连接（应返回 200）
curl -s -o /dev/null -w "%{http_code}" "$OPENGROK_URL/api/v1/configuration"

# 检查 Node.js 版本（需要 18+）
node --version
```

### 推荐使用方式

> ⚠️ **Workspace 限制**：Kiro 只能操作当前 workspace 内的文件。源码目录必须作为 workspace 打开，否则本地代码搜索不可用（会降级到 OpenGrok）。

- **Windows（Samba 映射）**：在 Kiro 中 File → Open Folder → 选择源码映射路径（如 `W:\code\950_stm\amlogic`）
- **Linux（远程服务器）**：在源码根目录下启动 Kiro CLI：

```bash
cd ~/cvte_code/amlogic && kiro
```

## Common Workflows

### PR/CR 处理

触发："帮我处理 PR #12345" 或 "处理下这个 CR"

完整流程：获取 Issue → 分析问题 → 定位代码 → 修改代码 → 用户确认 diff → 精确暂存(git add -p) → 生成 Commit Message → 用户确认推送 → 推送 Gerrit → 处理 Gerrit-AI 评论 → 更新 Zmind

详细步骤请加载 steering: `pr-cr-workflow`

### Cherry-Pick 同步

触发："把 #332669 cp 到 mp" 或 "cherry-pick I1234567 到 mp 分支"

完整流程：获取 Change 信息 → 搜索已合入 master 的 Changes → 发现目标 MP 分支 → 展示 CP 计划 → 用户确认 → 批量执行 → 分类汇报 → 更新 Zmind

详细步骤请加载 steering: `cherry-pick-workflow`

### Bug 分析

触发："分析下 #334001" 或 "帮我看看这个 Bug"

完整流程：获取 Issue → 识别日志附件 → 下载解析日志 → 提取异常信息 → 本地代码定位 → 输出结构化分析报告

详细步骤请加载 steering: `bug-analysis-workflow`

### Gerrit 推送

触发："推送代码到 Gerrit" 或 "处理 Gerrit 评论"

完整流程：推送代码(gerritpush) → 轮询等待 Gerrit-AI 评论 → 逐条处理评论（采纳/不采纳）

详细步骤请加载 steering: `gerrit-workflow`

## Zmind MCP Server 工具列表

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
- `download_attachment` — 下载 Issue 附件内容（日志/文本直接读取，二进制返回元信息）

## OpenGrok MCP Server 工具列表

- `search_code` — 全文关键词搜索（支持按项目过滤）
- `search_symbol` — 符号定义位置搜索（类/方法/变量）
- `search_path` — 按文件路径/文件名搜索
- `get_file_content` — 获取文件完整源码内容（只读）

## 安全机制

三层防护体系：

1. **规则约束** — AI 自律（MP 分支禁止自动推送、git add 必须用 -p、target version 必须用户指定）
2. **Hook 拦截** — 自动阻断危险命令（sudo、根目录搜索、/tmp 写入、out/prebuilts 搜索）
3. **人工确认** — 高风险操作等待用户授权（push 前、跨代码库操作前）

详细规则请加载 steering: `safety-rules`

## Best Practices

- 优先使用 `git grep` 搜索源码（~0.4s），仅在无结果时降级到 OpenGrok
- 在源码根目录启动 Kiro CLI，确保 AI 可直接访问项目文件
- 使用 `git add -p` 进行 hunk 级别精确暂存，避免提交无关改动
- Commit Message 严格遵循格式：`[版本号][类型][whaletv][Zmind#ID]简述`
- 跨代码库操作前明确告知用户当前操作范围

## Troubleshooting

### ZMIND_API_KEY 未设置

**现象**：调用 Zmind 相关工具时报错"环境变量 ZMIND_API_KEY 未配置"

**解决**：
1. 确认变量已设置：`echo $ZMIND_API_KEY`
2. 获取 API 密钥：登录 Zmind → 右上角"我的账户" → 左侧"API 访问密钥" → 显示/重置密钥
3. 设置变量：`export ZMIND_API_KEY="你的API密钥"`
4. 验证：`curl -s "${ZMIND_URL:-https://zmind.whaletv.com}/users/current.json?key=$ZMIND_API_KEY" | head -c 200`

### OPENGROK_URL 未设置

**现象**：调用 OpenGrok 搜索工具时报错"环境变量 OPENGROK_URL 未配置"

**解决**：
1. 确认变量已设置：`echo $OPENGROK_URL`
2. 设置变量：`export OPENGROK_URL="https://opengrok.zeasn.com"`
3. 验证服务可达：`curl -s -u "$OPENGROK_USERNAME:$OPENGROK_PASSWORD" "https://opengrok.zeasn.com/api/v1/search?full=test&maxresults=1"`

### MCP Server 连接失败

**现象**：Power 激活后工具不可用

**解决**：
1. 确认 Node.js 版本 >= 18：`node --version`
2. 手动测试 MCP Server 是否可运行：`npx -y @kk-irving/zmind-mcp-server@latest`
3. 如果报网络错误，确认 npm registry 可达：`npm ping`

## MCP Config Placeholders

使用此 Power 前，确保以下环境变量已在系统中设置：

- **`ZMIND_API_KEY`**：Zmind 用户 API 密钥（40 位十六进制字符串）
  - **获取方式**：登录 https://zmind.whaletv.com → 右上角"我的账户" → 左侧"API 访问密钥" → 显示/重置密钥

- **`OPENGROK_URL`**：OpenGrok 服务地址
  - **设置方式**：WhaleTV 内部 OpenGrok 地址为 `https://opengrok.zeasn.com`

- **`ZMIND_URL`**（可选）：Zmind 服务地址，默认为 `https://zmind.whaletv.com`

- **`OPENGROK_PROJECT`**（可选）：默认搜索项目名，如 `d4_code`

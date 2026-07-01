---
archived_at: 2026-07-01T08:26:30.636Z
archived_reason: v3 起统一用 opengrok-mcp-server（4 工具） + skill whaletv-local-code；服务信息属于 MCP server 内部
original_path: .kiro/skills/opengrok-integration.md
---

---
inclusion: auto
---

# Skill: OpenGrok 代码搜索集成

## 目的

通过 OpenGrok REST API 搜索公版代码，在本地代码库不包含目标项目时，作为远程代码查询的补充手段，辅助分析问题。

## 服务信息

- **地址**: https://opengrok.zeasn.com
- **版本**: OpenGrok 1.14.0
- **认证**: HTTP Basic Auth
- **用途**: 只读代码搜索（无法修改代码）
- **最后索引**: 定期更新

## 用户需提供的配置

| 配置项 | UI 显示 | 说明 |
|--------|---------|------|
| OpenGrok 用户名 | 用户名 | 访问 OpenGrok 的用户名 |
| OpenGrok 密码 | 密码 | 访问 OpenGrok 的密码 |

配置位置：mcp.json 的 `env` 字段中 `OPENGROK_USERNAME` 和 `OPENGROK_PASSWORD`

## 可用项目（Repository）

| 项目名 | 网址 | 说明 |
|--------|------|------|
| `d4_code` | https://opengrok.zeasn.com/xref/d4_code/ | D4 平台公版代码 |
| `stb16_code` | https://opengrok.zeasn.com/xref/stb16_code/ | STB16 平台公版代码 |
| `x5_code` | https://opengrok.zeasn.com/xref/x5_code/ | X5 平台公版代码 |

## 可用工具（4 个）

| 工具 | 功能 | 参数 |
|------|------|------|
| `search_code` | 全文关键词搜索 | query, project(可选), max_results |
| `search_symbol` | 符号定义搜索（类/方法/变量） | symbol, project(可选), max_results |
| `search_path` | 按文件路径/文件名搜索 | path, project(可选), max_results |
| `get_file_content` | 获取文件完整源码（只读） | file_path |

## 使用场景

> ⚠️ **重要约束**：OpenGrok 仅包含公版代码，不包含各 PCBA 定制代码。因此可能与实际项目代码存在差异。OpenGrok 的优先级**低于本地代码查询**，仅在以下条件**同时满足**时才使用：
> 1. 用户要解决的问题涉及的项目，本地没有对应代码（未配置项目-代码映射）
> 2. 已明确询问用户是否需要到 OpenGrok 查询公版代码，且用户确认同意

### 触发流程

```
需要查看代码
    │
    ├── 本地有代码映射 → 使用本地 git grep（不使用 OpenGrok）
    │
    └── 本地无代码映射
            │
            ├── 询问用户："本地没有该项目代码，是否需要到 OpenGrok 查询公版代码？"
            │
            ├── 用户同意 → 使用 OpenGrok 搜索（标注"公版代码，可能与实际项目有差异"）
            │
            └── 用户拒绝 → 不使用 OpenGrok，提示用户提供代码路径或其他方式
```

### 场景 1：本地代码库没有目标项目

当用户的本地代码库不包含需要查看的项目代码时：

```
AI: 当前本地代码库中未找到相关代码。是否需要到 OpenGrok 公版代码中搜索？
用户: 是
AI: [调用 search_code 或 search_symbol]
```

### 场景 2：Bug 分析需要查看公版实现

分析 Bug 时需要了解公版代码的实现逻辑：

```
1. 先用 search_symbol 定位类/方法定义
2. 用 get_file_content 获取完整源码
3. 分析代码逻辑，结合 Bug 现象给出修复建议
```

### 场景 3：跨项目对比

需要对比不同平台的实现差异：

```
1. search_code query="关键词" project="d4_code"
2. search_code query="关键词" project="x5_code"
3. 对比两个平台的实现差异
```

## 搜索策略优先级（更新）

结合 local-code-guide 的搜索策略：

```
① 本地 git grep（最高优先级，~0.4s）
② 读取本地已知路径文件（即时）
③ OpenGrok 远程搜索（最低优先级，需用户确认后才使用）
    ├── 前提：本地无代码映射 + 用户明确同意
    ├── search_code — 全文搜索
    ├── search_symbol — 符号定义
    ├── search_path — 文件路径
    └── get_file_content — 获取完整文件
```

> 注意：OpenGrok 返回的结果需标注"来源：OpenGrok 公版代码（可能与实际 PCBA 项目代码存在差异）"

## 结果中的路径说明

搜索结果中的文件路径格式为：`/<project>/<path>`

例如：`/d4_code/amlogic/vendor/amlogic/reference/tv/frameworks/core/java/com/droidlogic/app/tv/TvScanConfig.java`

- 第一级目录是项目名（d4_code、stb16_code、x5_code）
- 后续路径是代码库内的相对路径

## 连接验证

```bash
# 测试搜索 API
curl -s -u "<用户名>:<密码>" "https://opengrok.zeasn.com/api/v1/search?full=test&maxresults=1"
# 预期返回 JSON 格式的搜索结果
```

## 关键约束

- OpenGrok 是**只读**的，只能搜索和查看代码，不能修改
- OpenGrok 仅包含**公版代码**，不包含各 PCBA 定制代码，结果可能与实际项目有差异
- **必须先询问用户确认**后才能使用 OpenGrok，不得自动降级到 OpenGrok
- 优先级低于本地代码：本地有代码映射时，绝不使用 OpenGrok
- 搜索结果中的 HTML 标签（如 `<b>`）需要去掉后展示
- 展示 OpenGrok 结果时必须标注"来源：OpenGrok 公版代码"
- 获取文件内容时注意文件可能很大，必要时只展示关键部分
- 不要在输出中暴露 OpenGrok 密码
- 如果用户没有指定项目，默认搜索所有项目

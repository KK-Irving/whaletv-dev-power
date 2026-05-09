---
name: whaletv-dev-power
displayName: WhaleTV Developer Power
version: 1.0.0
description: 面向 WhaleTV 开发者的 AOSP 开发辅助工具包，集成 Zmind 项目管理、OpenGrok 代码搜索和团队标准工作流
keywords:
  - whaletv
  - aosp
  - zmind
  - gerrit
  - opengrok
  - cherry-pick
  - pr
  - cr
  - android
  - 项目管理
  - 代码搜索
mcpServers:
  - name: zmind-mcp-server
    path: ./mcp-servers/zmind-mcp-server
    command: npx tsx src/index.ts
    env:
      - ZMIND_API_KEY
      - ZMIND_URL
  - name: opengrok-mcp-server
    path: ./mcp-servers/opengrok-mcp-server
    command: npx tsx src/index.ts
    env:
      - OPENGROK_URL
      - OPENGROK_PROJECT
---

# WhaleTV Developer Power

面向 WhaleTV 全体 AOSP 开发者的 Kiro Power 工具包。集成 Zmind 项目管理、OpenGrok 代码搜索和团队标准工作流，使开发者在远程 Linux 服务器上通过 Kiro CLI 即可获得完整的 AI 辅助开发能力。

## 功能概览

- **Zmind 项目管理**：查询/创建/更新 Issue、工时记录、项目成员查询等 14 个工具
- **OpenGrok 代码搜索**：全文搜索和符号定义查找，快速定位 AOSP 源码
- **PR/CR 工作流**：从获取 Issue 到推送 Gerrit 的全链路自动化
- **Cherry-Pick 工作流**：跨代码库批量 CP 同步到 MP 分支
- **Bug 分析工作流**：自动下载日志、解析异常、定位代码、生成报告
- **安全防护**：三层安全机制（规则约束 + Hook 拦截 + 人工确认）

## 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Ubuntu 20.04+ |
| Node.js | 18+ |
| 运行环境 | 远程 Linux 服务器（CLI 环境），无需 GUI |

## 环境变量配置

| 变量名 | 用途 | 必需 | 默认值 | 格式示例 |
|--------|------|------|--------|----------|
| ZMIND_API_KEY | Zmind 用户 API 密钥 | ✅ 是 | 无 | a1b2c3d4e5f6...(40 位十六进制) |
| ZMIND_URL | Zmind 服务地址 | ❌ 否 | https://zmind.whaletv.com | https://zmind.whaletv.com |
| OPENGROK_URL | OpenGrok 服务地址 | ✅ 是 | 无 | http://opengrok.zeasn.com:8080 |
| OPENGROK_PROJECT | 默认搜索项目名 | ❌ 否 | 无 | d4_code |

### 设置方法

在 `~/.bashrc` 或 `~/.zshrc` 中添加：

```bash
export ZMIND_API_KEY="你的40位API密钥"
export OPENGROK_URL="http://opengrok.zeasn.com:8080"
# 可选
export ZMIND_URL="https://zmind.whaletv.com"
export OPENGROK_PROJECT="d4_code"
```

设置后执行 `source ~/.bashrc` 使配置生效。

## 推荐使用方式

在 AOSP 源码根目录或子模块目录下启动 Kiro CLI：

```bash
cd ~/cvte_code/amlogic
kiro
```

这样 AI 可以直接访问项目文件，使用 `git grep` 进行高效代码搜索，并结合本地源码上下文进行分析和开发。

## 配置验证

激活 Power 前，请运行以下命令确认环境变量已正确设置且服务可达：

```bash
# 检查环境变量是否已设置
echo "ZMIND_API_KEY: ${ZMIND_API_KEY:+已设置}"
echo "OPENGROK_URL: ${OPENGROK_URL:+已设置}"

# 验证 Zmind 连接（应返回 200）
curl -s -o /dev/null -w "%{http_code}" "${ZMIND_URL:-https://zmind.whaletv.com}/users/current.json?key=$ZMIND_API_KEY"

# 验证 OpenGrok 连接（应返回 200）
curl -s -o /dev/null -w "%{http_code}" "$OPENGROK_URL/api/v1/configuration"

# 检查 Node.js 版本（需要 18+）
node --version
```

所有检查通过后即可正常使用 Power。

## 故障排查

### ZMIND_API_KEY 未设置

**现象**：调用 Zmind 相关工具时报错"环境变量 ZMIND_API_KEY 未配置"

**排查步骤**：

1. 确认变量已设置：
   ```bash
   echo $ZMIND_API_KEY
   ```
   如果输出为空，说明变量未设置。

2. 设置变量：
   ```bash
   export ZMIND_API_KEY="你的API密钥"
   ```

3. 获取 API 密钥：登录 Zmind 系统 → 右上角"我的账户" → 左侧"API 访问密钥" → 显示/重置密钥

4. 验证密钥有效性：
   ```bash
   curl -s "${ZMIND_URL:-https://zmind.whaletv.com}/users/current.json?key=$ZMIND_API_KEY" | head -c 200
   ```
   如果返回用户信息 JSON，说明密钥有效。

### OPENGROK_URL 未设置

**现象**：调用 OpenGrok 搜索工具时报错"环境变量 OPENGROK_URL 未配置"

**排查步骤**：

1. 确认变量已设置：
   ```bash
   echo $OPENGROK_URL
   ```
   如果输出为空，说明变量未设置。

2. 设置变量：
   ```bash
   export OPENGROK_URL="http://opengrok.zeasn.com:8080"
   ```

3. 验证服务可达：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" "$OPENGROK_URL/api/v1/configuration"
   ```
   如果返回 200，说明服务正常。如果连接超时或拒绝，请确认：
   - 网络是否可达（是否需要 VPN）
   - URL 地址和端口是否正确
   - OpenGrok 服务是否正在运行

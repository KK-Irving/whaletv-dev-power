# v3.0.0 发布 Checklist

**目标日期**：待定
**发布者**：<填>
**Registry**：`https://registry.npmjs.org/`（公共 npm）
**Scope**：`@kk-irving`

---

## 待发布包（5 个）

| 顺序 | 包 | 新版本 | 上一版本 | 主要变化 |
|---|---|---|---|---|
| 1 | `@kk-irving/opengrok-mcp-server` | **1.2.1** | 1.2.0 | 修 bin path bug（`./dist/index.js` → `dist/index.js`，避免 npm 7+ strip）+ sot-loader |
| 2 | `@kk-irving/confluence-mcp-server` | **1.0.1** | 1.0.0 | 加 sot-loader（读 SoT，env 优先兼容） |
| 3 | `@kk-irving/zmind-mcp-server` | **2.1.2** | 2.1.1 | 加 sot-loader |
| 4 | `@kk-irving/gerrit-mcp-server` | **1.1.1** | 1.1.0 | 加 sot-loader |
| 5 | `@kk-irving/knowledge-mcp-server` | **1.1.0** | 1.0.2 | **新增 generate_report + upload_report**（治理层，Report Fact v1 schema + 自包含 HTML + S3 SigV4 零依赖）+ sot-loader |

**总计**：4 个 patch 版本（sot-loader 补丁）+ 1 个 minor 版本（knowledge 新工具）

## 前置准备（已完成 ✓）

- [x] 5 个包的 `package.json` 版本已 bump
- [x] 5 个包的 `dist/` 已 rebuild（tsc 无错误）
- [x] 每个包的 `dist/index.js` 首行有 `#!/usr/bin/env node` shebang
- [x] 每个包的 `dist/sot-loader.js` 已生成（6150 bytes 全一致）
- [x] opengrok bin path bug 已修（`bin.opengrok-mcp-server = "dist/index.js"` 不带 `./`）
- [x] knowledge-mcp 4 个新 dist 就位（`generate-report.js` / `report-schema.js` / `report-template.js` / `upload-report.js`）
- [x] 5 个包的 `npm publish --dry-run` 都成功

## 发布步骤

### Step 1：npm login

```bash
npm login
# 或 export NPM_TOKEN=<your-token>
```

用户账户需要有 `@kk-irving` scope 的发布权限。验证：

```bash
npm whoami
# 应输出：kk-irving（或有权限的其他账户）
```

### Step 2：跑发布脚本

```bash
node scripts/publish-v3.mjs
```

脚本会：
1. 检查 npm 登录状态
2. 逐包 pre-flight 验证（版本号 / dist / shebang / sot-loader / bin path）
3. 展示待发清单，等用户输 `yes` 确认
4. **按顺序发 5 个包**（每个发完立即 `npm view` 验证 registry 收到）
5. 任何一个失败立即停止（不半推半就）

**跳过确认**（CI / 脚本化场景）：

```bash
node scripts/publish-v3.mjs --yes
```

### Step 3：git tag + push

```bash
git add -A
git commit -m "[v3.0.0][feature][whaletv] v3 架构级治理升级：单一凭据源 + Kiro 官方 hook + description-driven skills + 治理报告 + 跨终端 CLI"
git tag -a v3.0.0 -m "v3.0.0: 42 tasks 全部完成，5 个 MCP server 全部发布"
git push origin <branch>
git push origin v3.0.0
```

### Step 4：通知团队

参见 [`.learnings/v3-team-announcement.md`](v3-team-announcement.md)（若已建）或直接用 `README.md` 的 `v2 → v3 迁移路径` 章节。

**核心一句话通知**：

```
v3.0.0 已发布，架构级升级 42 tasks 全部完成，5 个 MCP server 已上 npm。
升级：git pull && node scripts/deploy.mjs && node scripts/whaletv-credentials.mjs migrate
详见 README 的 v2→v3 迁移路径章节。
```

## 发布后验证（在干净 workspace）

```bash
# 1. 验证每个包 registry 可拉
npm view @kk-irving/opengrok-mcp-server@1.2.1 version
npm view @kk-irving/confluence-mcp-server@1.0.1 version
npm view @kk-irving/zmind-mcp-server@2.1.2 version
npm view @kk-irving/gerrit-mcp-server@1.1.1 version
npm view @kk-irving/knowledge-mcp-server@1.1.0 version

# 2. 验证 npx 能启动（会等 stdio 输入，Ctrl+C 退出）
npx -y @kk-irving/opengrok-mcp-server@1.2.1
npx -y @kk-irving/knowledge-mcp-server@1.1.0

# 3. 验证 knowledge-mcp 的新工具在 Kiro 里可见（重启 Kiro 后检查工具列表）
#    应该新增 2 个工具：generate_report + upload_report

# 4. 验证 SoT 集成（有 SoT 时 stderr 应打印 [sot-loader] 从 ~/.ai/whaletv.yaml 注入 N 个环境变量）
```

## 回滚预案

### 24h 内：npm unpublish

```bash
npm unpublish @kk-irving/opengrok-mcp-server@1.2.1
npm unpublish @kk-irving/confluence-mcp-server@1.0.1
npm unpublish @kk-irving/zmind-mcp-server@2.1.2
npm unpublish @kk-irving/gerrit-mcp-server@1.1.1
npm unpublish @kk-irving/knowledge-mcp-server@1.1.0
```

npm 政策：**发布后 24 小时内**允许 unpublish。之后只能 `npm deprecate` 标记为不推荐。

### 24h 后：npm deprecate + 修补版本

```bash
# 标记为 deprecated
npm deprecate @kk-irving/knowledge-mcp-server@1.1.0 "critical bug, use 1.1.1 instead"

# 发修补版本
# 修 bug → bump version → 重跑 publish-v3.mjs
```

### 用户端回退到 v2

用户 mcp.json 里明确锁旧版本：

```json
{
  "mcpServers": {
    "knowledge-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/knowledge-mcp-server@1.0.2"]
    }
  }
}
```

（其他 4 个 server 用 `@2.1.1` / `@1.1.0` / `@1.0.0` / `@1.2.0` 分别锁）

## 已知潜在风险

| 风险 | 触发条件 | 影响 | 应对 |
|---|---|---|---|
| npm token 过期 | 上次登录 > 30 天 | publish 失败 | 重新 `npm login` |
| @kk-irving scope 权限不够 | 用非 owner 账号发 | 403 Forbidden | 换 owner 账号 或让 owner 加协作者 |
| dist 与 src 不同步 | 忘记 rebuild | 发出的代码是老的 | publish-v3.mjs 的 prepublishOnly 会重跑 build |
| npm registry 502/503 | npm 服务方问题 | publish 失败 | 稍后重试，不影响本地 |
| 用户 Kiro 缓存了 `@latest` | Kiro 内 mcp 客户端老 | 新工具在 Kiro 里看不到 | 通知用户 Reload Window 或删 `~/.npm/_npx/` 缓存 |
| knowledge-mcp v1.1.0 的 upload_report 需要 S3 凭据 | 用户 SoT 无 `s3_issue_analysis` 段 | 调 upload_report 报错 | 报错信息已明确指引 whaletv-credentials set |

## 发布记录（Post-mortem）

- **实际发布时间**：2026-07-01
- **实际 publisher**：`winn.wei`
- **每包发布结果**：
  - [x] opengrok-mcp-server@1.2.1 → 2026-07-01 / **OK**（tarball 5.4 kB / unpacked 15.0 kB / 3 files / shasum 094a680…）
  - [x] confluence-mcp-server@1.0.1 → 2026-07-01 / **OK**（tarball 9.3 kB / unpacked 25.5 kB / 9 files / shasum 68b42bec…）
  - [x] zmind-mcp-server@2.1.2 → 2026-07-01 / **OK**（tarball 22.3 kB / unpacked 79.0 kB / 5 files / shasum 660f2205…）
  - [x] gerrit-mcp-server@1.1.1 → 2026-07-01 / **OK**（tarball 31.2 kB / unpacked 105.4 kB / 14 files / shasum 2fd354bc…）
  - [x] knowledge-mcp-server@1.1.0 → 2026-07-01 / **OK**（tarball 53.7 kB / unpacked 184.0 kB / 23 files / shasum c5698efc…）
- **遇到的问题**：
  1. **首次尝试用 classic token + `--otp` 全部 E403 失败**。npm 错误信息为 "Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages"。看似 OTP 应能通过，但因 context 压缩导致 OTP 从收到到实际提交 registry 之间已过期（TOTP 30 秒窗口）。
  2. Node 24 在 Windows 上 `spawnSync('npm.cmd')` 默认 `shell: false` 会找不到 `.cmd`，需显式 `shell: true`（已在 `publish-v3.mjs` 中修复）。
  3. Pwsh 7 默认 `ExecutionPolicy: Restricted` 阻止 `npm.ps1` 加载，需改用 `npm.cmd`（通过 `& npm.cmd <args>` 显式调用）。
- **修复方式**：
  1. 用户在 npmjs.com 生成 **granular access token**（scope=`@kk-irving`, permission=Read and write, **勾选 "Bypass 2FA for publishing"**），替换 `~/.npmrc` 中的 `_authToken`。切换后不再需要 OTP，直接 `npm publish` 通过。
  2. 逐包用 `npm.cmd publish --access public` + `Tee-Object` 落盘每包 log 到 `.scratch/publish-*.txt`，避免依赖脚本的 spawn 兼容性。
- **备份**：旧 classic token 已备份为 `~/.npmrc.bak-v3publish`，如需回退可 `Copy-Item` 覆盖。

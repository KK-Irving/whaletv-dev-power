# Learnings

开发过程中积累的修正、洞察、知识缺口和最佳实践。

**分类**: correction | insight | knowledge_gap | best_practice

---

## 2026-07-01 — npm publish 2FA 强制账户必须用 granular token（best_practice）

**背景**：v3.0.0 发布 5 个 MCP server 时，classic auth token + `npm publish --otp=<code>` 一直返回 E403 `Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`。

**根因**：
- npm 账户 `winn.wei` 的 2FA 策略是 **"Authorization and writes"**（strict 模式），classic auth token 在 publish 场景下**即使带 `--otp` 也可能被拒**。
- 官方推荐路径：**granular access token + "Bypass 2FA for publishing"** 勾选后可绕过 OTP 检查。
- 备用路径：用户手动交互式 `npm login --auth-type=web`（浏览器 OAuth）也能拿到合规 session token。

**解决**：
- 用户在 https://www.npmjs.com/settings/<user>/tokens 生成 **Granular Access Token**：
  - Scope: `@<scope>`（我们是 `@kk-irving`）
  - Permission: Read and write
  - **✅ Bypass 2FA for publishing**
- 替换 `~/.npmrc` 中 `//registry.npmjs.org/:_authToken=<新 token>`，无需 OTP 即可 publish。

**副坑**：
1. **Windows pwsh + npm 组合**：pwsh 7 默认 ExecutionPolicy Restricted → `npm.ps1` 加载失败。必须显式 `& npm.cmd <args>` 直接调 cmd 脚本。
2. **Node 24 + spawnSync + Windows**：`spawnSync('npm.cmd', args)` 默认 `shell: false` 找不到 `.cmd` 后缀。必须在 spawn opts 里 `shell: true`。
3. **TOTP 与 AI 助手的时序问题**：AI 从收到 OTP 到实际 spawn `npm publish` 之间可能已过 30 秒（context 压缩、preflight 校验等）。**永远不要依赖 AI 传递 OTP**，改用长期有效的 granular token。

**产物**：
- `~/.npmrc.bak-v3publish`（旧 classic token 备份）
- `.scratch/publish-{opengrok,confluence,zmind,gerrit,knowledge}.txt`（每包发布 log）
- `.learnings/v3-release-checklist.md` 已回填 post-mortem

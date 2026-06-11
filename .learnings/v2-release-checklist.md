# v2.0.0 发布 Checklist

## 已完成 ✓

- [x] 代码：5 个 MCP server 全部编译通过（gerrit v1.1.0 / zmind v2.1.1 / confluence v1.0.0 / knowledge v1.0.0 / opengrok 不变）
- [x] Smoke test：19/19 通过（含 confluence form login + 真实命中）
- [x] 文档：POWER.md / README.md / 5 个 steering / agent prompt 全部升级
- [x] 部署：scripts/setup-v2.{ps1,sh} + scripts/refresh-auth.{ps1,sh,mjs}
- [x] mcp.json 模板更新到 5 server v2 配置
- [x] FEATURE_REQUESTS 标记 P3 完成
- [x] **npm publish**：4 个 server 已发布到 npm registry（含 v2.1.1 修复 zmind bin path 问题）
  - `@kk-irving/gerrit-mcp-server@1.1.0` ✓
  - `@kk-irving/zmind-mcp-server@2.1.1` ✓（v2.1.0 因 bin 路径含 `./` 被 npm strip，立即 v2.1.1 修复重发）
  - `@kk-irving/confluence-mcp-server@1.0.0` ✓
  - `@kk-irving/knowledge-mcp-server@1.0.0` ✓

## 待用户执行

### 1. git commit + tag

```bash
git add -A
git commit -m "[v2.0.0][feature][whaletv][FR-002~FR-009] v2 平台升级 — Gerrit 双通道 / RAR5 / WAF / Confluence / Knowledge / analyze_issue"
git tag v2.0.0
git push origin <你的分支>
git push origin v2.0.0
```

### 2. （可选）Power 平台重新发布

如果你们用 Kiro Power 中心，需要：
1. 重新打包 power（zip 整个仓库或者 git archive）
2. 上传到 Power 仓库
3. 让团队在 Kiro 内 reinstall power

### 3. 团队通知模板

```markdown
**WhaleTV Developer Power v2.0.0 已发布** 🎉

5 个 MCP server 升级：
- gerrit-mcp v1.1.0 — 双通道认证（过 nginx 双层网关）
- zmind-mcp v2.1.1 — RAR5 三档解压 + WAF 重试（v2.1.1 修复 bin path）
- confluence-mcp v1.0.0 — 文档中心 MCP（新）
- knowledge-mcp v1.0.0 — 本地向量+FTS5 知识库 + analyze_issue 端到端（新）
- opengrok-mcp（不变）

升级步骤：
1. 拉最新代码：`git pull && git checkout v2.0.0`
2. 跑：`PowerShell -ExecutionPolicy Bypass -File scripts\setup-v2.ps1`（或 `bash scripts/setup-v2.sh`）
3. 重启 Kiro

新功能：
- 一键端到端：在 Kiro 内说 "用 analyze_issue 分析 #<ID>"
- 跨源历史检索：search_local("关键词", source="all")
- cookie 过期不再 F12：scripts/refresh-auth.ps1 一键

注意：
- Node.js 需 ≥ 22.5（knowledge-mcp 用 node:sqlite 内置模块）
- Confluence 是独立账号（用户名首字母大写，独立密码）；refresh-auth 会单独 prompt
- 首次 embed_pending 会下 BGE-small-zh ONNX 模型（~80MB）

详细文档：POWER.md / steering/knowledge-base-workflow.md / steering/auth-refresh.md
```

## 回滚预案

如发布后发现严重问题：

```bash
# 1. unpublish（npm 24h 内可 unpublish）
npm unpublish @kk-irving/gerrit-mcp-server@1.1.0
npm unpublish @kk-irving/zmind-mcp-server@2.1.1
npm unpublish @kk-irving/confluence-mcp-server@1.0.0
npm unpublish @kk-irving/knowledge-mcp-server@1.0.0

# 2. 用户回退到 v1.x
# 在 mcp.json 改 args 用具体版本：
# "args": ["-y", "@kk-irving/gerrit-mcp-server@1.0.0"]
# "args": ["-y", "@kk-irving/zmind-mcp-server@2.0.0"]
# 删除 confluence-mcp + knowledge-mcp 条目

# 3. git reset
git tag -d v2.0.0
git push origin :v2.0.0
git revert <merge-commit>
```

## 已知不阻塞发布的项

| 项 | 状态 | 处理 |
|---|---|---|
| RAR5 真实附件实测 | ⏳ 待场景 | 用户跑实际工作流时若失败再修 |
| WAF 限速实测 | ⏳ 待场景 | 同上 |
| AOSP 索引端到端实测 | ⏳ 需要本地 repo | 由有 AOSP 工作树的同事先跑 |
| analyze_issue 端到端实测 | ⏳ 需要真实 PR | 同上 |

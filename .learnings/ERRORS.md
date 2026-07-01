# Errors

命令失败、API 错误和集成问题记录。

---
## ERR-001：npm publish 时 `bin` 路径含 `./` 前缀被 strip（2026-06-11）

**现象**：`@kk-irving/zmind-mcp-server@2.1.0` publish 完成后，npm 输出 warning：
```
npm warn publish "bin[zmind-mcp-server]" script name dist/index.js was invalid and removed
```
导致 published 包的 manifest 中 `bin` 字段为空，用户跑 `npx -y @kk-irving/zmind-mcp-server@latest` 找不到入口。

**根因**：npm 7+ 对 `bin` 字段路径校验严格，`./dist/index.js` 这种带 `./` 前缀的相对路径会被认为 invalid 并整个 strip。其他几个 server（gerrit / confluence / knowledge）的 `bin` 路径都是 `dist/index.js`（无前缀），所以没问题。

**修复**：
1. `mcp-servers/zmind-mcp-server/package.json` — `"bin": { "zmind-mcp-server": "dist/index.js" }`（去掉 `./`）
2. version bump v2.1.0 → v2.1.1
3. 同步加 `"main": "./dist/index.js"` 字段，保留 require 入口
4. `npm publish --access=public` 重发 v2.1.1，无任何 warning

**预防**：
- 所有 server 的 `package.json bin/main` 路径统一用相对（无 `./`）
- 在 release-checklist 加一条：publish 后立即 `npm view <pkg>@<version> bin` 验证 manifest

**影响**：v2.1.0 在 npm registry 永久占用但不可用；用户必须用 `@2.1.1` 或 `@latest` 拿到能跑的版本。

## ERR-002：knowledge-mcp sync watermark 用 ISO 格式 → 第二次增量同步 0 命中（2026-06-22）

**现象**：首次 `sync_zmind` / `sync_confluence` 拉取正常，但第二天再跑 0 命中或全量重拉。

**根因**：`watermark = new Date().toISOString()` 写入 `2026-06-22T10:30:45.123Z`，但下次 sync 时把这个字符串送给 API：
- Zmind：`updated_on >= 2026-06-22T10:30:45.123Z` → Redmine 解析失败
- Confluence CQL：`lastmodified > "2026-06-22T10:30:45.123Z"` → CQL parser 拒绝（要求 `YYYY-MM-DD HH:mm`）

Gerrit 没踩到这个坑，因为它本来就 slice(0, 10)。

**修复**（v1.0.1）：
1. zmind watermark 用 `YYYY-MM-DD`
2. confluence watermark 用 `YYYY-MM-DD HH:mm`（CQL 格式）
3. 所有源新增 `toCqlDateTime` / `slice(0,10)` 规范化时入参也归一化（防御传入的 stateSince 也是 ISO）
4. watermark 不再用"sync 开始时间"，改用"已拉取的最大 updated_on"，避免 sync 期间的新数据漏

**预防**：所有跨服务时间字段写入 `sync_state` 前先过 normalize 函数。

---

## ERR-003：knowledge-mcp sync_gerrit 默认 query `status:open OR -status:open` 0 命中（2026-06-22）

**现象**：`sync_gerrit({})` 跑完 0 条，但同账号同 cookie 调 gerrit-mcp 的 `search_changes("owner:winn.wei")` 正常返回。

**根因**：`buildQuery` 默认 `status:open OR -status:open`。Gerrit Lucene query parser 对 OR 优先级处理与 AND 隐式优先级不同，部分版本下被解析成 `status:open AND (-status:open)` → 永远 0。

**修复**（v1.0.1）：默认改为 `(owner:self OR reviewer:self) -age:365d`，加 `KNOWLEDGE_GERRIT_SYNC_QUERY` 环境变量自定义。

---

## ERR-004：refresh-auth.mjs 写 mcp.json 不识别 Kiro Power namespace（2026-06-22）

**现象**：跑 `scripts/refresh-auth.ps1` 抓 cookie 后，gerrit-mcp / confluence-mcp 仍然 401。检查 mcp.json 发现 cookie 写在 `mcpServers.gerrit-mcp-server`，但 Kiro 实际加载的是 `mcpServers["power-whaletv-dev-power-gerrit-mcp-server"]` 或 `powers.mcpServers["power-whaletv-dev-power-gerrit-mcp-server"]`（嵌套）。

**根因**：refresh-auth.mjs 硬编码了 server key 字面量 `"gerrit-mcp-server"`，没考虑 Power 安装的命名空间前缀。

**修复**：`injectServerEnv` 改为 substring 匹配 — 扫描 `cfg.mcpServers` 与 `cfg.powers.mcpServers` 所有以 server 名结尾的 key 全部更新；都不存在时同时创建本地路径 + Power 路径双份。

**预防**：所有 mcp.json 写入脚本（refresh-auth、新增的 setup-creds）都共用此 substring 匹配 + 双写逻辑。

---

## ERR-005：AI 在 Kiro IDE 中无法直接写 `~/.kiro/settings/mcp.json`（2026-06-22）

**现象**：onboarding 流程中 AI 收集到用户凭据后尝试直接写 mcp.json，被 Kiro 拦截：

```
Invalid path: c:\Users\PC\.kiro\settings\mcp.json resolves to a location outside the workspace, you can only edit files in the users workspace.
```

或：

```
ENOENT: no such file or directory, open 'c:\Users\PC\AppData\Roaming\Kiro\User\globalStorage\...\.kiro\settings\mcp.json'
```

**根因**：Kiro IDE 安全约束 — AI 通过 fs_write 工具只能写 workspace 内文件。`~/.kiro/settings/mcp.json` 在 workspace 外。

**解决**：
1. 新增 `scripts/setup-creds.mjs`：Node 脚本接受环境变量 + 写到 home 目录（脚本本身不受 workspace 限制）
2. 升级 `scripts/setup-v2.{ps1,sh}`：交互收集 4 套凭据 → 调 setup-creds + refresh-auth 一气呵成
3. 修改 `steering/onboarding.md`：明确 AI **绝不直接写** mcp.json，只负责"收集凭据 + 给运行命令"，由 terminal 跑脚本写入

**预防**：steering/onboarding.md 顶部加 AI 必读约束章节，提醒所有 mcp.json 写入必须走脚本。

---

## ERR-006：Confluence 账号无 batch API 权限 → 403（2026-06-22，v1.0.2 已缓解 → 见 ERR-008）

**现象**：用户 cookie 有效（浏览器登录能看 spaces，能搜索网页 `dosearchsite.action`），但 `search_confluence` MCP 工具调用返回：

```
Confluence HTTP 403: Not permitted to use confluence
```

**根因**：账号缺少 Atlassian 全局权限（"Use Confluence"、"Search" 等）。这跟 cookie 是否有效是两码事 —— cookie 只代表登录状态，权限是登录后访问每个 API 时单独检查的。

**确认**：
- ✅ `list_spaces` 通：账号有列空间权限
- ❌ `search_confluence` (CQL `/rest/api/content/search`) 403：缺批量搜索权限
- ❌ `sync_confluence`（同样调 `/rest/api/content/search`）403：同上

**workaround**：`get_page` 拉单页正文仍可工作（如果对应空间有 read 权限），但不能用 `search_confluence` 全局搜或 `sync_confluence` 批量同步。

**根本解决**：找运维或 Atlassian 管理员加 "Use Confluence" + "Search" 全局权限。客户端这边解决不了。

**预防**：onboarding 验证步骤跑通 `list_spaces` 后立刻试调 `search_confluence`，403 时清晰告诉用户"账号权限问题，找运维"，避免误以为是配置错误。

## ERR-007：knowledge-mcp sync_gerrit 增量同步丢失 default scope（2026-06-22）

**现象**：第一次 `sync_gerrit({})` 命中 50 条 owner/reviewer:self 的 changes（query=`(owner:self OR reviewer:self) -age:365d`）。第二次跑时本应只拉自己 6/11 后的更新，实际却 fetched=50 达 limit，怀疑拉到了所有人的 changes。

**根因**：`buildQuery` 用 `if (parts.length === 0) parts.push(default)` — 一旦 `args.since` 有值，parts 已非空，default scope `(owner:self OR reviewer:self)` **就不再叠加**。第二次 query 退化成 `after:"2026-06-11"`（拉整个 Gerrit 的最近变更）。

**修复**（v1.0.1）：

```typescript
function buildQuery(args) {
  const parts = [];
  if (args.query) {
    // 用户显式 query 完全覆盖默认
    parts.push(args.query);
  } else {
    // 默认 scope 始终生效（含增量）；-age 仅首次叠加
    const def = (process.env.KNOWLEDGE_GERRIT_SYNC_QUERY ?? "").trim()
                || "(owner:self OR reviewer:self)";
    parts.push(args.since ? def : `${def} -age:365d`);
  }
  if (args.project) parts.push(`project:${args.project}`);
  if (args.since) parts.push(`after:"${args.since}"`);
  return parts.join(" ");
}
```

**验证**：第二次 sync 输出
```
query: "(owner:self OR reviewer:self) after:\"2026-06-11\""
fetched: 3
```
真实只有 3 条 owner/reviewer:self 在 6/11 后更新 — 修复有效。

**预防**：所有 `buildQuery` 类函数检查"用户参数 vs 默认 scope"组合时，**默认 scope 必须无条件叠加**（除非用户显式覆盖），不能因为某个可选参数填了就当作"用户接管全部 query"。

## ERR-008：Confluence REST batch 403 的 fallback endpoint 探测（2026-06-30）

**背景**：ERR-006 中账号在部分 space 上 `/rest/api/content/search` CQL / `/rest/api/content?spaceKey=...` batch 返回 403，虽然浏览器登录能看 spaces + 能网页搜索。当时 workaround 只能"找运维加权限"，客户端阻塞。

**探测过程**：
1. 尝试 `/dosearchsite.action` HTML 爬取 fallback — 发现 Confluence 6.x 部署已改 SPA 渲染：服务端只返回 30KB HTML shell（含 34 个导航 anchor，0 个搜索结果 anchor），实际结果由前端 JS XHR 拉取
2. 让用户 F12 抓 XHR，发现真实端点：`/rest/searchv3/1.0/cqlSearch`
3. 该端点接受 CQL 语法 + `start` / `limit` 分页 + `sessionUuid`（可随机生成）+ `user`（可选，服务端从 cookie X-AUSERNAME 提取）
4. **权限门槛比 `/rest/api/content/search` 低** — 只要账号有 view permission（能登录看空间）就能调，无需 "Search" 全局权限

**实现**（v1.0.2）：
- 新增 `mcp-servers/knowledge-mcp-server/src/sources/confluence-fallback.ts` — searchv3 优先 + dosearchsite legacy 双 endpoint 自动探测
- `syncConfluence({ mode: "auto" | "rest" | "html" })` 参数 + `KNOWLEDGE_CONFLUENCE_SYNC_MODE` env
- Auto 模式：先 REST，403 时自动切 searchv3 fallback
- 结果直接从搜索响应拿 body（若含），否则走 `/rest/api/content/{id}` 单页 REST（视图权限低于 batch）；再 fallback 到 `/pages/viewpage.action` HTML 爬 wiki-content div

**验证**（2026-06-30）：
- `sync_confluence({ mode: "html", limit: 5 })` 拉到 5 页 + 完整 body
- 单次 searchv3 请求 got=25 条 hits，totalSize=2515（RDCenter 空间总页数）
- watermark 用 max `version.when` 推进（`2026-06-30 15:16` 格式）

**未来改进**：
- 若 searchv3 端点也 403（账号完全无 view 权限），可加第三档 fallback：`/rest/api/space/{spaceKey}/content` 路径式 endpoint 探测
- searchv3 默认按 lastmodified desc 排序（对增量友好），可考虑替代 REST 主路径成为默认（等更多部署验证）


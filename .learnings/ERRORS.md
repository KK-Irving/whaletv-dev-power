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


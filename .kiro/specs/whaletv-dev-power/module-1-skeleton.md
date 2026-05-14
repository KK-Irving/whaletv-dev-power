---
inclusion: manual
---

# Skill: 模块 1 - 项目骨架与 POWER.md

## 适用范围

创建 whaletv-dev-power 的目录结构、配置文件和 POWER.md 文档。

## 目录结构规范

```
whaletv-dev-power/
├── POWER.md
├── mcp-servers/
│   ├── zmind-mcp-server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   └── opengrok-mcp-server/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts
├── steering/
│   ├── pr-cr-workflow.md
│   ├── cherry-pick-workflow.md
│   ├── bug-analysis-workflow.md
│   ├── gerrit-workflow.md
│   ├── local-code-guide.md
│   └── safety-rules.md
└── hooks/
    └── safety-hooks.json
```

## POWER.md 规范

- 使用 YAML frontmatter 格式定义元数据
- identifier 字段值必须为 `whaletv-dev-power`
- displayName 为 `WhaleTV Developer Power`
- description 不超过 80 字符
- version 遵循语义化版本 (MAJOR.MINOR.PATCH)
- keywords 必须包含：whaletv, aosp, zmind, gerrit, opengrok, cherry-pick, pr, cr, android, 项目管理, 代码搜索
- mcpServers 数组声明两个服务器，每个包含 name、path、command、env

## package.json 规范

- `"type": "module"` (ESM)
- 依赖使用固定版本号（不用 ^ 或 ~）
- 固定版本：
  - `@modelcontextprotocol/sdk`: `1.12.1`
  - `zod`: `3.24.4`
  - `tsx`: `4.19.4`
  - `typescript`: `5.8.3`
  - `@types/node`: `24.0.3`

## tsconfig.json 规范

- target: ES2022
- module: NodeNext
- moduleResolution: NodeNext
- strict: true
- outDir: ./dist
- rootDir: ./src

## 文档语言

- POWER.md 正文使用中文
- 代码注释使用中文
- 配置文件中的 description 字段使用英文（npm 规范）

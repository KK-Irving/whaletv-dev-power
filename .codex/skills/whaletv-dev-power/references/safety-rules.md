# 安全规则与约束

## 触发场景

本文件定义 AI 在所有操作中必须遵守的安全规则。三层防护体系在每次操作前自动生效，无需用户显式激活。

## 目的

定义三层安全防护体系，确保 AI 不会执行危险操作（如误推 release 分支、执行 sudo 命令、大范围搜索导致性能问题等），保护代码库和系统安全。

## 三层防护体系

```
AI 准备执行操作
    │
    ▼
┌─────────────────────────────────┐
│ 第一层：规则约束                   │
│ （Steering 指导 AI 行为）          │
│ AI 自行判断并拒绝违规操作           │
└─────────────┬───────────────────┘
              │ 通过
              ▼
┌─────────────────────────────────┐
│ 第二层：Hook 拦截                  │
│ （命令执行前自动阻断）              │
│ 系统自动匹配命令模式并拦截          │
└─────────────┬───────────────────┘
              │ 通过
              ▼
┌─────────────────────────────────┐
│ 第三层：人工确认                   │
│ （高风险操作的显式授权）            │
│ 暂停等待用户明确确认后才继续        │
└─────────────┬───────────────────┘
              │ 用户确认
              ▼
         ✅ 执行操作
```

---

## 第一层：规则约束

Steering 文件中定义的 AI 行为边界。AI 必须在执行前自行判断是否违反以下规则，违反时拒绝执行并向用户说明原因。

| 规则 | 说明 | 违反时的处理 |
|------|------|-------------|
| MP 分支禁止自动推送 | 任何 `*_mp` 分支必须用户确认后才能 push | 展示 push 目标分支，等待用户明确确认 |
| git add 必须精确到 hunk 级别 | 必须使用 `git add -p`，禁止 `git add .` 或 `git add -A` | 拒绝执行全量 add，改用 `git add -p` |
| Target version 必须由用户明确指定 | AI 不得根据分支名或上下文自行推断 target version | 询问用户指定版本号 |

### 规则详细说明

**MP 分支禁止自动推送**：
- 适用于所有名称包含 `_mp` 后缀的分支（如 `os10_mp`、`os10_3_mp`）
- 即使用户在之前的对话中已确认过其他 push 操作，MP 分支的每次 push 仍需单独确认
- 确认时必须展示：目标分支名、commit 信息、变更文件列表

**git add 必须精确到 hunk 级别**：
- 所有代码暂存操作必须使用 `git add -p` 逐 hunk 选择
- 禁止使用以下命令：
  - `git add .`
  - `git add -A`
  - `git add --all`
  - `git add *`
- 目的：避免将无关变更混入提交

**Target version 必须由用户明确指定**：
- Commit Message 中的版本号字段不得由 AI 自行推断
- IF Issue 的 `target_version` 字段有值，THEN 使用该值
- IF Issue 的 `target_version` 字段为空，THEN 询问用户指定
- 禁止从分支名（如 `os10_mp`）推断版本号

---

## 第二层：Hook 拦截

v3 起 hook 定义遵循 Kiro 官方 schema——每个 hook 是一个独立的 JSON 文件（`hooks/*.json`），Kiro 加载后在匹配的事件发生时自动向 AI 发送 prompt，AI 依据 prompt 内容判断是否拦截并给出替代方案。

**注意**：v2 版本的 `hooks/safety-hooks.json`（自定义 schema）实际上没被 Kiro 加载。v3 修复后所有 hook 都会正常生效。原文件归档在 `.learnings/archive/safety-hooks-v2-legacy.json` 供历史参考。

### 拦截规则清单（v3）

| Hook 文件 | 拦截场景 | AI 响应 | 推荐替代 |
|-----------|---------|---------|---------|
| `hooks/block-sudo.json` | 命令包含 `sudo` | 停止执行，说明安全策略禁止未经确认的权限提升 | 使用当前用户权限；如需 sudo 让用户自行在终端跑 |
| `hooks/block-mp-push.json` | `git push` 到 `*_mp` / `*_v3_mp` 保护分支 | 停止执行，展示 commit 信息 + 目标分支，要求二次确认 | 每次 MP push 都必须单独确认，即使已有历史授权 |
| `hooks/block-root-search.json` | `find/grep/rg/ag` 搜索 `/` 或 `~/` | 停止执行，说明性能问题 | `git grep -n "keyword" -- "*.java"` 在 git 仓库根目录跑，~0.4s 完成 |
| `hooks/block-tmp-write.json` | 通过 `>` / `>>` 重定向写入 `/tmp/` | 停止执行，说明 `/tmp` 可能被系统清理 | 使用 `~/tmp` 目录 |
| `hooks/block-out-search.json` | `find/grep/rg/ls -R` 搜索 `out/` 或 `prebuilts/` | 停止执行，说明大目录性能问题 | `git grep` 自动排除；查看编译产物用 `find out/ -name '*.apk'` 精确路径 |
| `hooks/block-git-add-all.json` | `git add .` / `-A` / `--all` / `*` | 停止执行，说明可能混入无关变更 | `git add -p` 逐 hunk 选择 |
| `hooks/block-bulk-copy-out.json` | `rsync` / `cp -r` 批量复制 `out/` / `prebuilts/` | 停止执行，说明大目录复制耗时耗盘 | 只 copy `out/target/product/<name>/*.img` 等具体产物 |

### Hook 与 Steering 的对应关系

三层防护体系里，**同一条约束会同时出现在 steering 规则（本文件）和 hook 中**，二者互补：

- **Steering 规则**（第一层）：AI 在生成命令前自主判断，主动避免违规操作
- **Hook 拦截**（第二层）：AI 已经决定执行命令时，Kiro 触发 hook，AI 依据 prompt 二次确认

Hook 使用 `askAgent` 类型让 AI 判断，比 regex 硬拦更灵活（能识别用户明确授权的场景、能给具体的替代方案）。

---

## 第三层：人工确认

以下场景必须暂停工作流，向用户展示待确认的操作内容，等待用户输入明确的确认指令后才继续执行。

| 场景 | 确认内容 | 触发条件 |
|------|---------|---------|
| 方案选择 | 展示多个可行方案及各自优缺点，等待用户选择 | 当存在多个可行方案需要选择时 |
| git push | 展示 commit 信息、目标分支、变更文件列表 | 执行任何 git push 操作前 |
| 跨代码库操作 | 展示目标仓库范围和操作计划 | 跨代码库操作前需用户指定目标仓库范围 |
| 代码修改确认 | 展示 `git diff` 完整变更内容 | 代码修改完成后展示 diff 等待确认 |

### 确认流程规范

**方案选择确认**：
- 当分析出多个可行方案时，以编号列表展示各方案
- 每个方案包含：方案描述、优点、缺点、推荐理由（如有）
- 等待用户选择具体方案编号后才继续

**git push 确认**：
- 展示格式：
```
即将推送:
- Commit Message: [完整 commit message]
- 目标分支: [分支名]
- 变更文件: [文件列表]
```
- 等待用户明确确认后才执行 push

**跨代码库操作确认**：
- 展示当前工作目录和目标代码库路径
- 说明将要执行的操作范围
- 等待用户确认目标仓库范围正确

**代码修改确认**：
- 执行 `git diff` 展示完整变更
- 等待用户确认变更内容正确后才进入暂存步骤

---

## 拦截信息格式

当 Hook 拦截触发时，向用户显示以下格式的信息：

```
⚠️ 操作被拦截

被拦截的命令: [具体命令]
拦截原因: [原因说明]
推荐替代: [安全的替代操作]
```

### 示例

```
⚠️ 操作被拦截

被拦截的命令: sudo apt-get install build-essential
拦截原因: 安全策略禁止执行 sudo 命令，避免权限提升风险
推荐替代: 请使用当前用户权限执行操作，或由用户自行在终端中执行此命令
```

```
⚠️ 操作被拦截

被拦截的命令: find / -name "*.java" -exec grep "TvScanConfig" {} \;
拦截原因: 禁止在根目录（/）执行大范围搜索，避免性能问题
推荐替代: 请指定具体的源码子目录进行搜索，如: git grep -n "TvScanConfig" -- "*.java"
```

```
⚠️ 操作被拦截

被拦截的命令: grep -r "ScanManager" out/target/
拦截原因: out/ 目录体积巨大（50GB+），搜索会导致严重性能问题
推荐替代: 请使用 git grep 搜索源码: git grep -n "ScanManager" -- "*.java"
```

---

## 错误恢复

- IF AI 误判规则导致操作被不当拒绝，THEN 用户可明确指示 AI 执行该操作
- IF Hook 拦截了用户确实需要执行的命令，THEN 向用户说明拦截原因，由用户自行在终端中执行
- IF 人工确认超时或用户未响应，THEN 保持暂停状态，不自动继续或取消

---

## Steering 改动准则

> 借鉴 Karpathy [autoresearch](https://github.com/karpathy/autoresearch) `program.md` 的 simplicity criterion 写法。Steering files 是 AI 行为契约，无序的累加会让契约腐化。每次改 steering 前对照下表自查。

### 五条简洁性判断

| 改动形态 | 决策 | 理由 |
|---|---|---|
| 一段措辞改动让 AI 行为更可预测，且步骤数不增加 | ✅ **保留** | 纯净收益，零成本 |
| 一段措辞改动让 AI 行为更可预测，但增加了 ≥ 20 行解释 | ⚠️ **通常不保留** | 信息密度下降的代价大于行为可预测性收益；除非新行为是真实出过事故的反模式 |
| 一段措辞**删除**后 AI 行为没变化 | ✅ **一定要删** | 沉默无效行 = AI 噪音；和 autoresearch 的"删 code 等价改进就是真改进"同构 |
| 步骤数 +1，但减少了一个真实存在的错误模式（true positive 拦截） | ✅ **保留** | 用一行规则换掉一类反复犯的错，杠杆比 ≥ 10x |
| 步骤数 +1，只是为了凑"完整性"（"听上去更专业"/"为了对称"/"补全 X 类场景"但该场景从未出现过） | ❌ **不保留** | 等价于 darwin-skill 反例黑名单第 3 条"为凑分增冗余"；让 steering 变重却不解决任何真实问题 |

### 改 steering 的正向问题清单

任何 steering 改动提案，先对自己回答以下 4 个问题：

1. **要修复什么真实事故？** 给出 issue / 错误记录 / Developer 反馈的具体引用。如果回答是"想得更全面"或"考虑到将来可能"——驳回。
2. **改动后是否减少了 AI 的可选行为分支？** 减少 = 好（行为更确定）；增加 = 一般要重新审视。
3. **能否用"删一段已有内容"达到同样效果？** 能删的优先删，不能时再考虑加。
4. **改动是否破坏现有 Property 契约？**（如 commit-message 的 Property 15-20 / Branch_Detector 的 sentinel `ASK_DEVELOPER`）破坏 → 必须先更新对应 spec/PBT，再改 steering。

### 黑名单（不要做的 steering 改动）

- ❌ 把"必须 / 不得 / 禁止"等硬约束改成"建议 / 可以考虑 / 灵活把握"——这等于把契约改成意愿，AI 在边界 case 会跑偏
- ❌ 引入新的 sentinel / 占位符（如 `<UNKNOWN>` / `<TBD>` / `MAYBE_X`），让流程"不阻塞"——大多数情况下真正解法是让 AI 显式询问 Developer
- ❌ 在 Steering 里嵌入临时的、和某次具体 Issue 强绑定的指令（如"对 Issue #334001 的处理方式是 X"）——临时上下文应该走对话，不该污染 steering
- ❌ 在 Steering 里嵌入和某个 runtime 强绑定的指令（如"在 Claude Code 中..."）——本项目的 steering 应该 Kiro-runtime-neutral
- ❌ 一次 commit 里改多个 Steering file 而无统一上下文——每个 steering 改动应该对应一个 spec 或一个错误记录条目


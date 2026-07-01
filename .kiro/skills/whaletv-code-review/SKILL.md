---
name: whaletv-code-review
description: |
  Gerrit-AI / reviewer 评论的三态处理工作流（ACCEPT / REJECT / ACK）。TRIGGERS: "处理评论" / "看看 Gerrit-AI 说了什么" / "回复 gerrit-ai" / "评论处理" / push 之后收到评论时. 严格三态判定：ACCEPT（改代码 → git add -p → push 新 patch set → 回复含 file+line+diff）/ REJECT（不改 + 回复含 evidence）/ ACK（保留 unresolved + 建 follow-up Issue）。CRITICAL 评论强制人审，用 unresolved=false 假闭环是禁止的。Use this skill after any Gerrit push to handle comments. Do NOT use it for pushing code itself (use whaletv-gerrit or whaletv-pr-cr).
---

# Code Review Comment Handling — Gerrit-AI / Reviewer 评论处理工作流

## 触发场景

- Gerrit push 完成、收到 Gerrit-AI 或人工 reviewer 的评论后
- 用户说"处理评论"、"看看 Gerrit-AI 说了什么"
- 在 `pr-cr-workflow.md` 第 ⑧ 步、`gerrit-workflow.md` 第 ③ 步进入

## 设计原则（必读）

> **MCP 工具是"嘴"，AI 是"脑和手"。** Resolved 一个 thread 不等于解决了底层问题。
> 真正的 review 闭环要求：评估 → 改代码 → push 新 patch set → 回复说"具体改在哪里" → resolved。
> 仅靠 `submit_review_reply(unresolved=false)` 把 unresolved 计数归零是**假闭环**。

## 章节索引

- ① 输入与前置条件
- ② 单条评估算法（三态判定）
- ③ 严重程度梯度（CRITICAL → LOW）
- ④ 用户审阅决策（🔴 CHECKPOINT）
- ⑤ 实际修复执行
- ⑥ 推送新 patch set
- ⑦ 回复 + resolved（含模板）
- ⑧ 端到端 6 阶段流程图
- ⑨ Don't 黑名单（团队踩坑）
- ⑩ 异常与边界

---

## ① 输入与前置条件

| 输入 | 来源 | 必需 |
|------|------|------|
| `change_id` | 当前 PR/CR 工作流上下文 | ✅ |
| 当前代码状态 | 本地源码 + git status | ✅ |
| Zmind Issue 上下文 | 当前会话已关联的 Issue | ✅ |

**前置条件检查**：

| 条件 | 不满足时 |
|------|----------|
| 本地工作区干净（无未暂存改动）或仅有当前 PR 相关改动 | 提示 Developer 先 stash / commit |
| 当前 patch set 已 push 到 Gerrit | 提示 Developer 先 push |
| `gerrit-mcp-server` 可用 | 报告并终止 |

---

## ② 单条评估算法（三态判定）

对**每条** unresolved thread 独立执行下列流程，输出**封闭三态**之一：`ACCEPT` / `REJECT` / `ACK`。

### 步骤 2.1：拉取数据

```
get_unresolved_threads({ change_id, author_id_filter: 1000192 })
```

返回每个 thread 的 `{ root_uuid, file, line, root_message, root_author_id, chain }`。

### 步骤 2.2：读现场代码

对每个 thread 的 `(file, line)`：

```
IF file === "/PATCHSET_LEVEL"  →  跳过（patchset-level 评论无具体行号；
                                    评估时直接基于 commit message + 整体 diff）
ELSE                           →  读取 file 中 max(1, line-10) 到 line+10 的上下文（共 21 行）
```

读现场代码的工具优先级：
1. `read_file(path, start_line, end_line)`（如果 file 在当前 workspace）
2. `git show HEAD:<file>`（如果 file 在 git 但不在 workspace）
3. **跳过**（如果 file 是新增的；评估纯靠 diff）

### 步骤 2.3：三态判定

输出**严格落在以下三个值之一**：

| 三态值 | 含义 | unresolved 是否回复时设为 false | 是否实做代码修改 |
|--------|------|------------------------------|----------------|
| `ACCEPT` | 评论合理且本 PR 应实做 | ✅ false（resolved） | ✅ **必须改** |
| `REJECT` | 评论不适用，附详细理由 | ✅ false（resolved） | ❌ 不改 |
| `ACK` | 评论合理但本 PR 不修，建 follow-up | ❌ **保留 unresolved=true** | ❌ 不改（建 Zmind follow-up） |

**判定规则**：

```
IF gerrit-ai 建议的修复方案
   AND 当前代码确实有该问题
   AND 修复在本 PR 范围内（diff 涉及该文件 / 相关模块）
   AND 修复风险可控（不破坏其他逻辑）
THEN  ACCEPT

ELSE IF gerrit-ai 建议
        与当前代码事实矛盾（如说"添加 null check" 但代码已有）
        OR 与协议/spec 强制设计冲突（如 buffer size 是协议固定值）
        OR 风格上与团队约定不符（如说"用 unsigned" 但 codebase 全用 signed）
THEN  REJECT

ELSE IF 评论合理但
        本 PR 范围外（不该牵连）
        OR 风险太大需独立 PR 验证
        OR 缺少上下文无法判断（如 build issue 仅在 CI 才能复现）
THEN  ACK
```

### 步骤 2.4：理由必须落地

每条评估必须输出**两段文字**：

```typescript
{
  verdict: "ACCEPT" | "REJECT" | "ACK",
  reason: string,        // 为什么这么判（≤ 200 字符）
  fix_plan?: string,     // 仅 ACCEPT：具体怎么改（≤ 300 字符）
                         //   - 哪个文件 + 哪一行
                         //   - 改成什么
                         //   - 为什么这样改而不是 gerrit-ai 提议的字面方式
  rejection_evidence?: string,  // 仅 REJECT：反驳证据（引用代码 / spec / commit / 团队规范）
  followup_issue?: string,      // 仅 ACK：建议的 Zmind Issue 标题或 ID
}
```

**禁止**模糊判定：
- ❌ "看起来是对的" → 必须给 reason
- ❌ "暂时不改" → 必须明确 ACK 还是 REJECT；ACK 必须建 follow-up

---

## ③ 严重程度梯度

gerrit-ai 评论文本通常以 `[CRITICAL]` / `[HIGH]` / `[MEDIUM]` / `[LOW]` 起首。AI 根据严重等级**调整自主权**：

| 严重等级 | AI 自主决定权 | 用户介入要求 |
|---------|--------------|------------|
| **CRITICAL** | 仅可**提议**评估，**不可**自主 ACCEPT/REJECT | 强制 Developer 逐条审阅；Developer 显式指令后才进入修复 |
| **HIGH** | 可提议 ACCEPT/REJECT/ACK | Developer 二次确认每条 |
| **MEDIUM** | 可自主评估，结论交 Developer 复核 | Developer 看汇总表后批量确认 |
| **LOW** | 可批量提议同类处理（如"全部 ACK 标 follow-up"） | Developer 看汇总后一次性确认 |

**严重等级提取规则**：

```typescript
function extractSeverity(message: string): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" {
  const m = message.match(/^\s*\[(CRITICAL|HIGH|MEDIUM|LOW)\]/i);
  return m ? (m[1].toUpperCase() as any) : "UNKNOWN";
}
```

`UNKNOWN`（人类 reviewer 评论或非标格式）按 **HIGH** 处理（保守）。

---

## ④ 用户审阅决策

> 🔴 **CHECKPOINT — 强制 STOP**：完成步骤 ②③ 后必须暂停展示评估结果，**等待 Developer 显式确认**。

### 展示模板

```
📋 收到 Change <change_id> 的 5 条 unresolved 评论评估结果：

| # | 严重 | 文件:行号 | 评论摘要 | AI 评估 | AI 建议 action |
|---|------|----------|---------|---------|---------------|
| 1 | CRITICAL | /PATCHSET_LEVEL | buffer 边界检查 | ACCEPT | 在 STREAM_TO_UINT16_S 前加 length 校验 |
| 2 | HIGH | /PATCHSET_LEVEL | snprintf 大小验证 | REJECT | 协议固定 96 字节，p_buf sizeof=256 已足够 |
| 3 | MEDIUM | /PATCHSET_LEVEL | int → unsigned int 风险 | ACK | 同意但本 PR 不动；建 Zmind follow-up |
| 4 | HIGH | /PATCHSET_LEVEL | strncpy null-terminator | ACCEPT | 替换为 strlcpy（OS 已可用） |
| 5 | LOW | hci_h5_snoop.h:25 | 重复 include | ACCEPT | 删除冗余 include |

📊 汇总：3 ACCEPT / 1 REJECT / 1 ACK
🛑 请逐条确认；可调整任意一条的 action。

回复格式：
- "全部确认" / "ok" / "y" → 按 AI 建议执行
- "调整 #3 改为 ACCEPT" → 单条修订
- "全部 ACK" / "全部 REJECT" → 批量覆盖
- "暂停" / "no" → 终止流程
```

### 接受词集合

复用 commit-message-workflow.md 章节 ⑦ 的确认词集合：

```
{ "confirm", "yes", "y", "ok", "全部确认", "确认", "继续" }
```

非确认词或调整指令 → 按调整指令更新评估表 → **重新展示** → 再次等待。

### 失败状态约束

| 状态 | 行为 |
|------|------|
| 含 CRITICAL 评论但 Developer 未逐条确认 | 拒绝进入步骤 ⑤ |
| Developer 未给出确认词 | 保持暂停，不自动继续 |
| 任一 ACCEPT 缺 fix_plan | 拒绝进入步骤 ⑤；返回步骤 ② 补全 |

---

## ⑤ 实际修复执行（仅 ACCEPT）

对每条 verdict=ACCEPT 的 thread：

### 步骤 5.1：定位与读取

```
read_file(path=fix_plan.file, start_line=fix_plan.line - 5, end_line=fix_plan.line + 5)
```

### 步骤 5.2：编辑

使用 `str_replace`（hunk 级精确替换）或 `fs_write`（小文件整体重写）。

**禁止**：
- ❌ 不读现场代码就改（盲改）
- ❌ 一次改多个文件（应单条单条改，便于回滚）

### 步骤 5.3：单条 diff 确认（🔴 CHECKPOINT）

每改一条（不是改完所有再统一展示）后展示 `git diff <file>` 给 Developer：

```
🔧 已应用 fix #1（评论 root_uuid=62ac7945_2fef4820）：

修改文件: hci_h5_snoop.h
diff:
  - #include <cutils/sockets.h>  // line 25 删除冗余
  +

是否继续下一条？(y / 修订 / 撤销)
```

### 步骤 5.4：精确暂存

```
git add -p  # hunk 级；禁止 git add . 或 git add -A
```

### 步骤 5.5：循环到下一条 ACCEPT

回到步骤 5.1，处理下一条。**绝不批处理**。

### 修复完成后

完成所有 ACCEPT 的修复后，进入步骤 ⑥。

---

## ⑥ 推送新 patch set

### 选项 A（默认）：amend 到当前 commit

```
git commit --amend --no-edit
push_to_gerrit({ cwd, target_branch })
```

适用：本次 review 修复都是同一个 patch set 的小改动，不破坏 commit 语义。

### 选项 B：开新 commit

```
git commit -m "<新 commit message>"   # 复用 commit-message-workflow.md 生成
push_to_gerrit({ cwd, target_branch })
```

适用：修复涉及独立逻辑、changeset 较大、想保留 review 历史。

### 选择默认

**优先 A**（amend）—— Gerrit 默认 push 同一 Change-Id 的 amend 结果会自动开新 patch set，保留 review 链路。Developer 显式指示时改用 B。

### 推送后约束

- ✅ 必须等 push 成功（拿到 Change URL）才进入步骤 ⑦
- ❌ 不要在 push 失败时跳过到 ⑦ 假装回复（那样真的是欺骗 reviewer）

---

## ⑦ 回复 + resolved

仅当步骤 ⑥ push 成功后，**单次** `submit_review_reply` 提交所有回复。

### Reply 模板

#### ACCEPT 模板

```
ACCEPT: <fix_plan.summary>

修改文件: <file>
修改行: <line>
具体修改: <diff hunk 摘要>
新 patch set: <patch_set_number>
```

**示例**：
```
ACCEPT: 在 STREAM_TO_UINT16_S 前加 length 校验

修改文件: hci_h5_btsnoop.c
修改行: 47-50
具体修改:
  + if (recv_buffer_len >= 2) {
      STREAM_TO_UINT16_S(opcode, recv_buffer);
  +} else {
  +   ALOGE("[btsnoop] recv_buffer too short");
  +}
新 patch set: 2
```

#### REJECT 模板

```
REJECT: <reason summary>

证据/上下文:
- <code reference / spec / convention>

如有疑议请回复，否则视为接受我方说明。
```

**示例**：
```
REJECT: snprintf 96 字节是协议固定设计，p_buf 容量充足

证据/上下文:
- vnd_userial.c:142 sizeof(p_buf) = 256
- RTKBT spec §3.2 明确 host stack 单条消息 ≤ 96 字节
- 加大 buffer 反而违反协议层契约

如有疑议请回复，否则视为接受我方说明。
```

#### ACK 模板

```
ACK: <为什么本 PR 不修>

跟踪 follow-up: <Zmind#xxx 或建议创建的 Issue 标题>

⚠️ 本评论保持 UNRESOLVED 以便 follow-up 跟踪
```

**示例**：
```
ACK: 同意 unsigned int 改回 int 的潜在风险，但本 PR 范围限于 BT 修复，不动 type 系统

跟踪 follow-up: Zmind#338xxx — 建议创建：[refactor][whaletv]统一 RTKBT length 类型为 int

⚠️ 本评论保持 UNRESOLVED 以便 follow-up 跟踪
```

### 单次原子提交

```typescript
submit_review_reply({
  change_id,
  cover_message: "本轮 review 处理：3 ACCEPT / 1 REJECT / 1 ACK，详见各 inline 回复。新 patch set 已 push。",
  notify: "OWNER_REVIEWERS",
  inline_replies: threadEvaluations.map((e) => ({
    file: e.thread.file,
    line: e.thread.file === "/PATCHSET_LEVEL" ? undefined : e.thread.line,
    in_reply_to: e.thread.root_uuid,
    message: renderTemplate(e.verdict, e),
    unresolved: e.verdict === "ACK",  // ★ 仅 ACK 保留 unresolved
  })),
});
```

### 验证回复闭环

```
get_unresolved_threads({ change_id })
```

期望：unresolved_thread_count 等于 ACK 评论数（0 if 全 ACCEPT/REJECT）。

---

## ⑧ 端到端 6 阶段流程图

```
拉取 unresolved threads
   │  get_unresolved_threads({ change_id, author_id_filter: 1000192 })
   ▼
单条评估（三态：ACCEPT/REJECT/ACK）
   │  逐条读现场代码 + 严重程度梯度判定
   ▼
🔴 CHECKPOINT: 用户审阅决策
   │  展示评估表 → 等待确认词
   ▼
实际修复（仅 ACCEPT）
   │  逐条 read_file → str_replace → 单条 diff 确认 → git add -p
   ▼
推送新 patch set
   │  amend 或 新 commit → push_to_gerrit
   ▼
回复 + resolved
   │  submit_review_reply（含 in_reply_to + ACCEPT/REJECT/ACK 模板）
   │  ACK 保留 unresolved；ACCEPT/REJECT resolved
   ▼
✅ 验证：get_unresolved_threads → unresolved_thread_count === ACK_count
```

---

## ⑨ Don't 黑名单（团队踩坑）

> 该清单是真实踩过的坑的逆向编码。**每次进入评论处理前必须自检**。

| # | 反模式 | 真实后果 | 正确做法 |
|---|--------|---------|---------|
| 1 | **不评估直接全 ACCEPT** | 5 条全 resolved 但代码没改；下个 patch set gerrit-ai 重新打分还是同样问题；Developer 误以为已修复 | 必须经过步骤 ②③ 三态评估 + Developer 确认 |
| 2 | **不评估直接全 REJECT** | 把 gerrit-ai 当噪音过滤器；漏掉真 bug；reviewer 看到一堆"不采纳"会失去信任 | 每条必须给 reason；CRITICAL 必须人审 |
| 3 | **采纳后只回复不改代码**（仅靠 unresolved=false 闭环） | 假闭环；提测后真的有 bug | 必须先改代码 + push 新 patch set，再回复 |
| 4 | **改代码后忘记 push 新 patch set** | 旧 patch set 上的"已采纳"是空头支票；同事 cherry-pick 时拿的是旧代码 | 步骤 ⑥ 是强制；push 失败时**绝不**进入步骤 ⑦ |
| 5 | **不区分严重程度一刀切** | CRITICAL（如 buffer overflow）误判 REJECT 漏掉真 bug；LOW（如格式）逐条人审浪费时间 | 严格按章节 ③ 梯度处理 |
| 6 | **回复只说"已采纳"不说"具体怎么改"** | reviewer 必须重看 diff 才知道改了什么 | ACCEPT 模板必含 file + line + diff hunk 摘要 |
| 7 | **REJECT 只说"不采纳"不给证据** | reviewer 以为 AI 偷懒；信任崩塌 | REJECT 模板必含 evidence（code ref / spec / convention） |
| 8 | **ACK 当 RESOLVED 处理**（unresolved=false） | follow-up 永远不会被跟踪；隐性风险沉淀 | ACK 必须 unresolved=true，且建 Zmind Issue |
| 9 | **批改多个 ACCEPT 后才统一展示 diff** | Developer 难以逐条审；出错时回滚成本高 | 步骤 5.3 单条 diff 确认（🔴 CHECKPOINT） |
| 10 | **多次独立 submit_review_reply**（每条评论一次） | 5 次 SSH 调用 + 5 次 OWNER 通知；评论流被刷屏 | 步骤 ⑦ 单次原子提交所有回复 |
| 11 | **不读现场代码盲改** | 改错位置；引入新 bug | 步骤 5.1 必须 read_file 读上下文 |
| 12 | **CRITICAL 评论自主 ACCEPT/REJECT** | 误判后果严重 | 章节 ③ 强制 Developer 逐条审阅 |

---

## ⑩ 异常与边界

| 场景 | 处理 |
|------|------|
| `get_unresolved_threads` 返回 0 条 | 报告"无未解决评论"，正常结束 |
| Gerrit-AI 评论格式不含 `[CRITICAL]/[HIGH]/...` 前缀 | severity 视为 UNKNOWN，按 HIGH 处理（保守） |
| 评论引用的 file 不在 workspace | 用 `git show HEAD:<file>` 读取；仍读不到则跳过现场代码、纯靠评论文本评估 |
| 评论引用的 line 超出文件实际行数 | 提示 Developer 检查；评论可能基于旧 patch set | 
| ACCEPT 修改与 staging 区原有改动冲突 | 暂停，提示 Developer 决定先暂存还是先 stash |
| push 新 patch set 失败 | **不进入** 步骤 ⑦；按 push_to_gerrit 错误恢复处理 |
| `submit_review_reply` 失败 | 重试 1 次；仍失败时记录所有未提交回复到 `.learnings/ERRORS.md`，提示 Developer 手动 |
| Developer 中途取消 | 已修复的代码保留在 staging（不丢）；告知 Developer 当前状态可恢复 |

---

## 关键约束

| 约束 | 说明 |
|------|------|
| 三态封闭 | ACCEPT / REJECT / ACK，无第四种 |
| ACK 不 resolve | 唯一会保留 unresolved=true 的态 |
| CRITICAL 强制人审 | AI 不可自主 ACCEPT/REJECT |
| 单条 diff 确认 | 步骤 5.3 是 🔴 CHECKPOINT |
| 修复前 push | 步骤 ⑥ 是 ⑦ 的前置；push 失败不进入回复 |
| 单次提交回复 | 步骤 ⑦ 用 submit_review_reply 一次提交；不可逐条 reply_inline_comment |
| ACCEPT 回复模板含 file + line + diff hunk 摘要 | 让 reviewer 一目了然 |
| REJECT 回复模板含 evidence | 拒绝必须有理有据 |
| ACK 回复模板含 follow-up Issue | 不让风险沉淀 |
| `git add -p` | 步骤 5.4 必须 hunk 级；禁止 git add . / -A |

## 进化集成

- **错误记录**：所有评估失败、push 失败、reply 失败记录到 `.learnings/ERRORS.md`
- **经验沉淀**：成功的 ACCEPT/REJECT 案例（含 evidence）记录到 `.learnings/LEARNINGS.md`（分类 `code_review_pattern`）
- **能力缺口**：IF AI 多次无法判定某类评论，THEN 记录到 `.learnings/FEATURE_REQUESTS.md`
- **流程优化**：IF Developer 频繁覆盖 AI 的 ACCEPT/REJECT 决定，THEN 调整 §② 判定规则

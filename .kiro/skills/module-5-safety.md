---
inclusion: manual
---

# Skill: 模块 5 - 安全机制

## 适用范围

创建 `hooks/safety-hooks.json` 安全拦截配置文件。

## Hook 文件格式

```json
{
  "hooks": [
    {
      "id": "hook-id",
      "name": "中文名称",
      "eventType": "preToolUse",
      "toolTypes": "shell",
      "pattern": "正则表达式",
      "action": "block",
      "reason": "中文拦截原因",
      "alternative": "中文推荐替代操作"
    }
  ]
}
```

## 拦截规则清单

必须包含以下 4 条规则：

| ID | 匹配模式 | 原因 | 替代 |
|----|---------|------|------|
| `block-sudo` | `^sudo\\s` | 禁止 sudo 命令，避免权限提升风险 | 使用当前用户权限操作 |
| `block-root-search` | `(find\|grep)\\s+(/\|~/)` | 禁止在根目录或家目录执行大范围搜索 | 指定具体的源码子目录进行搜索 |
| `block-tmp-write` | `>\\s*/tmp/\|>>/tmp/` | 禁止写入 /tmp 路径，避免临时文件丢失 | 使用 ~/tmp 目录替代 /tmp |
| `block-out-search` | `(find\|grep\|ls\\s+-R)\\s+.*(out/\|prebuilts/)` | out/ 和 prebuilts/ 目录体积巨大，搜索会导致性能问题 | 使用 git grep 搜索源码，或指定具体的 src 子目录 |

## 正则表达式规范

- JSON 中的反斜杠需要双重转义：`\\s` 表示 `\s`
- 使用 `|` 分隔多个匹配模式
- 使用 `^` 匹配命令开头
- 使用 `.*` 匹配任意中间内容

## 与 Steering 的关系

- `safety-rules.md` 中引用此文件定义的规则
- Hook 是第二层防护（自动阻断）
- Steering 中的规则约束是第一层（AI 自律）
- 人工确认是第三层（显式授权）

## 拦截信息格式

当 Hook 触发时，显示格式：
```
⚠️ 操作被拦截

被拦截的命令: [具体命令]
拦截原因: [reason 字段内容]
推荐替代: [alternative 字段内容]
```

## 关键约束

- 所有 eventType 必须为 "preToolUse"
- 所有 toolTypes 必须为 "shell"
- 所有 action 必须为 "block"
- reason 和 alternative 使用中文
- pattern 必须是有效的正则表达式

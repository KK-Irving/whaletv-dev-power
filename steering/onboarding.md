---
inclusion: auto
---

# 首次配置引导流程

## 触发场景

用户首次激活 Power（点击 "Try Power"）或输入"配置"、"setup"、"初始化"等关键词时。

## 目的

一次性引导用户完成所有外部系统的配置和验证，确保后续使用时所有功能即开即用，不会中途要求补充配置。

## 引导流程

### ① Zmind 连接验证

**AI 动作**: 调用 `list_projects` 验证 Zmind 连接是否正常。

- IF 成功 → 显示 "✅ Zmind 连接正常"，进入步骤 ②
- IF 失败（ZMIND_API_KEY 未配置）→ 引导用户配置：
  ```
  ❌ Zmind 未连接
  
  请在 mcp.json 中配置 ZMIND_API_KEY：
  1. 登录 https://zmind.whaletv.com
  2. 右上角"我的账户" → 左侧"API 访问密钥" → 显示/重置密钥
  3. 将密钥填入 ~/.kiro/settings/mcp.json 的 env.ZMIND_API_KEY 字段
  
  配置完成后请告诉我，我会重新验证。
  ```

---

### ② 获取项目列表 → 引导匹配代码路径

**AI 动作**: 调用 `list_projects` 获取用户可见的所有项目，展示列表并请用户提供映射。

**展示格式**:
```
✅ Zmind 连接正常

你在 Zmind 上可见的项目：
1. [cultraview-dvb-amlogic-t950d4-2k-1g] CultraView DVB Amlogic T950D4 2K 1G
2. [stm-amlogic-t962d4-4k-1-5gb] STM Amlogic T962D4 4K 1.5GB
3. ...

请告诉我你常用的项目对应的本地代码路径，格式如：
- cultraview-dvb-amlogic-t950d4-2k-1g → ~/cvte_code/amlogic/
- stm-amlogic-t962d4-4k-1-5gb → ~/cvte_code/stm/

（可以只配常用的，后续随时补充）
```

**等待用户提供映射后记录**，然后进入步骤 ③。

---

### ③ Gerrit 连接验证

**AI 动作**: 提示用户确认 Gerrit 配置状态。

**展示格式**:
```
接下来验证 Gerrit 连接。

Gerrit 地址: https://whale-gerrit.zeasn.com/
认证方式: .gitcookies 或 ~/.netrc

请确认以下几点：
1. 你能正常访问 https://whale-gerrit.zeasn.com/ 吗？（是/否）
2. gerritpush 命令是否可用？（在终端执行 `which gerritpush` 确认）
3. 你的默认 Reviewer 列表是？（可选，后续推送时会用到）
```

- IF 用户确认可用 → 显示 "✅ Gerrit 配置正常"
- IF 用户说不可用 → 提供配置指引：
  ```
  Gerrit 认证配置方法：
  
  方式一：.gitcookies（推荐）
  1. 登录 https://whale-gerrit.zeasn.com/
  2. Settings → HTTP Credentials → Generate Password
  3. 将生成的 cookie 行添加到 ~/.gitcookies
  
  方式二：~/.netrc
  machine whale-gerrit.zeasn.com
  login 你的用户名
  password 你的HTTP密码
  ```

---

### ④ 内部文档连接验证

**AI 动作**: 提示用户确认内部文档系统的访问状态。

**展示格式**:
```
最后验证内部文档系统。

文档地址: https://docs.whaletv.com/

请确认：你能正常访问 https://docs.whaletv.com/ 吗？（是/否）
```

- IF 用户确认可用 → 显示 "✅ 内部文档可访问"
- IF 用户说不可用 → 标注 "⚠️ 内部文档暂不可用，后续分析问题时将跳过文档查询步骤"

---

### ⑤ 配置总结

**AI 动作**: 汇总所有配置状态，展示最终结果。

**展示格式**:
```
🎉 配置完成！

系统连接状态：
✅ Zmind — 已连接（API Key 有效）
✅ Gerrit — 已配置（gerritpush 可用）
✅ 内部文档 — 可访问
⏸️ OpenGrok — 暂停（待开放后启用）

项目-代码映射：
• cultraview-dvb-amlogic-t950d4-2k-1g → ~/cvte_code/amlogic/
• stm-amlogic-t962d4-4k-1-5gb → ~/cvte_code/stm/

你现在可以：
• "帮我处理 PR #12345" — 全链路 PR/CR 处理
• "分析下 #334001" — Bug 自动分析
• "把 #332669 cp 到 mp" — Cherry-Pick 同步
• "查看我的待办" — 获取 Issue 列表
```

---

## 关键约束

- 引导流程必须**一次性完成所有配置**，不允许跳过步骤
- 每个步骤验证失败时，必须提供明确的修复指引
- 用户修复后可以说"已配置"或"重试"，AI 重新验证该步骤
- 项目-代码映射可以只配常用的，但必须至少配一个
- 配置总结必须展示所有系统的最终状态
- 如果某个系统暂时不可用（如文档系统），标注状态但不阻塞后续使用

## 后续补充配置

用户随时可以说"补充配置"或"添加项目映射"来更新配置：
- 添加新的项目-代码映射
- 更新 Reviewer 列表
- 启用 OpenGrok（当服务开放后）

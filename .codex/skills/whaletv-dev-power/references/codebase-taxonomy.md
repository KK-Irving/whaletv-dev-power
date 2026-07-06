---
inclusion: auto
last_updated: 2026-07-01
---

# Codebase 架构分类速查（Codebase Taxonomy）

## 目的与定位

WhaleTV 有 3 个主要平台（D4 / X5 / STB），虽然都基于 amlogic AOSP，但**业务代码位置 / 客户定制机制 / ODM 命名 / kernel 版本**各不相同。AI 拿到问题时先查这张表确定平台特性，再用 `steering/module-path-map.md` 找具体路径。

**分工**：
- **本文件（codebase-taxonomy）**：架构层分类 + 搜索策略决策（**决定用哪种搜索模式**）
- **module-path-map.md**：模块级路径地图（**决定搜到哪个具体路径前缀**）
- **local-code-guide skill**：整体 5 档搜索优先级

参考 [`agentengineeringframework/project/system/knowledge/codebase_diff_map.md`](../示例/agentengineeringframework/project/system/knowledge/codebase_diff_map.md) 的 Category A/B 分类思想，但适配 WhaleTV 三平台的实际结构。

## 三平台分类矩阵

| 维度 | **D4** | **X5** | **STB** |
|---|---|---|---|
| OpenGrok 项目 | `d4_code` | `x5_code` | `stb16_code` |
| Wrapper 目录 | `amlogic/` | `amlogic/` | `amlogic/` |
| **业务代码根** | `vendor/zeasn/` | `vendor/whale/` | `vendor/whale/` |
| Framework Hook 位置 | AOSP 内直改 + `vendor/zeasn/common/frameworks/` | AOSP 内直改 + `vendor/whale/common/frameworks/` | AOSP 内直改 + `vendor/whale/common/frameworks/` |
| 客户定制机制 | `vendor/zeasn/{ctv,cvte,hikeen,stm,topt}/` 独立子目录 | `vendor/whale/customer/` 统一入口 | **无 customer 子项**，走 git branch 或独立 project 分离 |
| ODM 系列命名 | `calla*` / `at30*` 系列 | `anemone` / `br30*` / `bs30*` / `calla_wv4` / `dahlia` 等 | `pascal` / `qurra` / `raman` / `ramancas` / `reference` / `ross` |
| 顶层 `vendor/customer/` | 有（11 个 am30/at30） | 有（6 个 br30/bs30） | **无** |
| 顶层 `common/` | 无 | 有（含 kernel 5.15 + 板级 project） | 有 |
| SDK / kernel 版本 | 参见 X5 差异说明 | 5.15 内核 | 5.15 内核 |
| 客户预装应用 | `vendor/zeasn/customer_apps/` + `vendor/zeasn/public_apps/` | `vendor/whale/whale_apps/` + `public_apps/` | 同 X5 |

## 架构模式识别

**共性**：三平台都遵循 **"Hook 架构"** —— WhaleTV 的业务定制主要放在 `vendor/{zeasn,whale}/` 内，AOSP 主体尽量保持干净。但注意：

- **不是完全的 Hook 架构**：AOSP `frameworks/base/` 等仍有少量业务定制（不像 AEF Category A 项目那么彻底解耦）
- 需要业务定制的地方，**优先改 `vendor/{zeasn,whale}/`**；AOSP 内已有改动的地方，仍在原处改（保持一致）

**差异**：**业务代码根路径的命名**是三平台最本质的差异（D4 沿用旧命名 `zeasn/`，X5/STB 迁到新命名 `whale/`）：

```
D4:     amlogic/vendor/zeasn/  ← 老命名，历史遗留
X5/STB: amlogic/vendor/whale/  ← 新命名，v2 起标准
```

**AI 强制约束**：处理某个平台的 issue 时，遇到用户描述的路径写作对应命名。X5/STB 项目里出现 `vendor/zeasn/` 通常是**用户笔误**或**跨平台混淆**，应先确认平台再搜。

## 搜索策略决策树

```
拿到 issue
    ↓
【1】确定平台
    - 从 issue.project 字段读（Zmind project identifier）
    - 或从当前 workspace 路径推断（如 ~/os10_whale/amlogic → 需进一步确认）
    - 或问用户
    ↓
【2】按平台选择业务代码根
    - D4  → 业务在 vendor/zeasn/
    - X5  → 业务在 vendor/whale/
    - STB → 业务在 vendor/whale/
    ↓
【3】按问题关键词类型选路径
    - Framework 类（如 AMS/WMS/PMS）→ frameworks/base/services/core/
    - Hook 业务类（如 Whale 定制）  → vendor/{zeasn,whale}/common/frameworks/
    - TV 应用（Settings/Live TV）  → packages/apps/TvSettings/、packages/apps/TV/
    - Amlogic HAL / 驱动           → hardware/amlogic/、vendor/amlogic/common/
    - 具体客户定制                 → 按平台跳到客户目录（见上表"客户定制机制"行）
    ↓
【4】用 module-path-map.md 具体路径前缀限定 git grep
    git grep -n "Keyword" -- "<path-prefix>/**"
```

## 客户定制机制细节

### D4：每客户独立子目录

```
vendor/zeasn/
├── ctv/       # CTV 客户
├── cvte/      # CVTE 客户
├── hikeen/    # Hikeen 客户
├── stm/       # STM 客户
└── topt/      # TopT 客户
```

改某客户业务 → 直接改对应子目录，不影响其他客户。

### X5：统一 customer/ + 分产品线

```
vendor/whale/customer/
└── <customer-specific>
vendor/customer/
├── br30af / br30af_h1 / br30az / bs30a5 / bs30a5x / bs30ad
```

跨客户的公共改动 → `vendor/whale/common/`；单客户 → `vendor/whale/customer/` 或 `vendor/customer/{br30,bs30}*/`

### STB：无 customer 子目录

STB 客户定制不走目录隔离，而是走 **git branch 隔离** 或 **独立 git project**（`.repo/manifest.xml` 中每个客户配不同的 project set）。改某客户业务通常需要：

1. `repo forall` 找出该客户 project
2. 切到对应 branch
3. 在 `vendor/whale/` 或客户专属 project 内改

## Patch / Cherry-Pick 策略差异

三平台的 CP（Cherry-Pick）差异：

| 场景 | D4 | X5 | STB |
|---|---|---|---|
| 主线 → MP 分支 | 用 gerrit-mcp `cherry_pick_change` | 同 | 同 |
| 跨客户同一修复 | `vendor/zeasn/<客户>/` 各改一次（**不共享**）| `vendor/whale/customer/` 集中 + 少量分支适配 | 每个客户 branch 独立 CP |
| Framework 层修复 | 一处改动 → 全平台 CP | 同 | 同 |
| Hook 层业务修复 | `vendor/zeasn/common/` 改 → CP 到各客户分支 | `vendor/whale/common/` 改 → 各分支 CP | 同 X5 |

**关键约束**：跨平台同一 issue 处理时，**必须在 3 个平台的 git repo 各改一次**（哪怕逻辑完全相同）—— 三平台 git 仓库不共享。

## 未命中场景与升级

**处理某平台时如果 module-path-map 没有相关关键词**：

1. 记录到 `.learnings/LEARNINGS.md`（分类 `knowledge_gap`），标注平台 + 关键词 + 最终定位路径
2. 用 `git grep` 全仓搜索兜底
3. 找到路径后，回头补到 `module-path-map.md` 对应平台小节
4. 若发现三平台**目录结构差异比表格描述的更大** → 更新本文件（codebase-taxonomy）

## 与 skill / MCP 工具的联动

## PID Build Chain & Smart Partition System

WhaleOS PID (Product ID) system controls per-model hardware configuration.
X5 introduces the Smart Partition concept (vs D4 monolithic firmware).

### Three-Package Architecture (X5 only)

| Package | Content | Mount | PID Switch | Use |
|---------|---------|-------|------------|-----|
| Basic (Basic Image/basicimg.zip) | SDK + all PID configs | /vendor/etc/whalepid/ | Yes | Dev/Debug |
| Smart (Smart Image/smartimg.zip) | Single PID config | /smart/etc/whalepid/ | No (locked) | Fast config update |
| Full (Full Image/fullimg.zip) | Basic + Smart | /smart/etc/whalepid/ | No (locked) | Production EMMC |

### D4 vs X5 Difference

D4: All PID configs in one firmware, switches freely even in production.
X5: Splits firmware from config. Smart partition enables config-only updates (no SDK rebuild).
Benefits: faster production iterations, reduced risk (only config changes), separate OTA paths.

### Build Pipeline

PID Repo: cogit/pid/customer_{name}/{chipType}/ (T950X5 or T963X5)

Basic Image Build: Jenkins with customerID, ChipType, Dolby, debugType -> base.sh packs all PID configs
Smart Image Build: Jenkins with customerID, PID name -> base_pid.sh copies single PID to smart.img
Full Image Build: Combines Basic + Smart (4 modes: latest/specified/fresh combinations)

### Smart Partition Key Files

Build-time: base_pid.sh (smartPidCopy), base.sh (smartBuildImage) at script/compile/
Runtime: /smart/etc/whalepid/ mounted via smart partition (Smart/Full)
Dev: /vendor/etc/whalepid/ for Basic Image with all PIDs

### droidaudio.ini 5-Step Fallback

The DroidAudio resolver (whale_audio_ini_resolver.cpp) follows a 5-step fallback:

1. Read ro.boot.pid property (default 1)
2. Load /smart/etc/whalepid/model/pid{ro.boot.pid}.cfg, read AUDIO_INI_ID field
3. Try /smart/etc/whalepid/tvconfig/audio/{AUDIO_INI_ID}/droidaudio.ini (PID-customized)
4. Try /vendor/etc/whalepid/tvconfig/audio/{AUDIO_INI_ID}/droidaudio.ini (vendor fallback)
5. Load /vendor/etc/audio_config/droidaudio.ini (Amlogic default)

Critical: AQ_ID (AMLOGIC_SOC.ini) and AUDIO_INI_ID (DroidAudio) are different fields.
If AUDIO_INI_ID is empty, steps 3-4 are skipped, falls to Amlogic default.

### PID Key Source Files
- whale_audio_ini_resolver.cpp: vendor/amlogic/common/interfaces/droidaudio/default/
- DroidAudioManagerSetting.cpp: hardware/amlogic/audio framework
- base_pid.sh: script/compile/base_pid.sh (smartPidCopy function)
- base.sh: script/compile/base.sh (smartBuildImage function)


| skill / 工具 | 与本文件的关系 |
|---|---|
| `whaletv-local-code` | 5 档搜索策略的第 ① 档就是查本文件 + module-path-map |
| `whaletv-bug-analysis` | 步骤 ⑤ 本地代码定位前必读本表 |
| `whaletv-pr-cr` | 步骤 ③ 定位代码时用于确认平台 + 业务代码根 |
| `whaletv-cherry-pick` | CP 策略章节直接引用本表 |
| `knowledge-mcp-server.analyze_issue` | 自动读取 issue.project → 平台推断 → 按平台过滤 search_local 结果 |
| `search_aosp`（MCP） | `platform` 参数枚举 D4 / X5 / STB 直接对应本表 |

## 与 AEF codebase_diff_map.md 的对照

AEF 项目分 Category A（Hook 架构，3 个 codebase）和 Category B（非 Hook，8 个）。WhaleTV 的情况**不完全对应**：

- **不是按"是否 Hook 架构"分类**（WhaleTV 三平台都是 Hook 架构 + 少量 AOSP 直改）
- **是按平台（芯片方案 / SDK 版本 / 产品线）分类**
- 类似 AEF 的分类思想，但落地方式不同

如果未来 WhaleTV 引入完全 Hook 化的新平台（不改 AOSP），可以在本表增加"架构代际"维度（v1: partial-hook / v2: full-hook）。**目前不需要**。

## 待补充（TODO for team）

以下信息若团队 verified 后可以补进：

- [ ] 每平台的 kernel 版本详细清单（当前只知道 X5/STB 是 5.15）
- [ ] 每平台的 AOSP 主版本（10 / 11 / 12 / 13 / 14）
- [ ] 每平台的 preload 应用清单（whale_apps 里的具体项 + 是否有跨平台差异）
- [ ] 三平台 gerrit-hooks（如 commit-msg 脚本）的差异
- [ ] 跨平台 CP 的工具化（是否有脚本一键把 change 应用到三平台？）

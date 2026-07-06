---
name: whaletv-dev-power
description: >
  WhaleTV Android TV developer workflow assistant. Use when working on WhaleTV AOSP-based
  TV projects (D4/X5/STB platforms), handling Zmind issues, Gerrit code reviews,
  cherry-picks between branches, bug analysis on Android TV, writing commit messages
  in WhaleTV format, searching AOSP source code with 5-tier priority, or navigating
  WhaleTV platform-specific code in vendor/zeasn/ or vendor/whale/. Triggers on:
  WhaleTV, D4, X5, STB, AOSP TV, Gerrit, Zmind, cherry-pick CP, vendor/zeasn,
  vendor/whale, TvSettings, Amlogic TV, commit message format, PR/CR, bug analysis.
---

# WhaleTV Developer Power

AI-powered developer workflow assistant for WhaleTV AOSP-based TV projects on D4, X5, STB platforms.

## Platform Taxonomy

| Platform | Business Root | Customer Root |
|----------|--------------|---------------|
| D4 | vendor/zeasn/ | vendor/zeasn/customer/ |
| X5 | vendor/whale/ | vendor/whale/customer/ |
| STB | vendor/whale/ | vendor/whale/customer/ |

D4 uses vendor/zeasn/ (old naming). X5/STB use vendor/whale/ (v2+ standard).
See references/module-path-map.md for 90+ module paths.

## Code Search Priority (5-Tier)

1. Codebase Taxonomy -- Determine platform
2. Module Path Map -- Match keywords to paths (zero cost)
3. Search local knowledge -- Historical PRs/commits/docs
4. git grep -- Path-prefix limited, full-repo ~0.4s fallback
5. Known paths -- Read specific files
6. Remote search -- Last resort

## Critical Rules (MUST NOT)

### Safety
- No sudo -- Use current user permissions
- No root/home search -- Switch to subdirectory first
- No /tmp writes -- Use ~/tmp/ or .workspace/
- No out/ or prebuilts/ search -- 50GB+/30GB+ build artifacts
- No out/ or prebuilts/ bulk copy -- Copy only specific artifacts

### Git
- No git add . / -A / --all / * -- Always git add -p
- No push to MP branches (*_mp) -- Require explicit approval
- No git commit --amend -m -- Edit in editor, preserve Change-Id
- No local cherry-pick then push -- Use Gerrit REST API

### Workflow
- No guessing target_version -- From Zmind issue or ask user
- BringUp exception -- Use BringUp format when explicitly stated
- No write-probe Zmind -- Read with get_issue first
- No writes outside workspace

## GATE Scenarios

Pause until user confirmation (confirm/yes/y/ok):
- Plan choice with multiple approaches
- Pre-push (diff, commits, branch)
- Cross-repo changes
- MP branch push
- Gerrit CRITICAL review comments

## Commit Message Format

Normal:
[<version>][<type>][whaletv][Zmind#<id>]<summary> [m/n]
[what]...
[why]...
[how]...
[test]...
[impact]...

BringUp:
[BringUp][whaletv][Zmind#<id>]<summary> [m/n]
[same segments]

<type>: bugfix | feature | refactor | perf | docs

## Gerrit Review: Three-State

ACCEPT -> Fix code, push new patch, reply
REJECT -> Reply with explanation
ACK -> Reply with acknowledgment

## Cherry-Pick Workflow

search_changes -> list_branches -> GATE confirm -> cherry_pick_change -> report -> update Zmind

## Bug Analysis

get_issue -> determine platform -> extract keywords -> module path map -> git grep -> analyze -> classify

## Pre-Commit Checklist

- Code compiles
- No debug code
- Change scope precise
- Commit message 5-segment
- Change-Id line preserved

## Resources

## Zmind Reply Workflow

When replying to Zmind issues:
- Read latest journal first before replying to avoid duplicate responses
- Encode Chinese properly: Use Python with ensure_ascii=False + UTF-8 Content-Type
- Never use PowerShell ConvertTo-Json which breaks Chinese characters
- Check full journal history to understand conversation context

## PID & Smart Partition System

WhaleOS X5 introduces the Smart Partition (Smart) concept, splitting firmware into SDK (Basic) and config (Smart).
This is a key architectural difference from D4 where all PID configs are baked into one firmware.

### Three-Package Architecture (X5)

| Package | Mount | PID Switching | Use Case |
|---------|-------|---------------|----------|
| Basic (Basic Image) | /vendor/etc/whalepid/ | Allowed | Dev/debug with all PIDs |
| Smart (Smart Image) | /smart/etc/whalepid/ | Locked | Single PID config, fast update |
| Full = Basic + Smart | /smart/etc/whalepid/ | Locked | Production (EMMC) |

### PID Build Pipeline

cogit/pid/customer_{name}/{chipType}/ (T950X5 or T963X5)

Basic: base.sh (smartBuildImage) packs all PID configs into /vendor/etc/whalepid/
Smart: base_pid.sh (smartPidCopy) copies single PID to /smart/etc/whalepid/ smart.img
Full: Combines existing Basic + Smart into fullimg.zip / emmcbin.zip

### 5-Step droidaudio.ini Fallback (whale_audio_ini_resolver.cpp)

1. ro.boot.pid property (default 1 for Basic, fixed for Smart/Full)
2. /smart/etc/whalepid/model/pid{ro.boot.pid}.cfg read AUDIO_INI_ID (NOT AQ_ID)
3. /smart/etc/whalepid/tvconfig/audio/{AUDIO_INI_ID}/droidaudio.ini
4. /vendor/etc/whalepid/tvconfig/audio/{AUDIO_INI_ID}/droidaudio.ini (Basic fallback)
5. /vendor/etc/audio_config/droidaudio.ini (Amlogic default)

Critical: AQ_ID and AUDIO_INI_ID are DIFFERENT fields. If AUDIO_INI_ID empty, skip steps 3-4.

### PID Switching (Basic only)

1. PIDMenu: Settings -> DeviceInfo -> Up/Down/Right/Left/Down/Options -> enter PID
2. USB: projectID.ini on USB root with target PID
3. Remote blind: 062598 + Menu + 4-digit PID code

### Smart Upgrade Methods

1. USB: whale_usb_burn_smart.ini + whale_smart_package.img on root, cold boot
2. uboot: usb_updatesmart smart.img
3. After upgrade: erases param + userdata, LED blinks, cold reboot required
See references/pid-build-chain.md for complete reference including D4 vs X5 comparison.

## Network Drive Search

When workspace is on network drive (W:):
- Do NOT use Get-ChildItem -Recurse or git grep on large repos (timeout)
- Use: cmd /c dir /b /ad for directory listing
- Use: git --git-dir ls-tree -r --name-only HEAD for small repos
- Prioritize module-path-map known paths + OpenGrok remote search
See references/network-search-guide.md for full details.


- references/module-path-map.md -- 90+ module paths
- references/codebase-taxonomy.md -- Platform architecture
- references/critical-rules.md -- Full MUST NOT rules

# Issue 339649 Lessons Learned
## 1. Redmine Encoding
Issue: PowerShell ConvertTo-Json breaks Chinese chars
Fix: Use Python with ensure_ascii=False + utf-8 Content-Type
## 2. PID Config Chain
5-step fallback for droidaudio.ini:
- Step 2: pid1.cfg -> AUDIO_INI_ID (NOT AQ_ID)
- Step 3-4: smart/vendor path with {AUDIO_INI_ID}
- Step 5: fallback to /vendor/etc/audio_config/droidaudio.ini
Key: AQ_ID and AUDIO_INI_ID are different fields, both required
## 3. Network Drive Search
Issue: Get-ChildItem -Recurse and git grep timeout on network drives
Workaround: Use cmd /c "dir /b /ad <path>" for directories
Use: git --git-dir ls-tree -r --name-only HEAD for small repos
## 4. Key Source Files Found
- whale_audio_ini_resolver.cpp: vendor/amlogic/common/interfaces/droidaudio/default/
- DroidAudioManagerSetting.cpp: hardware/amlogic/audio framework
- base_pid.sh: script/compile/base_pid.sh (smartPidCopy function)
- build_image: base.sh (smartBuildImage function)


## Issue 339649 Follow-up (2026-07-07)

### 5. Git Identity Mismatch
Issue: Windows git global config was personal account, commit author was KK-Irving instead of winn.wei@zeasn.com.
Fix: Check git config user.name/email before committing. Match to current environment (company vs personal).
Prevention: Add identity check to Pre-Commit Checklist as first item.

### 6. File Ownership Detection in Multi-Repo AOSP
Issue: CustomerRootWindowContainerPolicy.java in vendor/whale/customer/ was excluded by .gitignore as a separate repo. Took extra time to locate ownership.
Fix: Systematic flow: git ls-files -> git check-ignore -> look for .git in ancestor dirs -> .repo/manifest.xml
Prevention: Added general file ownership detection flow to codebase-taxonomy.md (no hardcoded paths).

### 7. Git Push Positive Workflow Missing
Issue: Current rules only list prohibited operations (no add ., no MP push, no local CP). Missing positive workflow for correct operations.
Fix: Added positive workflow: git push HEAD:refs/for/<target-branch> for normal push, cherry_pick_change for cross-branch.
Prevention: Restructured Git section into Prohibited / Positive Workflow / commit-msg Timeout subsections.

### 8. commit-msg Hook Timeout Fallback
Issue: git commit hook timeouts on slow network. Commit was created but error message suggested failure.
Fix: Post-timeout check: git log -1 (verify commit exists), git log -1 --format=%B (verify Change-Id). If missing: git commit --amend --no-edit.
Prevention: Added timeout handling to SKILL.md Git section and git-troubleshooting.md.

### 9. Git Troubleshooting Needs Systematization
Issue: Git blocking issues (dubious ownership, SSH auth, network) scattered across experience, no systematic lookup.
Fix: Created references/git-troubleshooting.md with error-triggered lookup table covering 9 common scenarios.
Prevention: New issues encountered -> add to git-troubleshooting.md table (not scattered notes).

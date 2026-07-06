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

# WhaleOS PID Build Chain (X5 Complete Reference)

## Core Concepts: 大包 / 小包 / 整包

X5 introduces the Smart Partition (小包) concept, splitting firmware into config (smart.img) and SDK (basic.img).
This is a key architectural difference from D4, where all PID configs are baked into one monolithic firmware.

| Package | Name | Content | PID Switching | Use Case |
|---------|------|---------|---------------|----------|
| 大包 (Basic Image) | basicimg.zip | SDK + all PID configs | Allowed | Dev/Debug/QA |
| 小包 (Smart Image) | smartimg.zip | Single PID config only | Locked to PID | Quick config update |
| 整包 (Full Image) | fullimg.zip / emmcbin.zip | 大包 + 小包 | Locked | Production/Mass production |

## Partition Layout

大包 (dev/debug): PID configs at /vendor/etc/whalepid/ (all PIDs, switchable)
小包/整包 (production): PID configs at /smart/etc/whalepid/ (single PID, locked)

## Build Pipeline

### 大包 Build (Jenkins)
Parameters: customerID, ChipType (T950X5/T963X5), Dolby (DOLBY/NONDOLBY), debugType, doSign, delOut
Output: WhaleOS_{chipType}_{boardType}_{dolbyType}_{debugType}_{version}_{buildtime}_basicimg.zip

### 小包 Build (Jenkins)
Parameters: customerID, PID (e.g. PID1_T950X5_BOARD-V1_DOLBY_DVB)
Output: WhaleOS_{pid_name}_{debugType}_{pid_branch}_{buildtime}_smartimg.zip
Note: 小包 is a single smart.img, burned to /smart partition via USB (whale_smart_package.img) or uboot command (usb_updatesmart smart.img)

### 整包 Build (4 modes)
1. FTP latest 大包 + freshly built 小包
2. FTP specified 大包 + freshly built 小包
3. Freshly built 大包 + freshly built 小包
4. FTP specified 大包 + FTP specified 小包
Output: fullimg.zip + emmcbin.zip (for EMMC production)

## PID Repository Structure (cogit/pid/)

customer_{name}/
  {chipType}/  (T950X5 or T963X5)
    board/       -- Panel/board configs, per board type directory (name no underscores)
    bootvideo/   -- bootanimation.zip, bootvideo.mp4
    channels/    -- Factory channel presets
    customer_channels/ -- User channel presets
    esticker/    -- Electronic sticker images
    hotkey_map/  -- Remote hotkey mapping (hotkey_map.json)
    launcherLogo/ -- Co-branded launcher logos
    logo/        -- Boot logo images (<250KB, <=1920x1080, JPG)
    model/       -- PID config files + model_sum.ini
                   pid*.cfg: PID{N}_{chipType}_{boardType}_{dolbyType}_{standard}_{expanded}.cfg
                   model_sum.ini: Maps PID to panel/AQ/PQ/tvconfig paths
    overlay/dts/ -- DTBO overlay source files (per PID)
    prop/        -- customer.prop (custom properties)
    tvconfig/
      audio/      -- AQ configs per AUDIO_ID (AMLOGIC_SOC.ini, AUDIO_EFFECT.ini, EXT_AMP.ini + 2 xml)
      conf/       -- tvconfig.conf variants
      hdmi/       -- EDID bins per EDID_ID (6 files per port config)
      key_kl/     -- Remote key layout files + kl_map.conf
      mkp/        -- Keypad tab files
      mr/         -- Remote tab files + remote.sum
      panel/      -- Panel parameter JSON
      pq/         -- PQ configs per PQ_ID (overscan.db, pq.bin, pq_default.ini)

## pid.cfg Key Fields

| Field | Description | Example |
|-------|-------------|---------|
| Language | Default language (ISO 639-1 + region) | en-US |
| LanguageList | Supported languages | en-US_ar-EG |
| Country | Default country (ISO 3166-1 alpha-2) | AE |
| CountryList | Supported countries | AE_BH_DZ_IQ |
| PQ_ID | PQ config folder name | PQ_ID_1 |
| AQ_ID | Audio config folder name | AUDIO_ID_1 |
| AUDIO_INI_ID | Audio INI config ID (optional) | audio_custom_1 |
| EDID_ID | EDID config folder name | EDID_ID_1 |
| POWER_MODE | Initial power state | standby/on/last |
| LOGO_NAME | Boot logo filename | whale_logo.jpg |
| PANEL_NAME | Panel config filename | panel.json |
| KEYPAD_NAME | Keypad config filename | kp_whale.tab |
| REMOTE_NAME | Remote config filename | remote_nec_41fb.tab |
| TVCONFIG_NAME | TV config filename | tvconfig_def.conf |
| BOOTVIDEO_NAME | Boot animation/video filename | bootvideo.mp4 |
| CHANNELS_NAME | Factory channel folder name | channels_default |
| HOTKEY_MAP_NAME | Hotkey mapping filename (optional) | hotkey_map.json |
| DTBO_DTS_NAME | DTBO DTS source filename (optional) | board_v1.dts |

## 5-Step droidaudio.ini Fallback

1. ro.boot.pid property (default 1 for 大包, fixed for 整包)
2. /smart/etc/whalepid/model/pid{ro.boot.pid}.cfg -> AUDIO_INI_ID
3. /smart/etc/whalepid/tvconfig/audio/{AUDIO_INI_ID}/droidaudio.ini
4. /vendor/etc/whalepid/tvconfig/audio/{AUDIO_INI_ID}/droidaudio.ini (fallback for 大包)
5. /vendor/etc/audio_config/droidaudio.ini (Amlogic default)

Key: AQ_ID and AUDIO_INI_ID are DIFFERENT fields. If AUDIO_INI_ID empty -> skip 3-4 -> Amlogic default.

## D4 vs X5 PID Comparison

| Feature | D4 | X5 |
|---------|-----|-----|
| Architecture | Single firmware | 大包 + 小包 split |
| PID config location | /vendor/etc/whalepid/ | /smart/etc/whalepid/ (prod), /vendor/etc/whalepid/ (dev) |
| PID switching in production | Allowed (with ResetTV) | NOT allowed (整包 locks PID) |
| Config update without SDK rebuild | Not possible | Possible via 小包 replacement |
| OTA config-only update | Not supported | Not supported yet (planned) |
| OTA SDK-only update | Full firmware OTA | 大包 OTA (keeps PID config) |
| Smart partition | None | /smart partition for 小包 |

## Key Source Files

| File | Path | Purpose |
|------|------|---------|
| whale_audio_ini_resolver.cpp | vendor/amlogic/common/interfaces/droidaudio/default/ | DroidAudio fallback logic |
| DroidAudioManagerSetting.cpp | hardware/amlogic/audio framework | Audio settings |
| base_pid.sh | script/compile/base_pid.sh | smartPidCopy (PID resource copy to smart.img) |
| base.sh | script/compile/base.sh | smartBuildImage (smart.img pack) |
| PID repo config | cogit/pid/customer_{name}/{chipType}/model/ | pid.cfg + model_sum.ini |
| tvconfig.conf | tvconfig/conf/ | AML TV config standard |

## PID Switching Methods (大包 only)

1. PIDMenu: Settings -> DeviceInfo -> Up/Down/Right/Left/Down/Options -> enter PID number
2. U盘: projectID.ini on USB root with target PID number
3. Remote blind: 062598 + Menu + 4-digit PID on any screen

After switch: power cycle required, ResetTV recommended.

## 小包 Upgrade Methods

1. U盘: whale_usb_burn_smart.ini + whale_smart_package.img on USB root, cold boot
2. Command (uboot): usb_updatesmart smart.img
3. After upgrade: erases param partition + userdata, LED blinks, requires cold reboot
4. Erase: uboot: amlmmc erase smart_a; amlmmc erase smart_b; amlmmc erase userdata

---
inclusion: auto
---

# 模块路径地图（Module Path Map）

## 用途

在 Android 源码场景下，AI 拿到问题（Bug 分析、PR/CR、Cherry-Pick）时，**先查这张地图缩小搜索范围**，再用 `git grep` / OpenGrok `search_code` 限定路径搜索，避免大范围 grep 命中大量噪音。

地图按 **OpenGrok 项目（平台）→ AOSP 一级目录 → 业务子模块** 三层组织。同平台不同 ODM 的目录差异基本可忽略，按平台维护一份即可覆盖。

## 使用方式

### AI 自查流程

收到问题后，按关键词在本地图中匹配：

1. **关键词匹配**：从用户问题/Issue 描述中提取关键词（类名、模块名、功能名，如 "TvScanConfig"、"TvSettings"、"PQ"、"CEC"、"DTVKit"、"Tuner"）
2. **查表定位**：在对应平台的小节中查找路径前缀
3. **限定搜索**：把找到的路径前缀作为搜索约束
   - **本地源码**：`git grep -n "Keyword" -- "<path-prefix>/*.java" "<path-prefix>/*.kt"`
   - **OpenGrok**：调 `search_code` 时把 `path:` 加入查询字符串，或用 `search_path` 先收敛文件
4. **报告标注**：在分析报告中说明使用了 module-path-map 命中，并列出命中的路径前缀

### IF 关键词没命中地图

降级到 local-code-guide 的标准搜索策略（git grep → OpenGrok `search_symbol`），并把这次未命中记录到 `.learnings/LEARNINGS.md`（分类 `knowledge_gap`），后续补到地图。

## 跨平台共性约定

所有 OpenGrok 平台都有一个一级 wrapper 目录（D4 是 `amlogic/`，X5 / STB 等可能是其他厂商名）。地图中 **路径前缀均省略 OpenGrok 的项目根**（`/d4_code/`），从 wrapper 目录开始写。

调用 OpenGrok 时拼接规则：
```
完整路径 = /<project>/<map 中的路径前缀>
例：/d4_code/amlogic/packages/apps/TvSettings/
```

调用本地 `git grep` 时（在源码根目录执行）：
```
git grep -n "Keyword" -- "<map 中省略 wrapper 后的路径>/**"
例：git grep -n "TvScanConfig" -- "packages/apps/TvSettings/**"
```

---

## D4 平台（OpenGrok 项目: `d4_code`）

> 数据来源：2026-06-02 通过 OpenGrok xref 目录树采样（覆盖 frameworks/base、packages/apps、vendor、hardware、device 5 个根，深度 2，共 631 目录）

### frameworks/ — Android Framework

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| frameworks 根 | `amlogic/frameworks/` | 所有 framework 子模块的根 |
| Framework Base | `amlogic/frameworks/base/` | Android Framework 核心 |

#### frameworks/base/ 二级展开

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Core API（Java 层） | `amlogic/frameworks/base/core/java/` | Activity / Service / View / Context 等核心 API |
| Core JNI | `amlogic/frameworks/base/core/jni/` | Core 层 native 桥接 |
| Core Resources | `amlogic/frameworks/base/core/res/` | Framework 资源（含 strings、drawables、themes） |
| System Services | `amlogic/frameworks/base/services/core/` | AMS / WMS / PMS 等系统服务 |
| Accessibility Service | `amlogic/frameworks/base/services/accessibility/` | 无障碍服务 |
| AutoFill Service | `amlogic/frameworks/base/services/autofill/` | 自动填充 |
| Backup Service | `amlogic/frameworks/base/services/backup/` | 系统备份 |
| Device Policy | `amlogic/frameworks/base/services/devicepolicy/` | DevicePolicyManager |
| USB Service | `amlogic/frameworks/base/services/usb/` | USB 服务 |
| Wifi Service | `amlogic/frameworks/base/services/wifi/` | Wi-Fi 服务（framework 层） |
| WindowManager | `amlogic/frameworks/base/packages/WindowManager/` | 窗口管理（packages 层包装） |
| SystemUI | `amlogic/frameworks/base/packages/SystemUI/` | 系统 UI（状态栏、通知、导航栏） |
| Keyguard | `amlogic/frameworks/base/packages/Keyguard/` | 锁屏 |
| Settings Provider | `amlogic/frameworks/base/packages/SettingsProvider/` | 系统设置数据存储 |
| Settings Lib | `amlogic/frameworks/base/packages/SettingsLib/` | Settings 公共库 |
| Shell | `amlogic/frameworks/base/packages/Shell/` | adb shell 内置应用 |
| DocumentsUI | `amlogic/frameworks/base/packages/DocumentsUI/` | 系统文件选择器 |
| PackageInstaller | `amlogic/frameworks/base/packages/PackageInstaller/` | APK 安装器 |
| Tethering | `amlogic/frameworks/base/packages/Tethering/` | 网络共享 |
| Media | `amlogic/frameworks/base/media/java/` | 媒体框架 Java 层 |
| Media JNI | `amlogic/frameworks/base/media/jni/` | 媒体框架 native 桥 |
| Graphics | `amlogic/frameworks/base/graphics/java/` | 图形 API |
| Telephony | `amlogic/frameworks/base/telephony/java/` | 电话相关 framework |
| Telecomm | `amlogic/frameworks/base/telecomm/java/` | 电话通讯 |
| Wifi Lib | `amlogic/frameworks/base/wifi/java/` | Wi-Fi framework lib |
| Location | `amlogic/frameworks/base/location/java/` | 位置服务 |
| DRM | `amlogic/frameworks/base/drm/java/` | DRM framework |
| Keystore | `amlogic/frameworks/base/keystore/java/` | 密钥存储 |
| AAPT2 工具 | `amlogic/frameworks/base/tools/aapt2/` | AAPT2 资源打包工具 |

### packages/apps/ — 系统应用

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| **TvSettings**（TV 系统设置） | `amlogic/packages/apps/TvSettings/Settings/` | TV 设置主应用（最高优先级关注模块） |
| TvSettings API | `amlogic/packages/apps/TvSettings/SettingsAPI/` | TV 设置对外 API |
| TvSettings 双面板库 | `amlogic/packages/apps/TvSettings/TwoPanelSettingsLib/` | TV 设置 UI 库 |
| **TV 应用**（直播 TV） | `amlogic/packages/apps/TV/` | TV 主应用（含 tuner 子模块） |
| TV Tuner | `amlogic/packages/apps/TV/tuner/` | TV 调谐器 |
| Settings（手机/通用） | `amlogic/packages/apps/Settings/` | 通用 Settings 应用 |
| SystemUIGo | `amlogic/packages/apps/SystemUIGo/` | 轻量 SystemUI |
| Launcher3 | `amlogic/packages/apps/Launcher3/` | 默认桌面 |
| Camera2 | `amlogic/packages/apps/Camera2/` | 相机 |
| Gallery2 | `amlogic/packages/apps/Gallery2/` | 图库 |
| Music | `amlogic/packages/apps/Music/` | 音乐播放器 |
| Contacts | `amlogic/packages/apps/Contacts/` | 联系人 |
| Dialer | `amlogic/packages/apps/Dialer/` | 拨号 |
| Messaging | `amlogic/packages/apps/Messaging/` | 短信 |
| DocumentsUI | `amlogic/packages/apps/DocumentsUI/` | 文件管理 |
| ManagedProvisioning | `amlogic/packages/apps/ManagedProvisioning/` | 设备管理 setup |
| KeyChain | `amlogic/packages/apps/KeyChain/` | 证书管理 |
| Nfc | `amlogic/packages/apps/Nfc/` | NFC 应用 |
| SecureElement | `amlogic/packages/apps/SecureElement/` | 安全元件 |
| StorageManager | `amlogic/packages/apps/StorageManager/` | 存储管理 |

### vendor/ — 厂商层

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic 公共代码 | `amlogic/vendor/amlogic/common/` | Amlogic 厂商公共代码（最大头） |
| Amlogic ODM 适配 | `amlogic/vendor/amlogic/{calla,ohm,redi,reference,smith,soddy,t7_an400,t982_ar301}/` | 各 ODM 板级适配（共 8 个 ODM 子目录） |
| Customer 适配 | `amlogic/vendor/customer/{am30ap,am30az,am30b8,am30b9,am30bh,am30bm,at30a8,at30ak,at30aq,at30b3,at30b8}/` | 客户型号定制（11 个型号） |
| Widevine | `amlogic/vendor/widevine/{arm,arm64}/` | Google Widevine DRM 库 |
| WiFi 驱动 | `amlogic/vendor/wifi_driver/{amlogic,realtek}/` | Wi-Fi 驱动包 |
| **Zeasn 公共代码** | `amlogic/vendor/zeasn/common/` | WhaleTV 公共定制代码（重点） |
| Zeasn CTV | `amlogic/vendor/zeasn/ctv/` | CTV 业务代码 |
| Zeasn CVTE | `amlogic/vendor/zeasn/cvte/` | CVTE 客户业务代码 |
| Zeasn Hikeen | `amlogic/vendor/zeasn/hikeen/` | Hikeen 客户业务 |
| Zeasn STM | `amlogic/vendor/zeasn/stm/` | STM 客户业务 |
| Zeasn TopT | `amlogic/vendor/zeasn/topt/` | TopT 客户业务 |
| Zeasn PID | `amlogic/vendor/zeasn/pid/` | 产品 ID 配置 |
| Zeasn 客户应用 | `amlogic/vendor/zeasn/customer_apps/` | 客户预装应用 |
| Zeasn 公共应用 | `amlogic/vendor/zeasn/public_apps/` | 公共预装应用 |

#### vendor/amlogic/common/ 二级展开（业务密集区）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic Apps | `amlogic/vendor/amlogic/common/apps/` | Amlogic 出厂应用 |
| Amlogic Frameworks | `amlogic/vendor/amlogic/common/frameworks/` | Amlogic 扩展 framework |
| Amlogic Interfaces | `amlogic/vendor/amlogic/common/interfaces/` | AIDL/HIDL 接口定义 |
| Amlogic System | `amlogic/vendor/amlogic/common/system/` | 系统层定制 |
| Amlogic Kernel patches | `amlogic/vendor/amlogic/common/kernel/` | Kernel 补丁 |
| Codec2 | `amlogic/vendor/amlogic/common/codec2/` | Codec 2.0 实现 |
| Mediahal SDK | `amlogic/vendor/amlogic/common/mediahal_sdk/` | Media HAL |
| GPU | `amlogic/vendor/amlogic/common/gpu/` | GPU 驱动包 |
| GPU lib | `amlogic/vendor/amlogic/common/gpu-lib/` | GPU 用户态库 |
| NPU | `amlogic/vendor/amlogic/common/npu/` | NPU 驱动 |
| ARM ISP | `amlogic/vendor/amlogic/common/arm_isp/` | ARM 摄像头 ISP |
| HDCP | `amlogic/vendor/amlogic/common/hdcp/` | HDCP 加密 |
| TDK | `amlogic/vendor/amlogic/common/tdk/` | Trustzone Dev Kit（含 v3、linuxdriver 变体） |
| Provision | `amlogic/vendor/amlogic/common/provision/` | 设备 provisioning |
| Netflix Security | `amlogic/vendor/amlogic/common/netflix_security/` | Netflix 安全 |
| GMS | `amlogic/vendor/amlogic/common/gms/` | Google Mobile Services 集成 |
| Wi-Fi/BT | `amlogic/vendor/amlogic/common/wifi_bt/` | Wi-Fi 蓝牙 vendor 层 |
| Whale PID | `amlogic/vendor/amlogic/common/whale_pid/` | 产品 ID（鲸 = WhaleTV） |
| Encoder | `amlogic/vendor/amlogic/common/libencoder/` | 视频编码库 |
| AML NPU 公共 | `amlogic/vendor/amlogic/common/aml_npu_common/` | NPU 公共部分 |
| eFuse | `amlogic/vendor/amlogic/common/efuse/` | 一次性可编程存储 |

### hardware/ — HAL 层

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic HAL（厂商实现） | `amlogic/hardware/amlogic/` | Amlogic 全部 HAL 实现 |
| HIDL/AIDL 接口 | `amlogic/hardware/interfaces/` | Android HAL 接口定义（30+ 子模块） |
| libhardware | `amlogic/hardware/libhardware/` | 老式 HAL 框架 |
| libhardware_legacy | `amlogic/hardware/libhardware_legacy/` | 历史遗留 HAL |
| RIL | `amlogic/hardware/ril/` | Radio Interface Layer |
| Broadcom HAL | `amlogic/hardware/broadcom/` | 博通蓝牙/Wi-Fi HAL |
| Google HAL | `amlogic/hardware/google/` | Google 提供的 HAL（含 camera、av、graphics 等） |
| ST HAL | `amlogic/hardware/st/` | ST NFC / SecureElement |

#### hardware/amlogic/ 二级展开

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Audio HAL | `amlogic/hardware/amlogic/audio/` | 音频 HAL |
| LibAudio | `amlogic/hardware/amlogic/LibAudio/` | 音频公共库 |
| Camera HAL | `amlogic/hardware/amlogic/camera/` | 相机 HAL |
| **HDMI CEC** | `amlogic/hardware/amlogic/hdmi_cec/` | HDMI CEC 控制 |
| HWComposer | `amlogic/hardware/amlogic/hwcomposer/` | 硬件合成器 |
| Gralloc | `amlogic/hardware/amlogic/gralloc/` | 图像内存分配 |
| Media HAL | `amlogic/hardware/amlogic/media/` | 媒体 HAL |
| Media Modules | `amlogic/hardware/amlogic/media_modules/` | Media 内核模块 |
| **Tuner HAL** | `amlogic/hardware/amlogic/tuner/` | TV 调谐器 HAL |
| **TV HAL** | `amlogic/hardware/amlogic/tv/` | TV 综合 HAL |
| **TB Modules** | `amlogic/hardware/amlogic/tb_modules/` | TV Backend modules |
| Wi-Fi HAL | `amlogic/hardware/amlogic/wifi/` | Wi-Fi HAL |
| Thermal HAL | `amlogic/hardware/amlogic/thermal/` | 温控 |
| Power HAL | `amlogic/hardware/amlogic/power/` | 电源管理 |
| Health HAL | `amlogic/hardware/amlogic/health/` | 健康（电池） |
| Lights HAL | `amlogic/hardware/amlogic/lights/` | 灯光 |
| IR HAL | `amlogic/hardware/amlogic/ir/` | 红外遥控 |
| Keymaster | `amlogic/hardware/amlogic/keymaster/` | 密钥管理 |
| Gatekeeper | `amlogic/hardware/amlogic/gatekeeper/` | 凭证守卫 |
| OEM Lock | `amlogic/hardware/amlogic/oemlock/` | OEM 锁 |
| Memtrack | `amlogic/hardware/amlogic/memtrack/` | 内存跟踪 |
| Dumpstate | `amlogic/hardware/amlogic/dumpstate/` | bugreport 收集 |
| Boot Ctrl | `amlogic/hardware/amlogic/boot_ctrl/` | A/B 启动控制 |
| Fastboot | `amlogic/hardware/amlogic/fastboot/` | Fastboot HAL |
| AU CPU FW | `amlogic/hardware/amlogic/aucpu_fw/` | Audio CPU 固件 |
| CVE | `amlogic/hardware/amlogic/cve/` | 视觉处理引擎 |
| Screen Source | `amlogic/hardware/amlogic/screen_source/` | 屏幕捕获 |

### device/ — 设备级

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic 设备配置 | `amlogic/device/amlogic/{calla,common,ohm,redi,smith,soddy,t7_an400,t982_ar301}/` | 各 SoC 板级配置 |
| Customer 设备配置 | `amlogic/device/customer/{am30ap,am30az,at30a8,at30ak,...}/` | 客户型号设备配置 |
| Generic | `amlogic/device/generic/` | AOSP 通用设备 |
| Google 设备 | `amlogic/device/google/{atv,cuttlefish,cuttlefish_prebuilts}/` | Google 参考设备（atv = Android TV） |

### 其他常用一级目录

| 目录 | 路径前缀 | 说明 |
|------|---------|------|
| Kernel | `amlogic/kernel/` | Linux 内核源码 |
| Bootable | `amlogic/bootable/` | bootloader / recovery |
| External | `amlogic/external/` | 第三方库（OpenSSL、SQLite 等） |
| System | `amlogic/system/` | 系统底层组件（init、core、netd 等） |
| Bionic | `amlogic/bionic/` | Android C/C++ 标准库 |
| ART | `amlogic/art/` | Android Runtime |
| CTS | `amlogic/cts/` | Compatibility Test Suite |

---

## X5 平台（OpenGrok 项目: `x5_code`）

> 数据来源：2026-06-02 通过 OpenGrok xref 目录树采样（覆盖 frameworks/base、packages/apps、vendor、hardware、device 5 个根，深度 2，共 632 目录 + 二级深挖 40 目录）
> **与 D4 关键差异**：业务代码在 `vendor/whale/`（不是 `vendor/zeasn/`）；`vendor/amlogic/` 多 `anemone/calla_wv4/dahlia/daisy/dryas/t950s_be311` 等 ODM；`vendor/customer/` 是 br30/bs30 系列；多了 `packages/apps/TvSystemUI`；多了顶级 `common/`（kernel 5.15 + 板级 project）和 `scripts/`

### frameworks/ — Android Framework（X5 SDK 版本与 D4 略有差异）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| frameworks 根 | `amlogic/frameworks/` | 所有 framework 子模块的根 |
| Framework Base | `amlogic/frameworks/base/` | Android Framework 核心 |

#### frameworks/base/ 二级展开（X5 独有项标 ★）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Core API（Java 层） | `amlogic/frameworks/base/core/java/` | Activity / Service / View / Context 等核心 API |
| Core JNI | `amlogic/frameworks/base/core/jni/` | Core 层 native 桥接 |
| Core Resources | `amlogic/frameworks/base/core/res/` | Framework 资源 |
| System Services | `amlogic/frameworks/base/services/core/` | AMS / WMS / PMS 等系统服务 |
| Accessibility Service | `amlogic/frameworks/base/services/accessibility/` | 无障碍服务 |
| AutoFill Service | `amlogic/frameworks/base/services/autofill/` | 自动填充 |
| Backup Service | `amlogic/frameworks/base/services/backup/` | 系统备份 |
| ★ Credentials Service | `amlogic/frameworks/base/services/credentials/` | 凭据管理（X5 独有） |
| ★ Permission Service | `amlogic/frameworks/base/services/permission/` | 权限服务（X5 独有） |
| ★ Flags Service | `amlogic/frameworks/base/services/flags/` | Feature Flags（X5 独有） |
| Device Policy | `amlogic/frameworks/base/services/devicepolicy/` | DevicePolicyManager |
| USB Service | `amlogic/frameworks/base/services/usb/` | USB 服务 |
| Wifi Service | `amlogic/frameworks/base/services/wifi/` | Wi-Fi 服务 |
| WindowManager | `amlogic/frameworks/base/packages/WindowManager/` | 窗口管理 |
| SystemUI | `amlogic/frameworks/base/packages/SystemUI/` | 系统 UI |
| Keyguard | `amlogic/frameworks/base/packages/Keyguard/` | 锁屏 |
| Settings Provider | `amlogic/frameworks/base/packages/SettingsProvider/` | 系统设置数据存储 |
| Settings Lib | `amlogic/frameworks/base/packages/SettingsLib/` | Settings 公共库 |
| ★ CredentialManager | `amlogic/frameworks/base/packages/CredentialManager/` | 凭据管理器（X5 独有） |
| Shell | `amlogic/frameworks/base/packages/Shell/` | adb shell 内置应用 |
| DocumentsUI | `amlogic/frameworks/base/packages/DocumentsUI/` | 系统文件选择器 |
| PackageInstaller | `amlogic/frameworks/base/packages/PackageInstaller/` | APK 安装器 |
| Tethering | `amlogic/frameworks/base/packages/Tethering/` | 网络共享 |
| Media | `amlogic/frameworks/base/media/java/` | 媒体框架 Java 层 |
| Telephony | `amlogic/frameworks/base/telephony/java/` | 电话相关 framework |
| Wifi Lib | `amlogic/frameworks/base/wifi/java/` | Wi-Fi framework lib |

### packages/apps/ — 系统应用（X5）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| **TvSettings** | `amlogic/packages/apps/TvSettings/Settings/` | TV 设置主应用 |
| TvSettings API | `amlogic/packages/apps/TvSettings/SettingsAPI/` | TV 设置对外 API |
| TvSettings 双面板库 | `amlogic/packages/apps/TvSettings/TwoPanelSettingsLib/` | TV 设置 UI 库 |
| ★ TvSettings unbundle | `amlogic/packages/apps/TvSettings/unbundle/` | 解绑变体（X5 独有） |
| ★ **TvSystemUI**（X5 独有） | `amlogic/packages/apps/TvSystemUI/` | TV 系统 UI（替代部分 SystemUI 功能） |
| **TV 应用** | `amlogic/packages/apps/TV/` | TV 主应用 |
| Settings | `amlogic/packages/apps/Settings/` | 通用 Settings 应用 |
| SystemUIGo | `amlogic/packages/apps/SystemUIGo/` | 轻量 SystemUI |
| Launcher3 | `amlogic/packages/apps/Launcher3/` | 默认桌面 |
| Camera2 | `amlogic/packages/apps/Camera2/` | 相机 |
| Gallery2 | `amlogic/packages/apps/Gallery2/` | 图库 |
| Music | `amlogic/packages/apps/Music/` | 音乐播放器 |
| Contacts | `amlogic/packages/apps/Contacts/` | 联系人 |
| Dialer | `amlogic/packages/apps/Dialer/` | 拨号 |
| DocumentsUI | `amlogic/packages/apps/DocumentsUI/` | 文件管理 |
| ManagedProvisioning | `amlogic/packages/apps/ManagedProvisioning/` | 设备管理 setup |

### vendor/ — 厂商层（X5 与 D4 差异显著）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic 公共代码 | `amlogic/vendor/amlogic/common/` | Amlogic 公共代码 |
| Amlogic ODM 适配 | `amlogic/vendor/amlogic/{anemone,calla,calla_wv4,common,dahlia,daisy,dryas,redi,redi_wv4,reference,soddy,t950s_be311}/` | 12 个 ODM/参考板适配（_wv4 = Widevine 4 变体） |
| Customer 适配 | `amlogic/vendor/customer/{br30af,br30af_h1,br30az,bs30a5,bs30a5x,bs30ad}/` | 客户型号定制（X5 是 br30/bs30 系列） |
| Widevine | `amlogic/vendor/widevine/` | Google Widevine DRM 库 |
| ★ **Whale（WhaleTV 业务代码）** | `amlogic/vendor/whale/` | X5 上 WhaleTV 业务代码的根（**注意**：D4 在 `vendor/zeasn/`） |

#### vendor/whale/ 二级展开（X5 业务密集区，对应 D4 的 vendor/zeasn）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Whale 公共代码 | `amlogic/vendor/whale/common/` | WhaleTV 公共定制代码（重点） |
| Whale 客户业务 | `amlogic/vendor/whale/customer/` | 客户业务代码 |
| ODM 应用 | `amlogic/vendor/whale/odm_apps/` | ODM 提供的预装应用 |
| 公共应用 | `amlogic/vendor/whale/public_apps/` | 公共预装应用 |
| Whale 应用 | `amlogic/vendor/whale/whale_apps/` | WhaleTV 自有应用 |
| Whale 配置 | `amlogic/vendor/whale/whale_configs/` | 产品配置（PID 等） |

#### vendor/amlogic/common/ 二级展开（X5）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic Apps | `amlogic/vendor/amlogic/common/apps/` | Amlogic 出厂应用 |
| Amlogic Frameworks | `amlogic/vendor/amlogic/common/frameworks/` | Amlogic 扩展 framework |
| Amlogic Interfaces | `amlogic/vendor/amlogic/common/interfaces/` | AIDL/HIDL 接口定义 |
| Amlogic System | `amlogic/vendor/amlogic/common/system/` | 系统层定制 |
| ★ ASPlayer | `amlogic/vendor/amlogic/common/ASPlayer/` | Amlogic 流媒体播放器（X5 独有） |
| ★ DSP | `amlogic/vendor/amlogic/common/dsp/` | DSP 固件/驱动（X5 独有） |
| ★ Touchscreen | `amlogic/vendor/amlogic/common/touchscreen/` | 触摸屏（X5 独有） |
| ★ Auto Patch | `amlogic/vendor/amlogic/common/auto_patch/` | 自动打补丁工具（X5 独有） |
| ★ Modules Load | `amlogic/vendor/amlogic/common/modules_load/` | 内核模块加载（X5 独有） |
| ★ Attester | `amlogic/vendor/amlogic/common/attester/` | 远程认证（X5 独有，对应 D4 的 attest） |
| ★ ADLA Lib | `amlogic/vendor/amlogic/common/adla_lib/` | ADLA 加速库（X5 独有） |
| Codec2 | `amlogic/vendor/amlogic/common/codec2/` | Codec 2.0 实现 |
| Mediahal SDK | `amlogic/vendor/amlogic/common/mediahal_sdk/` | Media HAL |
| GPU lib | `amlogic/vendor/amlogic/common/gpu-lib/` | GPU 用户态库 |
| NPU | `amlogic/vendor/amlogic/common/npu/` | NPU 驱动 |
| AML NPU 公共 | `amlogic/vendor/amlogic/common/aml_npu_common/` | NPU 公共部分 |
| HDCP | `amlogic/vendor/amlogic/common/hdcp/` | HDCP 加密 |
| TDK | `amlogic/vendor/amlogic/common/tdk/` | Trustzone Dev Kit |
| Provision | `amlogic/vendor/amlogic/common/provision/` | 设备 provisioning |
| GMS | `amlogic/vendor/amlogic/common/gms/` | Google Mobile Services 集成 |
| Wi-Fi/BT | `amlogic/vendor/amlogic/common/wifi_bt/` | Wi-Fi 蓝牙 vendor 层 |
| Encoder | `amlogic/vendor/amlogic/common/libencoder/` | 视频编码库 |
| eFuse | `amlogic/vendor/amlogic/common/efuse/` | 一次性可编程存储 |

### hardware/ — HAL 层（X5）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic HAL（厂商实现） | `amlogic/hardware/amlogic/` | Amlogic 全部 HAL 实现 |
| HIDL/AIDL 接口 | `amlogic/hardware/interfaces/` | Android HAL 接口定义 |
| libhardware | `amlogic/hardware/libhardware/` | 老式 HAL 框架 |
| libhardware_legacy | `amlogic/hardware/libhardware_legacy/` | 历史遗留 HAL |
| RIL | `amlogic/hardware/ril/` | Radio Interface Layer |
| Broadcom HAL | `amlogic/hardware/broadcom/` | 博通 HAL |
| Google HAL | `amlogic/hardware/google/` | Google 提供的 HAL |
| ST HAL | `amlogic/hardware/st/` | ST NFC / SecureElement |

#### hardware/amlogic/ 二级展开（X5，与 D4 大部分相同）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Audio HAL | `amlogic/hardware/amlogic/audio/` | 音频 HAL |
| LibAudio | `amlogic/hardware/amlogic/LibAudio/` | 音频公共库 |
| Camera HAL | `amlogic/hardware/amlogic/camera/` | 相机 HAL |
| HDMI CEC | `amlogic/hardware/amlogic/hdmi_cec/` | HDMI CEC 控制 |
| HWComposer | `amlogic/hardware/amlogic/hwcomposer/` | 硬件合成器 |
| Gralloc | `amlogic/hardware/amlogic/gralloc/` | 图像内存分配 |
| Media HAL | `amlogic/hardware/amlogic/media/` | 媒体 HAL |
| Tuner HAL | `amlogic/hardware/amlogic/tuner/` | TV 调谐器 HAL |
| TV HAL | `amlogic/hardware/amlogic/tv/` | TV 综合 HAL |
| TB Modules | `amlogic/hardware/amlogic/tb_modules/` | TV Backend modules |
| Wi-Fi HAL | `amlogic/hardware/amlogic/wifi/` | Wi-Fi HAL |
| ★ USB HAL | `amlogic/hardware/amlogic/usb/` | USB HAL（X5 独有） |
| Thermal HAL | `amlogic/hardware/amlogic/thermal/` | 温控 |
| Power HAL | `amlogic/hardware/amlogic/power/` | 电源管理 |
| Health HAL | `amlogic/hardware/amlogic/health/` | 健康（电池） |
| Lights HAL | `amlogic/hardware/amlogic/lights/` | 灯光 |
| IR HAL | `amlogic/hardware/amlogic/ir/` | 红外遥控 |
| Keymaster | `amlogic/hardware/amlogic/keymaster/` | 密钥管理 |
| Gatekeeper | `amlogic/hardware/amlogic/gatekeeper/` | 凭证守卫 |
| OEM Lock | `amlogic/hardware/amlogic/oemlock/` | OEM 锁 |
| Memtrack | `amlogic/hardware/amlogic/memtrack/` | 内存跟踪 |
| Dumpstate | `amlogic/hardware/amlogic/dumpstate/` | bugreport 收集 |
| Boot Ctrl | `amlogic/hardware/amlogic/boot_ctrl/` | A/B 启动控制 |
| Fastboot | `amlogic/hardware/amlogic/fastboot/` | Fastboot HAL |
| AU CPU FW | `amlogic/hardware/amlogic/aucpu_fw/` | Audio CPU 固件 |
| CVE | `amlogic/hardware/amlogic/cve/` | 视觉处理引擎 |
| Screen Source | `amlogic/hardware/amlogic/screen_source/` | 屏幕捕获 |

### device/ — 设备级（X5）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic 设备配置 | `amlogic/device/amlogic/{anemone,calla,calla-kernel,calla_wv4,common,dahlia,daisy,dryas,redi,redi_wv4,soddy,t950s_be311}/` | 12 个 SoC/参考板设备配置 |
| Customer 设备配置 | `amlogic/device/customer/{br30af,br30af_h1,br30az,bs30a5,bs30a5x,bs30ad}/` | 客户型号设备配置 |
| Generic | `amlogic/device/generic/` | AOSP 通用设备 |
| Google 设备 | `amlogic/device/google/` | Google 参考设备 |

### X5 独有顶级目录

| 目录 | 路径前缀 | 说明 |
|------|---------|------|
| Common（X5 顶级） | `amlogic/common/` | 顶级公共代码（含 kernel 与 board project） |
| ★ Kernel 5.15 | `amlogic/common/common14-5.15/` | X5 用的 kernel 5.15（D4 是顶级 `kernel/` + `common-5.15/`） |
| ★ 驱动模块 | `amlogic/common/driver_modules/` | 内核驱动模块 |
| ★ Board Project | `amlogic/common/project/` | 板级配置工程 |
| Scripts | `amlogic/scripts/` | 顶级构建脚本 |

### 其他常用一级目录（X5）

| 目录 | 路径前缀 | 说明 |
|------|---------|------|
| Kernel | `amlogic/kernel/` | Linux 内核源码 |
| Bootable | `amlogic/bootable/` | bootloader / recovery |
| External | `amlogic/external/` | 第三方库 |
| System | `amlogic/system/` | 系统底层组件 |
| Bionic | `amlogic/bionic/` | Android C/C++ 标准库 |
| ART | `amlogic/art/` | Android Runtime |

---

## STB 平台（OpenGrok 项目: `stb16_code`）

> 数据来源：2026-06-02 通过 OpenGrok xref 目录树采样（覆盖 frameworks/base、packages/apps、vendor、hardware、device 5 个根，深度 2，共 695 目录 + 二级深挖 48 目录）
>
> **STB 关键特点**：最新 SDK（Android 14/15 + kernel 6.12），相比 D4/X5 多了大量新 framework service 与 system app
>
> **与 D4/X5 关键差异**：
> - 业务代码在 `vendor/whale/`（同 X5），但 X5 的 `vendor/whale/` 有 `customer/odm_apps`，**STB 没有 customer 概念**（STB 客户业务结构不同）
> - **没有 `vendor/customer/` 顶层目录**（D4 有 11 个 am30/at30，X5 有 6 个 br30/bs30，STB 直接没有）
> - ODM 命名独特：`pascal / qurra / raman / ramancas / reference / ross`（D4 是 calla 系列，X5 是 anemone 系列）
> - **Kernel 6.12**（D4/X5 都是 5.15）：`amlogic/common/common16-6.12/`
> - 完整 **Trusty TEE 工程**（D4/X5 都没有顶级 trusty/）
> - `hardware/amlogic/` 多 `mediaquality / thread / usb`（Thread 是 IoT 协议）

### frameworks/ — Android Framework（STB SDK 最新，有大量新 service / package）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| frameworks 根 | `amlogic/frameworks/` | 所有 framework 子模块的根 |
| Framework Base | `amlogic/frameworks/base/` | Android Framework 核心 |

#### frameworks/base/services/ 二级展开（STB 独有项标 ★）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Core Services | `amlogic/frameworks/base/services/core/` | AMS / WMS / PMS 等 |
| Accessibility | `amlogic/frameworks/base/services/accessibility/` | 无障碍服务 |
| AutoFill | `amlogic/frameworks/base/services/autofill/` | 自动填充 |
| Backup | `amlogic/frameworks/base/services/backup/` | 系统备份 |
| Companion | `amlogic/frameworks/base/services/companion/` | 配套设备管理 |
| Credentials | `amlogic/frameworks/base/services/credentials/` | 凭据管理 |
| Permission | `amlogic/frameworks/base/services/permission/` | 权限服务 |
| Flags | `amlogic/frameworks/base/services/flags/` | Feature Flags |
| Print | `amlogic/frameworks/base/services/print/` | 打印 |
| Profcollect | `amlogic/frameworks/base/services/profcollect/` | Profile 收集 |
| Restrictions | `amlogic/frameworks/base/services/restrictions/` | 用户限制 |
| Translation | `amlogic/frameworks/base/services/translation/` | 翻译服务 |
| USB | `amlogic/frameworks/base/services/usb/` | USB 服务 |
| Wifi | `amlogic/frameworks/base/services/wifi/` | Wi-Fi 服务 |
| ★ App Functions | `amlogic/frameworks/base/services/appfunctions/` | App Functions API（STB 独有） |
| ★ Contextual Search | `amlogic/frameworks/base/services/contextualsearch/` | 情境搜索（STB 独有） |
| ★ Foldables | `amlogic/frameworks/base/services/foldables/` | 折叠屏支持（STB 独有） |
| ★ Selection Toolbar | `amlogic/frameworks/base/services/selectiontoolbar/` | 选择工具栏（STB 独有） |
| ★ Serial | `amlogic/frameworks/base/services/serial/` | 串口服务（STB 独有） |
| ★ Supervision | `amlogic/frameworks/base/services/supervision/` | 监管服务（STB 独有） |
| ★ Fakes | `amlogic/frameworks/base/services/fakes/` | 测试 fakes（STB 独有） |

#### frameworks/base/packages/ 二级展开（STB 独有项标 ★）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| WindowManager | `amlogic/frameworks/base/packages/WindowManager/` | 窗口管理 |
| SystemUI | `amlogic/frameworks/base/packages/SystemUI/` | 系统 UI |
| Keyguard | `amlogic/frameworks/base/packages/Keyguard/` | 锁屏 |
| Settings Provider | `amlogic/frameworks/base/packages/SettingsProvider/` | 系统设置数据存储 |
| Settings Lib | `amlogic/frameworks/base/packages/SettingsLib/` | Settings 公共库 |
| CredentialManager | `amlogic/frameworks/base/packages/CredentialManager/` | 凭据管理器 |
| Shell | `amlogic/frameworks/base/packages/Shell/` | adb shell 内置应用 |
| DocumentsUI | `amlogic/frameworks/base/packages/DocumentsUI/` | 系统文件选择器 |
| PackageInstaller | `amlogic/frameworks/base/packages/PackageInstaller/` | APK 安装器 |
| ★ CrashRecovery | `amlogic/frameworks/base/packages/CrashRecovery/` | 崩溃恢复（STB 独有） |
| ★ NeuralNetworks | `amlogic/frameworks/base/packages/NeuralNetworks/` | 神经网络（STB 独有） |
| ★ Vcn | `amlogic/frameworks/base/packages/Vcn/` | Virtual Carrier Network（STB 独有） |
| Media | `amlogic/frameworks/base/media/java/` | 媒体框架 Java 层 |
| Telephony | `amlogic/frameworks/base/telephony/java/` | 电话相关 framework |

### packages/apps/ — 系统应用（STB 应用最多）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| **TvSettings** | `amlogic/packages/apps/TvSettings/Settings/` | TV 设置主应用 |
| TvSettings API | `amlogic/packages/apps/TvSettings/SettingsAPI/` | TV 设置对外 API |
| TvSettings 双面板库 | `amlogic/packages/apps/TvSettings/TwoPanelSettingsLib/` | TV 设置 UI 库 |
| TvSettings unbundle | `amlogic/packages/apps/TvSettings/unbundle/` | 解绑变体 |
| **TvSystemUI** | `amlogic/packages/apps/TvSystemUI/` | TV 系统 UI |
| **TV 应用** | `amlogic/packages/apps/TV/` | TV 主应用 |
| Settings | `amlogic/packages/apps/Settings/` | 通用 Settings 应用 |
| SystemUIGo | `amlogic/packages/apps/SystemUIGo/` | 轻量 SystemUI |
| Launcher3 | `amlogic/packages/apps/Launcher3/` | 默认桌面 |
| Camera2 | `amlogic/packages/apps/Camera2/` | 相机 |
| Gallery2 | `amlogic/packages/apps/Gallery2/` | 图库 |
| Music | `amlogic/packages/apps/Music/` | 音乐播放器 |
| Contacts | `amlogic/packages/apps/Contacts/` | 联系人 |
| DocumentsUI | `amlogic/packages/apps/DocumentsUI/` | 文件管理 |
| ManagedProvisioning | `amlogic/packages/apps/ManagedProvisioning/` | 设备管理 setup |
| Provision | `amlogic/packages/apps/Provision/` | 首次开机配置 |
| ★ AvatarPicker | `amlogic/packages/apps/AvatarPicker/` | 头像选择（STB 独有） |
| ★ DeviceDiagnostics | `amlogic/packages/apps/DeviceDiagnostics/` | 设备诊断（STB 独有） |
| ★ EyeDropper | `amlogic/packages/apps/EyeDropper/` | 取色器（STB 独有） |
| ★ Multiuser | `amlogic/packages/apps/Multiuser/` | 多用户管理（STB 独有） |
| ★ PrivateSpace | `amlogic/packages/apps/PrivateSpace/` | 私密空间（STB 独有） |
| ★ TvFeedbackConsent | `amlogic/packages/apps/TvFeedbackConsent/` | TV 反馈同意（STB 独有） |

### vendor/ — 厂商层（STB）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic 公共代码 | `amlogic/vendor/amlogic/common/` | Amlogic 公共代码 |
| Amlogic ODM 适配 | `amlogic/vendor/amlogic/{pascal,qurra,raman,ramancas,reference,ross}/` | 6 个 ODM/参考板（STB 命名独特） |
| Widevine | `amlogic/vendor/widevine/` | Google Widevine DRM 库 |
| **Whale（WhaleTV 业务代码）** | `amlogic/vendor/whale/` | STB 上 WhaleTV 业务代码 |

> ⚠️ STB 没有 `vendor/customer/` 顶级目录（D4/X5 都有），客户定制走 `vendor/whale/` 内部分支或不同 git project

#### vendor/whale/ 二级展开（STB，比 X5 简单）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Whale 公共代码 | `amlogic/vendor/whale/common/` | WhaleTV 公共定制代码（重点） |
| 公共应用 | `amlogic/vendor/whale/public_apps/` | 公共预装应用 |
| Whale 应用 | `amlogic/vendor/whale/whale_apps/` | WhaleTV 自有应用 |
| Whale 配置 | `amlogic/vendor/whale/whale_configs/` | 产品配置（PID 等） |

#### vendor/amlogic/common/ 二级展开（STB）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic Apps | `amlogic/vendor/amlogic/common/apps/` | Amlogic 出厂应用 |
| Amlogic Frameworks | `amlogic/vendor/amlogic/common/frameworks/` | Amlogic 扩展 framework |
| Amlogic Interfaces | `amlogic/vendor/amlogic/common/interfaces/` | AIDL/HIDL 接口定义 |
| Amlogic System | `amlogic/vendor/amlogic/common/system/` | 系统层定制 |
| ASPlayer | `amlogic/vendor/amlogic/common/ASPlayer/` | Amlogic 流媒体播放器 |
| DSP | `amlogic/vendor/amlogic/common/dsp/` | DSP 固件/驱动 |
| Auto Patch | `amlogic/vendor/amlogic/common/auto_patch/` | 自动打补丁工具 |
| Attester | `amlogic/vendor/amlogic/common/attester/` | 远程认证 |
| ADLA Lib | `amlogic/vendor/amlogic/common/adla_lib/` | ADLA 加速库 |
| ★ IPSP | `amlogic/vendor/amlogic/common/ipsp/` | IP Set-top-box（STB 独有） |
| ★ Sign Tools | `amlogic/vendor/amlogic/common/sign_tools/` | 签名工具（STB 独有） |
| Codec2 | `amlogic/vendor/amlogic/common/codec2/` | Codec 2.0 实现 |
| Mediahal SDK | `amlogic/vendor/amlogic/common/mediahal_sdk/` | Media HAL |
| GPU lib | `amlogic/vendor/amlogic/common/gpu-lib/` | GPU 用户态库 |
| AML NPU 公共 | `amlogic/vendor/amlogic/common/aml_npu_common/` | NPU 公共部分 |
| HDCP | `amlogic/vendor/amlogic/common/hdcp/` | HDCP 加密 |
| TDK | `amlogic/vendor/amlogic/common/tdk/` | Trustzone Dev Kit |
| Provision | `amlogic/vendor/amlogic/common/provision/` | 设备 provisioning |
| GMS | `amlogic/vendor/amlogic/common/gms/` | Google Mobile Services 集成 |
| Wi-Fi/BT | `amlogic/vendor/amlogic/common/wifi_bt/` | Wi-Fi 蓝牙 vendor 层 |
| Encoder | `amlogic/vendor/amlogic/common/libencoder/` | 视频编码库 |
| eFuse | `amlogic/vendor/amlogic/common/efuse/` | 一次性可编程存储 |

### hardware/ — HAL 层（STB）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic HAL（厂商实现） | `amlogic/hardware/amlogic/` | Amlogic 全部 HAL 实现 |
| HIDL/AIDL 接口 | `amlogic/hardware/interfaces/` | Android HAL 接口定义 |
| libhardware | `amlogic/hardware/libhardware/` | 老式 HAL 框架 |
| RIL | `amlogic/hardware/ril/` | Radio Interface Layer |
| Broadcom HAL | `amlogic/hardware/broadcom/` | 博通 HAL |
| Google HAL | `amlogic/hardware/google/` | Google 提供的 HAL |
| ST HAL | `amlogic/hardware/st/` | ST NFC / SecureElement |

#### hardware/amlogic/ 二级展开（STB）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Audio HAL | `amlogic/hardware/amlogic/audio/` | 音频 HAL |
| LibAudio | `amlogic/hardware/amlogic/LibAudio/` | 音频公共库 |
| Camera HAL | `amlogic/hardware/amlogic/camera/` | 相机 HAL |
| HDMI CEC | `amlogic/hardware/amlogic/hdmi_cec/` | HDMI CEC 控制 |
| HWComposer | `amlogic/hardware/amlogic/hwcomposer/` | 硬件合成器 |
| Gralloc | `amlogic/hardware/amlogic/gralloc/` | 图像内存分配 |
| Media HAL | `amlogic/hardware/amlogic/media/` | 媒体 HAL |
| Tuner HAL | `amlogic/hardware/amlogic/tuner/` | TV 调谐器 HAL |
| TV HAL | `amlogic/hardware/amlogic/tv/` | TV 综合 HAL |
| TB Modules | `amlogic/hardware/amlogic/tb_modules/` | TV Backend modules |
| Wi-Fi HAL | `amlogic/hardware/amlogic/wifi/` | Wi-Fi HAL |
| USB HAL | `amlogic/hardware/amlogic/usb/` | USB HAL |
| ★ MediaQuality HAL | `amlogic/hardware/amlogic/mediaquality/` | 媒体画质 HAL（STB 独有） |
| ★ Thread HAL | `amlogic/hardware/amlogic/thread/` | Thread / IoT 1.5 协议 HAL（STB 独有） |
| Thermal HAL | `amlogic/hardware/amlogic/thermal/` | 温控 |
| Power HAL | `amlogic/hardware/amlogic/power/` | 电源管理 |
| Health HAL | `amlogic/hardware/amlogic/health/` | 健康（电池） |
| Lights HAL | `amlogic/hardware/amlogic/lights/` | 灯光 |
| IR HAL | `amlogic/hardware/amlogic/ir/` | 红外遥控 |
| Keymaster | `amlogic/hardware/amlogic/keymaster/` | 密钥管理 |
| Gatekeeper | `amlogic/hardware/amlogic/gatekeeper/` | 凭证守卫 |
| OEM Lock | `amlogic/hardware/amlogic/oemlock/` | OEM 锁 |
| Memtrack | `amlogic/hardware/amlogic/memtrack/` | 内存跟踪 |
| Dumpstate | `amlogic/hardware/amlogic/dumpstate/` | bugreport 收集 |
| Boot Ctrl | `amlogic/hardware/amlogic/boot_ctrl/` | A/B 启动控制 |
| Fastboot | `amlogic/hardware/amlogic/fastboot/` | Fastboot HAL |
| AU CPU FW | `amlogic/hardware/amlogic/aucpu_fw/` | Audio CPU 固件 |
| CVE | `amlogic/hardware/amlogic/cve/` | 视觉处理引擎 |
| Screen Source | `amlogic/hardware/amlogic/screen_source/` | 屏幕捕获 |

### device/ — 设备级（STB）

| 子模块 | 路径前缀 | 说明 |
|------|---------|------|
| Amlogic 设备配置 | `amlogic/device/amlogic/{common,pascal,qurra,raman,ramancas,ross,yukawa,yukawa-kernel}/` | 6 个 ODM 板级配置 + Yukawa 参考板 |
| Generic | `amlogic/device/generic/` | AOSP 通用设备 |
| Google 设备 | `amlogic/device/google/` | Google 参考设备 |

### STB 独有顶级目录

| 目录 | 路径前缀 | 说明 |
|------|---------|------|
| Common（顶级公共） | `amlogic/common/` | 顶级公共代码（含 kernel 6.12 与 board project） |
| ★ **Kernel 6.12** | `amlogic/common/common16-6.12/` | STB 用的 kernel 6.12（D4/X5 都是 5.15） |
| 驱动模块 | `amlogic/common/driver_modules/` | 内核驱动模块 |
| Board Project | `amlogic/common/project/` | 板级配置工程 |
| Common Tools | `amlogic/common/tools/` | 公共构建/调试工具 |
| ★ **Trusty TEE** | `amlogic/trusty/` | 完整 Trusty 可信执行环境工程（D4/X5 都没有） |
| Trusty Device | `amlogic/trusty/device/` | Trusty 设备配置 |
| Trusty Kernel | `amlogic/trusty/kernel/` | Trusty 内核 |
| Trusty User | `amlogic/trusty/user/` | Trusty 用户态 TA（Trusted Application） |

### 其他常用一级目录（STB）

| 目录 | 路径前缀 | 说明 |
|------|---------|------|
| Kernel（旧） | `amlogic/kernel/` | Linux 内核源码（旧版） |
| Bootable | `amlogic/bootable/` | bootloader / recovery |
| External | `amlogic/external/` | 第三方库 |
| System | `amlogic/system/` | 系统底层组件 |
| Bionic | `amlogic/bionic/` | Android C/C++ 标准库 |
| ART | `amlogic/art/` | Android Runtime |

---

## 典型问题 → 路径推荐对照表

帮助 AI 快速从关键词跳到路径前缀。如果用户问题中出现以下关键词，优先到对应路径搜索。

> **跨平台说明**：表中默认列 D4 路径；X5/STB 大部分相同，**仅业务代码位置不同**：
> - D4 业务代码 → `amlogic/vendor/zeasn/`
> - X5/STB 业务代码 → `amlogic/vendor/whale/`
>
> 处理 X5/STB 项目时，遇到 `vendor/zeasn/` 自动改为 `vendor/whale/`。

| 问题关键词 | 推荐搜索路径 |
|-----------|--------------------------|
| TvScanConfig / 频道扫描 / DTV 扫描 | `amlogic/vendor/amlogic/common/frameworks/`、`amlogic/packages/apps/TV/`、`amlogic/hardware/amlogic/tuner/` |
| TvSettings / 电视设置 | `amlogic/packages/apps/TvSettings/Settings/` |
| TvSystemUI（X5/STB 有，D4 无） | `amlogic/packages/apps/TvSystemUI/` |
| LiveTv / 直播电视 | `amlogic/packages/apps/TV/` |
| HDMI CEC / 联动控制 | `amlogic/hardware/amlogic/hdmi_cec/` |
| PQ / 画质 / Picture Quality | `amlogic/vendor/amlogic/common/frameworks/`、`amlogic/hardware/amlogic/tv/`、STB: `amlogic/hardware/amlogic/mediaquality/` |
| MediaQuality（仅 STB） | `amlogic/hardware/amlogic/mediaquality/` |
| Audio / 音频路由 | `amlogic/hardware/amlogic/audio/`、`amlogic/hardware/amlogic/LibAudio/`、`amlogic/frameworks/base/services/core/` |
| ASPlayer（X5/STB 有） | `amlogic/vendor/amlogic/common/ASPlayer/` |
| Camera | `amlogic/packages/apps/Camera2/`、`amlogic/hardware/amlogic/camera/` |
| Wi-Fi / WLAN | `amlogic/hardware/amlogic/wifi/`、`amlogic/vendor/amlogic/common/wifi_bt/`、`amlogic/frameworks/base/wifi/java/`、`amlogic/frameworks/base/services/wifi/` |
| Bluetooth / 蓝牙 | `amlogic/vendor/amlogic/common/wifi_bt/`、`amlogic/hardware/broadcom/libbt/` |
| USB（X5/STB 有专门 HAL） | D4: `amlogic/frameworks/base/services/usb/` ; X5/STB 同 + `amlogic/hardware/amlogic/usb/` |
| Thread / IoT 1.5（仅 STB） | `amlogic/hardware/amlogic/thread/` |
| SystemUI / 状态栏 / 通知栏 | `amlogic/frameworks/base/packages/SystemUI/`（X5/STB 也可能在 `amlogic/packages/apps/TvSystemUI/`） |
| Launcher / 桌面 | `amlogic/packages/apps/Launcher3/` |
| Settings（通用） | `amlogic/packages/apps/Settings/`、`amlogic/frameworks/base/packages/SettingsProvider/` |
| WindowManager / WMS | `amlogic/frameworks/base/services/core/`、`amlogic/frameworks/base/packages/WindowManager/` |
| ActivityManager / AMS | `amlogic/frameworks/base/services/core/` |
| PackageManager / PMS | `amlogic/frameworks/base/services/core/`、`amlogic/frameworks/base/packages/PackageInstaller/` |
| Permission（X5/STB 独立 service） | X5/STB: `amlogic/frameworks/base/services/permission/` |
| Credentials / 凭据（X5/STB） | `amlogic/frameworks/base/services/credentials/`、`amlogic/frameworks/base/packages/CredentialManager/` |
| Multiuser / 多用户（仅 STB） | `amlogic/packages/apps/Multiuser/` |
| PrivateSpace / 私密空间（仅 STB） | `amlogic/packages/apps/PrivateSpace/` |
| AppFunctions（仅 STB） | `amlogic/frameworks/base/services/appfunctions/` |
| Vcn / Virtual Carrier Network（仅 STB） | `amlogic/frameworks/base/packages/Vcn/` |
| NeuralNetworks / 神经网络（仅 STB） | `amlogic/frameworks/base/packages/NeuralNetworks/` |
| CrashRecovery（仅 STB） | `amlogic/frameworks/base/packages/CrashRecovery/` |
| Boot / 启动 / init | `amlogic/system/`、`amlogic/bootable/`、`amlogic/hardware/amlogic/boot_ctrl/` |
| Kernel panic / 内核 | D4: `amlogic/kernel/`、`amlogic/vendor/amlogic/common/kernel/` ; X5: `amlogic/common/common14-5.15/`、`amlogic/common/driver_modules/` ; STB: `amlogic/common/common16-6.12/`、`amlogic/common/driver_modules/` |
| TEE / Trusty / 可信执行（仅 STB） | `amlogic/trusty/{device,kernel,user}/` |
| HDCP / 内容保护 | `amlogic/vendor/amlogic/common/hdcp/` |
| DRM / Widevine | `amlogic/vendor/widevine/`、`amlogic/frameworks/base/drm/` |
| Provision / 配机 / 首次开机 | `amlogic/vendor/amlogic/common/provision/`、`amlogic/packages/apps/Provision/` |
| GMS / Google 服务 | `amlogic/vendor/amlogic/common/gms/` |
| Codec / 编解码 | `amlogic/vendor/amlogic/common/codec2/`、`amlogic/hardware/amlogic/media/` |
| GPU / 图形 | D4: `amlogic/vendor/amlogic/common/gpu/`、`amlogic/vendor/amlogic/common/gpu-lib/` ; X5/STB: 仅 `amlogic/vendor/amlogic/common/gpu-lib/` |
| HWComposer / 显示合成 | `amlogic/hardware/amlogic/hwcomposer/` |
| Tuner | `amlogic/packages/apps/TV/tuner/`、`amlogic/hardware/amlogic/tuner/` |
| Touchscreen / 触屏（X5 有） | `amlogic/vendor/amlogic/common/touchscreen/` |
| DSP（X5/STB 有） | `amlogic/vendor/amlogic/common/dsp/` |
| IPSP / IP STB（仅 STB） | `amlogic/vendor/amlogic/common/ipsp/` |
| Sign Tools / 签名工具（仅 STB） | `amlogic/vendor/amlogic/common/sign_tools/` |
| Whale / 鲸 / 内部业务 | D4: `amlogic/vendor/zeasn/`、`amlogic/vendor/amlogic/common/whale_pid/` ; X5: `amlogic/vendor/whale/`、`amlogic/vendor/whale/whale_configs/` ; STB: `amlogic/vendor/whale/`（无 customer 子项） |
| 客户定制 | D4: `amlogic/vendor/zeasn/{ctv,cvte,hikeen,stm,topt}/` ; X5: `amlogic/vendor/whale/customer/` ; STB: 走 `vendor/whale/` 内部分支或不同 git project |
| 板级 project（X5/STB 有） | `amlogic/common/project/` |

---

## 维护说明

- 数据采集脚本：`.scratch/og-walk.ps1`（不进 git，临时使用）
- 重新采集（D4）：在源码根目录无关，直接调脚本
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\.scratch\og-walk.ps1 `
    -User <OpenGrok 用户名> -Pass <OpenGrok 密码> `
    -Project d4_code `
    -Roots 'amlogic/frameworks/base,amlogic/packages/apps,amlogic/vendor,amlogic/hardware,amlogic/device' `
    -MaxDepth 2 -OutSuffix '-base'
  ```
- 当 OpenGrok 索引更新（参考页脚 Last Index Update）后差异较大时，重新采集即可
- 新增平台（X5、STB 等）：用同样脚本换 `-Project` 参数，再把结果填到本文件对应小节
- 当某次搜索发现地图覆盖不到的关键模块时，记录到 `.learnings/LEARNINGS.md`（分类 `knowledge_gap`），并补充到本地图


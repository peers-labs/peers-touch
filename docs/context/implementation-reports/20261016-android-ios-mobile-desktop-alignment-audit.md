# Android / iOS / Desktop 对齐审计

> **性质**：当前源码快照审计，不是目标架构真源
> **审计日期**：2026-10-16
> **工作树**：`<repo-root>`（本次选择的 `peers-android` worktree）
> **分支**：`analysis/android-platform-alignment`
> **源码提交**：`a32dce8acac78794f8775dbad7bb7e6967b74104`
> **基线引用**：本机缓存的 `origin/master`
> **范围**：Infra、Chat、Social
> **排除**：AI、Agent、Applet

## 1. 基线与证据边界

### 1.1 Git 基线

工作树 HEAD 与本机缓存的 `origin/master` 完全一致。该远端引用最后一次成功更新于
`2026-10-16 14:43:46 +0800`，对应提交时间为
`2026-10-16 14:30:19 +0800`。

审计期间 GitHub SSH 和 HTTPS 均无法建立连接，因此：

- **已证实**：本报告准确对应本机 `origin/master` 的上述提交。
- **未证明**：审计时刻 GitHub 服务端是否存在比该提交更新的 `master`。
- **禁止表述**：不能把该状态称为“已实时拉取 GitHub 最新 master”。

### 1.2 证据等级

- **源码事实**：可直接由当前提交中的实现、配置或测试入口定位。
- **源码推断**：实现组合可推出高概率行为，但未在当前提交的真实设备上复现。
- **未证明**：存在设计、测试脚本或接口，但没有当前提交绑定的运行证据。
- **历史证据**：能证明历史提交，不能替代当前提交的证明。

### 1.3 总体结论

当前 Mobile 不是“Android 与 iOS 两个平台完成度相同的一套产品”，而是：

1. Web 产品层大量共享，业务页面覆盖已经较深。
2. 平台身份、构建门和样式仍明显以 iOS 为主。
3. Android 原生插件存在，但缺少系统返回键、FCM provider 接线和完整相机输出。
4. iOS 的 APNs/BGTask 源码入口存在，但 entitlement 和后台模式配置未闭环。
5. Mobile 与 Desktop 在 Chat/Social 的用户语义上已经有较大交集，但本地 Rust
   运行时仍是两套平行实现，功能和恢复能力持续分叉。
6. Chat 最大用户缺口是 Mobile 群通话、安全号码和详情管理能力。
7. Social 最大用户缺口是 Mobile 反应集合、分享和 Android/iOS 当前源码实机证明；
   Desktop 反而缺少 Mobile 已有的用户拉黑入口。

## 2. 优先级定义

- **P0**：主链路断裂、安全/身份错误、平台声明与实际能力不一致，或无法证明产品可用。
- **P1**：核心能力存在但用户结果明显不等价，或架构分叉会持续制造回归。
- **P2**：体验、效率和平台原生感差异，不阻断核心结果。
- **P3**：低频细节或纯视觉收敛。

## 3. Infra 模块

### 3.1 平台身份与构建门

**Android / iOS**

- **源码事实，P0**：Rust 根容器无条件注册
  `MobilePlatform::ios_first()`，Android 运行时也得到 `tauri-mobile-ios` shell 身份。
  见
  [`apps/mobile/src-tauri/src/lib.rs`](../../../apps/mobile/src-tauri/src/lib.rs#L21-L40)
  和
  [`apps/mobile/src-tauri/src/platform/ios.rs`](../../../apps/mobile/src-tauri/src/platform/ios.rs#L16-L29)。
- **源码事实，P0**：Web platform port 同样固定返回 `name: 'tauri-ios'`。
  见
  [`apps/mobile/src/services/platform/mobilePlatform.ts`](../../../apps/mobile/src/services/platform/mobilePlatform.ts#L13-L26)。
- **用户影响**：任何基于 platform identity 的诊断、埋点、能力分支或恢复提示都可能把
  Android 误报为 iOS。
- **架构根因**：platform identity 不是由启动时原生事实注入，而是由 iOS-first
  构造器静态决定。

- **源码事实，P0**：`apps/mobile/package.json` 只有 iOS init/dev/build/project
  check；顶层 package 也只有 `mobile:dev:ios` 和 `mobile:build:ios`。
  `check:native-platforms` 只发现 `ios_*_test.py`。
  见
  [`apps/mobile/package.json`](../../../apps/mobile/package.json#L6-L28)
  和
  [`package.json`](../../../package.json#L17-L20)。
- **用户影响**：Android 可以长期在主检查通过的情况下构建失败或原生能力退化。
- **架构根因**：通用 Mobile 设计仍把 iOS Simulator 设为 canonical runtime，
  Android 只作为 optional diagnostics；Social parity 又要求 Android 必选。
  见
  [`docs/architecture/platform/client/mobile/design.md`](../../../docs/architecture/platform/client/mobile/design.md#L863-L894)
  和
  [`docs/architecture/platform/client/mobile/social-parity/design.md`](../../../docs/architecture/platform/client/mobile/social-parity/design.md#L267-L280)。
- **结论**：治理口径自相矛盾，直接解释了“Android 有源码，但没有同等级发布门”。

**Mobile / Desktop**

- **源码事实，P1**：Desktop 拥有常规 Tauri build/check 主线；Mobile 的平台检查按
  iOS 特化。两者没有统一的 Client platform matrix。
- **架构影响**：共享业务包只能减少 TS 层差异，不能防止 Android native shell
  失效。

### 3.2 应用图标与品牌

**Android / iOS**

- **源码事实**：当前生成资源已经不是 Tauri 默认图标。Android launcher 与 iOS
  AppIcon 都使用 Peers wordmark。
- **视觉观察**：Android `mipmap-xxxhdpi/ic_launcher.png` 与 iOS
  `AppIcon-512@2x.png` 的品牌主体一致。
- **剩余风险，未证明**：不同 Android OEM mask 是否裁切 wordmark，需要当前提交物理机
  launcher 截图证明。源码图片本身不能证明 ColorOS、One UI 等 launcher 结果。

### 3.3 UI 风格与平台交互风格

**Android / iOS**

- **源码事实，P1**：Mobile 全局字体从 `-apple-system`、`SF Pro Text` 开始，样式没有
  Android/iOS platform selector。
  见
  [`apps/mobile/src/styles.css`](../../../apps/mobile/src/styles.css#L1-L55)。
- **源码事实，P1**：底部 tab bar、半透明 blur header、bottom sheet、44px 圆角图标按钮
  全部使用同一套 iOS 风格表达。
  见
  [`apps/mobile/src/styles.css`](../../../apps/mobile/src/styles.css#L1572-L1764)。
- **用户影响**：Android 功能入口位置与 iOS 一致，但字体、返回逻辑、sheet 手感、
  elevation、系统导航习惯不像 Android。
- **架构判断**：共享 Web UI 是正确主线；缺失的是 platform presentation adapter，
  不是再建一套 Compose UI。
- **长期正确方向**：保留统一组件树和业务状态，只让 typography、motion、navigation
  affordance、system bar、back policy 和 picker presentation 读取真实 platform
  capability。

**Mobile / Desktop**

- **源码事实**：Mobile 用 tab + detail stack + bottom sheet；Desktop 用 rail、pane、
  modal/popover。这属于设备形态适配，不应追求像素一致。
- **真正不对齐**：同一业务动作在两端经常由不同状态 owner 实现，见 Chat/Social
  章节，而不是单纯布局不同。

### 3.4 导航与返回链路

**Android / iOS**

- **源码事实，P0**：Mobile 有自己的 detail stack 和 `popDetail`，页面内返回按钮工作。
  见
  [`apps/mobile/src/components/MobileShell.tsx`](../../../apps/mobile/src/components/MobileShell.tsx#L235-L335)。
- **源码事实**：仓库中未找到 app-level `backbutton`、`OnBackPressed`、
  `OnBackPressedDispatcher`、`popstate` 或 Android hardware-back bridge。
- **源码推断，P0**：Android 系统返回键不会可靠映射为关闭 overlay -> 退出 detail ->
  切换/退出 app 的有序策略；具体 fallback 行为取决于 Tauri/WebView，需物理机证明。
- **用户影响**：Android 最基础的单手导航可能直接失效，或者退出 app 而不是返回上一层。
- **架构根因**：导航 store 只定义了 Web intent，没有定义 OS back 作为输入端口。

**Mobile / Desktop**

- **源码事实**：Desktop 有 hash/deep-link/router 和页面级导航；Mobile 用内存
  detail stack。两者可以不同，但都应消费统一的业务 route identity。
- **风险**：Mobile 没有将系统 back、deep link 和内部 stack 统一到一个 navigation
  admission owner。

### 3.5 Station 选择、身份验证与 Access Gate

**Android / iOS**

- **源码事实**：Station discovery、route activation、signed identity readback 都在
  Mobile Rust command 后验证；Android/iOS 共用该链路。
  见
  [`apps/mobile/src/features/station/stationConnection.ts`](../../../apps/mobile/src/features/station/stationConnection.ts#L67-L160)。
- **源码事实**：Mobile Access Gate 支持 email/password、OAuth、invite code、
  schema-driven gate、blocked/failed/pending 和 session-expired。
  见
  [`apps/mobile/src/features/auth/AccessGateHost.tsx`](../../../apps/mobile/src/features/auth/AccessGateHost.tsx#L98-L284)。
- **结论**：Station/Access Gate 的业务语义在 Android/iOS 之间基本对齐。
- **未证明**：Android OAuth callback、进程重启恢复和系统浏览器返回没有当前提交实机证据。

**Mobile / Desktop**

- **源码事实**：两端都已有 verified Station registry、route picker 和 binding complete
  rollback。
  Mobile 见上述 stationConnection；Desktop 见
  [`apps/desktop/src/components/common/StationPicker.tsx`](../../../apps/desktop/src/components/common/StationPicker.tsx#L58-L224)
  和
  [`apps/desktop/src/store/session.ts`](../../../apps/desktop/src/store/session.ts#L70-L84)。
- **交互差异，P1**：Mobile 在启动和 Settings 中暴露 Station 切换；Desktop
  `StationPicker` 只挂在 OnboardingView，Ready shell 缺少同等级全局 Station 入口。
  见
  [`apps/desktop/src/views/OnboardingView.tsx`](../../../apps/desktop/src/views/OnboardingView.tsx#L259)。
- **用户影响**：桌面用户进入产品后更难发现和切换 Station；Mobile 的 Settings
  反而更完整。

### 3.6 生命周期、后台与恢复

**Android / iOS**

- **源码事实**：两端原生插件都发出 foreground/background 和 network signals；
  Web runtime 统一消费。
- **源码事实**：Android 用 WorkManager，每 15 分钟注册 periodic work。
  见
  [`PlatformPermissionsPlugin.kt`](../../../apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/PlatformPermissionsPlugin.kt#L260-L306)。
- **源码推断，P0**：Android `ReconcileWorker` 只通过进程内静态
  `activeInstance` 投递。如果 app 进程被系统杀死，Worker 启动时没有已激活 Tauri
  plugin，`ingestScheduledCallback` 返回 null 并把工作记为 success。
  见
  [`PlatformPermissionsPlugin.kt`](../../../apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/PlatformPermissionsPlugin.kt#L937-L943)
  和
  [`PlatformPermissionsPlugin.kt`](../../../apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/PlatformPermissionsPlugin.kt#L1057-L1081)。
- **用户影响**：真正需要后台补偿的“进程已死”场景反而不会执行 reconcile。
- **架构根因**：WorkManager 没有 durable callback handoff，依赖 Activity/plugin
  活体对象。

- **源码事实，P0**：iOS 注册了 `BGTaskScheduler` identifiers，但 Info.plist 没有
  `UIBackgroundModes`，entitlements 为空。
  见
  [`Info.plist`](../../../apps/mobile/src-tauri/gen/apple/peers-touch-mobile_iOS/Info.plist#L34-L38)
  和
  [`peers-touch-mobile_iOS.entitlements`](../../../apps/mobile/src-tauri/gen/apple/peers-touch-mobile_iOS/peers-touch-mobile_iOS.entitlements#L1-L5)。
- **源码推断**：iOS background refresh / remote notification 唤醒的发布配置未闭环。

**Mobile / Desktop**

- **源码事实**：Mobile 有聚合 recovery projection，覆盖 draft、command ledger、
  capacity、write revocation、Station mismatch、actor identity、event overflow、
  deferred runtime 和 offline/session-expired。
  见
  [`apps/mobile/src/runtimes/recoveryProjection.ts`](../../../apps/mobile/src/runtimes/recoveryProjection.ts#L29-L148)。
- **源码事实**：Mobile 将 app-level recovery 状态集中渲染，避免每个页面建立第二个
  retry owner。
  见
  [`RecoveryOverlayHost.tsx`](../../../apps/mobile/src/components/recovery/RecoveryOverlayHost.tsx#L65-L132)。
- **源码事实**：Desktop 有更完整的 Chat backup/recovery 用户面，包括 24 词生成、
  backup revision 和 restore；Mobile 只有恢复输入，没有等价 backup 管理页。
  见
  [`RecoverySettings.tsx`](../../../apps/desktop/src/components/settings/RecoverySettings.tsx#L241-L307)
  和
  [`messaging-recovery-service.ts`](../../../apps/desktop/src/services/messaging-recovery-service.ts#L98-L123)。
- **结论，P1**：Mobile 更强于运行时故障投影，Desktop 更强于用户可管理的消息恢复。
  两端都没有形成统一的“客户端恢复能力模型”。

### 3.7 Push 与通知

**Android**

- **源码事实，P0**：Android manifest 声明 `POST_NOTIFICATIONS`，plugin 提供
  `ingestFcmToken` / `ingestPushReceipt`。
  见
  [`AndroidManifest.xml`](../../../apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/AndroidManifest.xml#L3-L11)
  和
  [`PlatformPermissionsPlugin.kt`](../../../apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/PlatformPermissionsPlugin.kt#L937-L976)。
- **源码事实，P0**：仓库没有 `FirebaseMessagingService`、`onNewToken`、
  `onMessageReceived`、`firebase-messaging` 或 Google Services plugin。
- **结论**：Android push bridge 只有被调用入口，没有 FCM provider 入口，链路断在
  `FCM -> Android service -> ingestFcmToken/ingestPushReceipt`。

**iOS**

- **源码事实**：iOS plugin 调用
  `registerForRemoteNotifications()`，hook APNs token，并处理前台 receipt / tap。
  见
  [`PlatformPermissionsPlugin.swift`](../../../apps/mobile/src-tauri/plugins/platform-permissions/ios/Sources/PlatformPermissionsPlugin.swift#L169-L205),
  [`PlatformPermissionsPlugin.swift`](../../../apps/mobile/src-tauri/plugins/platform-permissions/ios/Sources/PlatformPermissionsPlugin.swift#L280-L325)
  和
  [`PlatformPermissionsPlugin.swift`](../../../apps/mobile/src-tauri/plugins/platform-permissions/ios/Sources/PlatformPermissionsPlugin.swift#L569-L600)。
- **源码事实，P0**：签名 entitlements 没有 `aps-environment`，Info.plist 也没有
  remote-notification background mode。
- **结论**：代码入口存在，但可发布 APNs 能力未证明。

**共同 Rust 链路**

- **源码事实**：Rust push bridge 对 lifecycle generation、scope、token、wakeup、
  expiration 和 registration retry 做了严格校验。
  见
  [`apps/mobile/src-tauri/src/platform/push_bridge.rs`](../../../apps/mobile/src-tauri/src/platform/push_bridge.rs#L25-L151)
  和
  [`apps/mobile/src-tauri/src/platform/push_bridge.rs`](../../../apps/mobile/src-tauri/src/platform/push_bridge.rs#L166-L253)。
- **架构结论**：中间层质量高，但两端最外侧 provider/capability 没闭环，形成
  “中间完整、两头不通”。

**Mobile / Desktop**

- **源码事实**：Desktop 有 native notification 和 dock badge command；Mobile 有
  notification center、preference、push bridge。
  见
  [`apps/desktop/src/services/desktop_api.ts`](../../../apps/desktop/src/services/desktop_api.ts#L7942-L7958)
  和
  [`apps/mobile/src/components/MobileNotificationCenter.tsx`](../../../apps/mobile/src/components/MobileNotificationCenter.tsx#L34-L107)。
- **用户结果**：前台通知中心基本对齐；后台到达能力不对齐且 Android/iOS 都未证明。

### 3.8 权限、媒体选择与系统能力

**Android / iOS**

- **源码事实**：相机、麦克风、照片/存储、通知的 typed permission contract 基本一致。
- **源码事实，P0**：Android 相机使用 `ACTION_IMAGE_CAPTURE`，只读取
  `result.data.extras["data"]` 的缩略图，然后重新编码 JPEG。
  见
  [`PlatformPermissionsPlugin.kt`](../../../apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/PlatformPermissionsPlugin.kt#L347-L367),
  [`PlatformPermissionsPlugin.kt`](../../../apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/PlatformPermissionsPlugin.kt#L410-L445)
  和
  [`PlatformPermissionsPlugin.kt`](../../../apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/PlatformPermissionsPlugin.kt#L870-L905)。
- **用户影响**：Android 拍照上传的是低分辨率 preview，不是原始照片；相机视频也不可能
  通过该 intent 返回。
- **iOS 对照**：iOS picker 会复制 `mediaURL`、`imageURL` 或 original image。
  见
  [`PlatformPermissionsPlugin.swift`](../../../apps/mobile/src-tauri/plugins/platform-permissions/ios/Sources/PlatformPermissionsPlugin.swift#L527-L559)。
- **源码事实，P1**：Android file MIME 只把通用文件映射为 `application/*`；
  iOS 使用 `UTType.data`。Android 会漏掉 `text/*` 等合法文档。
  见
  [`PlatformPermissionsPlugin.kt`](../../../apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/PlatformPermissionsPlugin.kt#L794-L800)
  和
  [`PlatformPermissionsPlugin.swift`](../../../apps/mobile/src-tauri/plugins/platform-permissions/ios/Sources/PlatformPermissionsPlugin.swift#L925-L936)。

- **源码事实，P1**：平台设计声明 Android 应使用 Photo Picker / CameraX，但实现仍是
  ACTION_OPEN_DOCUMENT / ACTION_IMAGE_CAPTURE。
  见
  [`native-plugin-layer.md`](../../../docs/client/mobile/native-plugin-layer.md)。
- **源码事实，P1**：设计声明 Sharesheet/UIActivityViewController 和
  BiometricPrompt/LocalAuthentication，当前 Mobile 源码没有对应实现。
- **用户影响**：Social 的 share 是 disabled 占位；本地敏感操作也没有 biometric
  解锁。

### 3.9 Secure Storage 与 Secure Input

**Android / iOS**

- **源码事实**：Android 使用 AndroidKeyStore AES-GCM，AAD 绑定 app id 与 logical key，
  SharedPreferences 仅存密文；backup/device transfer 明确排除。
  见
  [`SecureStoragePlugin.kt`](../../../apps/mobile/src-tauri/plugins/secure-storage/android/src/main/java/SecureStoragePlugin.kt#L133-L224)
  和
  [`peers_secure_storage_data_extraction_rules.xml`](../../../apps/mobile/src-tauri/plugins/secure-storage/android/src/main/res/xml-v31/peers_secure_storage_data_extraction_rules.xml#L1-L9)。
- **源码事实**：iOS Keychain 使用
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` 且禁用 synchronizable。
  见
  [`ios_keychain.rs`](../../../apps/mobile/src-tauri/src/platform/secure_storage/ios_keychain.rs#L85-L118)
  和
  [`ios_keychain.rs`](../../../apps/mobile/src-tauri/src/platform/secure_storage/ios_keychain.rs#L293-L312)。
- **结论**：安全语义基本对齐，平台实现差异合理。

- **源码事实，P1**：Android recovery phrase 是 3 行 multiline password
  `AlertDialog`，并临时设置 `FLAG_SECURE`；iOS 是单行 secure
  `UIAlertController` text field。
  见
  [`SecureInputPlugin.kt`](../../../apps/mobile/src-tauri/plugins/secure-input/android/src/main/java/SecureInputPlugin.kt#L81-L172)
  和
  [`SecureInputPlugin.swift`](../../../apps/mobile/src-tauri/plugins/secure-input/ios/Sources/SecureInputPlugin.swift#L80-L179)。
- **用户影响**：24 词输入在 iOS 单行框中可用性显著较差；Android 更适合长 secret，
  但两端错误修正体验仍不一致。

### 3.10 Deep Link 与系统设置恢复

**Android / iOS**

- **源码事实**：两端都注册 `peers-touch://oauth/callback`，Rust 将 OAuth callback
  与普通 deep link 分流。
  Android 见
  [`AndroidManifest.xml`](../../../apps/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml#L26-L36)，
  iOS 见
  [`Info.plist`](../../../apps/mobile/src-tauri/gen/apple/peers-touch-mobile_iOS/Info.plist#L9-L19)。
- **结论**：URL scheme 注册对齐；Universal/App Link 尚未落地。

- **源码事实，P0**：root error 的“打开系统设置”固定执行
  `window.location.assign('app-settings:')`。
  见
  [`apps/mobile/src/main.tsx`](../../../apps/mobile/src/main.tsx#L142-L144)。
- **源码推断**：这是 iOS settings scheme，不是 Android Settings intent；
  Android 恢复按钮不可用。
- **架构根因**：系统设置不是 platform port，而是 Web 层硬编码 URI。

### 3.11 Infra 小结

**用户视角**

- iOS 看起来更像主平台，但 push/background 仍没有发布级闭环。
- Android 页面数量接近 iOS，但系统返回、后台、push、相机和设置恢复存在实质断链。
- Desktop 的 Station 和消息恢复能力存在，却没有统一暴露在全局导航中。

**架构师视角**

- 最大问题不是“缺几个 if Android”，而是缺少一个真实 platform capability
  projection。
- 构建矩阵、运行矩阵、platform identity 和 system action port 必须统一，否则每个
  native feature 都会重复产生 iOS-first 偏差。

## 4. Chat 模块

### 4.1 会话所有权

**Mobile**

- **源码事实，P0**：Direct Chat detail owner 是 `social`，Group Chat detail owner
  是 `messaging`。
  见
  [`navigationDescriptors.ts`](../../../apps/mobile/src/app/navigation/navigationDescriptors.ts#L71-L87)。
- **源码事实，P0**：Chat badge 把 Social session unread 与 Messaging group unread
  在 shell 临时相加。
  见
  [`MobileShell.tsx`](../../../apps/mobile/src/components/MobileShell.tsx#L253-L286)。
- **目标约束**：Mobile architecture 明确要求 `messagingRuntime` 单独拥有
  Direct/Group conversation、settings 和 materialized message。
  见
  [`docs/client/mobile/lifecycle.md`](../../../docs/client/mobile/lifecycle.md#L223)
  和
  [`docs/architecture/platform/client/mobile/design.md`](../../../docs/architecture/platform/client/mobile/design.md#L162)。
- **结论**：UI 路由和 badge 仍暴露迁移遗留的双 owner。

**Desktop**

- Desktop 同样由 `socialChat` store 投影 Direct/Group，messaging native runtime
  负责真实消息链路。语义集中度比 Mobile 高，但仍把 Social 命名带入 Chat owner。

**架构影响**

- 这不是命名问题。Direct unread、refresh、route readiness、teardown 和错误恢复可能
  各自从不同 owner 读取。
- **长期正确方向**：Direct/Group projection、unread、settings、message actions
  统一归 Messaging client runtime；Social 只提供关系和联系人输入。

### 4.2 会话列表、Direct 与 Group

- **源码事实**：Mobile 与 Desktop 都支持 Direct/Group 列表、创建、选择、read cursor、
  unread、mute、pin/sticky、alert 和 background。
- **源码事实**：两端都通过 canonical Conversation/Messaging native path，而不是旧
  friend-chat/group-chat HTTP owner。
- **用户结果**：核心聊天列表和文本消息能力已经接近。

**差异**

- Mobile 更适合单窗 route stack；Desktop 用列表、消息区、详情 pane 并行展示。
- Desktop 可从详情设置自定义背景图片；Mobile 只提供固定背景选项。
  Mobile 见
  [`ChatOverlayHost.tsx`](../../../apps/mobile/src/pages/chat/ChatOverlayHost.tsx#L346-L378)，
  Desktop 见
  [`ChatDetailPanel.tsx`](../../../apps/desktop/src/components/chat/ChatDetailPanel.tsx#L943-L959)。
- **优先级 P2**：不阻断聊天，但用户定制能力不等价。

### 4.3 消息发送、历史、实时与可靠性

- **源码事实**：两端都支持 attachment staging、reply/thread identity、typed send
  outcome、history pagination、read cursor、typing 和 realtime refresh。
- **源码事实**：Mobile search 直接读 native index，即使消息未挂载也能命中，并使用
  `(timestamp, message_id)` cursor。
  见
  [`chatHistorySearch.test.ts`](../../../apps/mobile/src/features/chat/chatHistorySearch.test.ts#L28-L61)。
- **源码事实**：Mobile draft 包含 reply context 和 encrypted attachment refs，
  并进入 recovery projection。
- **结论**：消息主链不是当前最大差距；主要风险来自两套 native 实现分叉和缺少当前
  Android/iOS mixed-client 证明。

### 4.4 消息操作

- **共同能力**：reply、thread、forward、edit、recall/retract、reaction、pin、
  hide-for-me、moderation。
- Mobile 见
  [`MessageActionSheet`](../../../apps/mobile/src/pages/chat/ChatOverlayHost.tsx#L64-L180)。
- Desktop 见
  [`ChatMessageActionOverlay`](../../../apps/desktop/src/components/chat/message/ChatMessageActionOverlay.tsx#L37-L67)。

**差异**

- **源码事实，P2**：Mobile 只提供 5 个 reaction；Desktop 提供 24 个。
  Mobile 见
  [`ChatOverlayHost.tsx`](../../../apps/mobile/src/pages/chat/ChatOverlayHost.tsx#L57-L58)，
  Desktop 见
  [`ChatMessageActionOverlay.tsx`](../../../apps/desktop/src/components/chat/message/ChatMessageActionOverlay.tsx#L37-L41)。
- **交互适配合理**：Mobile 用 long-press/bottom sheet，Desktop 用邻接消息的悬浮
  action overlay。问题在 reaction 语义集合，不在控件形态。

### 4.5 Group 管理

**已对齐能力**

- rename/description；
- invite/remove；
- promote/demote admin；
- transfer owner；
- member mute；
- self mute/pin；
- leave/dissolve。

Mobile 见
[`ChatOverlayHost.tsx`](../../../apps/mobile/src/pages/chat/ChatOverlayHost.tsx#L440-L905)；
Desktop 见
[`ChatDetailPanel.tsx`](../../../apps/desktop/src/components/chat/ChatDetailPanel.tsx#L1016-L1145)。

**差异**

- **Desktop 独有，P1**：group avatar 编辑、自己的 group nickname、shared media/files
  聚合。
  见
  [`ChatDetailPanel.tsx`](../../../apps/desktop/src/components/chat/ChatDetailPanel.tsx#L921-L940),
  [`ChatDetailPanel.tsx`](../../../apps/desktop/src/components/chat/ChatDetailPanel.tsx#L1300-L1393),
  [`ChatDetailPanel.tsx`](../../../apps/desktop/src/components/chat/ChatDetailPanel.tsx#L1513-L1561)
  和
  [`ChatDetailPanel.tsx`](../../../apps/desktop/src/components/chat/ChatDetailPanel.tsx#L1620-L1635)。
- **Mobile 独有**：group description 在管理 sheet 中是显式字段。
- **用户影响**：同一个群在不同客户端可管理字段不同，修改后无法从另一端完整维护。
- **架构根因**：Group product capability 没有 canonical client capability descriptor，
  页面各自直接暴露 native command 子集。

### 4.6 附件、相机和语音

- **源码事实**：两端消息层都支持 image/audio/file attachment 和 voice note metadata。
- **源码事实**：Mobile voice recorder 先请求 native microphone permission，但录制本身
  仍依赖 WebView `getUserMedia` + `MediaRecorder`。
  见
  [`useMobileChatVoiceRecorder.ts`](../../../apps/mobile/src/features/chat/useMobileChatVoiceRecorder.ts#L63-L117)。
- **未证明，P1**：当前提交没有绑定 Android/iOS 实机的 codec/container、后台打断、
  蓝牙切换和录音恢复证据。
- **Android 特有断点**：相机只返回 thumbnail，直接影响 Chat 和 Moments 的媒体质量，
  见 Infra 3.8。

### 4.7 消息搜索

- **Mobile**：当前会话内 keyword search，native index，前后页 cursor。
  见
  [`useChatHistorySearch.ts`](../../../apps/mobile/src/features/chat/useChatHistorySearch.ts#L19-L76)。
- **Desktop**：可跨 Direct/Group 或限定 conversation，并按 messages/threads/files
  过滤，能定位 message/thread。
  见
  [`SearchMessagesModal.tsx`](../../../apps/desktop/src/components/chat/SearchMessagesModal.tsx#L14-L32)
  和
  [`SearchMessagesModal.tsx`](../../../apps/desktop/src/components/chat/SearchMessagesModal.tsx#L182-L244)。
- **用户影响，P1**：Mobile 无法做全局聊天检索，也无法快速只找文件或 thread。
- **架构根因**：底层 search contract 能分页，但 Mobile presentation 只接 conversation
  scope，没有统一 search product projection。

### 4.8 Voice / Video Call

**Direct call**

- **源码事实**：Mobile 有 1:1 WebRTC 状态机、ring all devices、accept/reject、
  reconnect、mic/camera control。
  见
  [`callState.ts`](../../../apps/mobile/src/features/call/callState.ts#L15-L79)
  和
  [`MobileCallSurface.tsx`](../../../apps/mobile/src/components/call/MobileCallSurface.tsx#L18-L155)。
- **源码事实**：Mobile Chat 只在 Direct conversation header 显示 audio/video call。
  见
  [`ChatPage.tsx`](../../../apps/mobile/src/pages/ChatPage.tsx#L1437-L1475)。
- Desktop 也有 1:1 P2P call。

**Group call**

- **源码事实，P0**：Desktop 有完整 LiveKit group call manager、Station join、SSE room
  event、participant、mic/camera 和多种显示模式。
  见
  [`groupCallManager.ts`](../../../apps/desktop/src/modules/groupCall/groupCallManager.ts#L1-L135)
  和
  [`GroupCallSurface.tsx`](../../../apps/desktop/src/components/chat/GroupCallSurface.tsx#L139-L218)。
- **源码事实，P0**：Mobile 只有 generated group-call Proto，没有 runtime、provider 或 UI。
- **用户影响**：群聊里的音视频入口在 Mobile 完全缺失。
- **目标冲突**：Chat 决策已把 Group live calls 定义为 required。
  见
  [`docs/architecture/domains/chat/lifecycle/decisions.md`](../../../docs/architecture/domains/chat/lifecycle/decisions.md#L188-L202)。

### 4.9 E2EE 身份验证与恢复

- **源码事实，P0**：Desktop 有 safety number 派生、QR payload、peer trust ledger、
  fingerprint change 提示和 verification panel。
  见
  [`SafetyVerificationPanel.tsx`](../../../apps/desktop/src/components/chat/SafetyVerificationPanel.tsx#L76-L154)
  和
  [`safetyNumber.ts`](../../../apps/desktop/src/modules/identity/safetyNumber.ts#L95-L143)。
- **源码事实，P0**：Mobile Settings 暴露 `safety-number`，实际只渲染 unavailable。
  见
  [`SettingsPage.tsx`](../../../apps/mobile/src/pages/SettingsPage.tsx#L485-L492)。
- **用户影响**：Mobile 用户无法通过线下比对或 QR 验证联系人身份，也无法处理
  fingerprint changed 的信任重建。

- **源码事实，P1**：Desktop 提供 recovery phrase 生成/备份/恢复；Mobile 只有
  actor/private social recovery 输入。
- **安全影响**：新设备恢复链路的“创建备份”与“使用备份”分散在不同客户端，用户容易
  在旧设备不可用后才发现 Mobile 无法创建可见备份。

### 4.10 Chat UI 与操作逻辑

**Android / iOS**

- Chat 页面本身完全共享，因此功能按钮布局一致。
- Android 系统返回键未接入，导致同一页面在最关键的“怎么退出 thread/sheet/detail”
  上不一致。
- Android 相机返回 thumbnail，导致同一“拍照发送”动作结果不一致。
- 语音/视频依赖 WebView 能力，当前没有双平台运行证明。

**Mobile / Desktop**

- Mobile bottom sheet 和 Desktop hover overlay 是合理适配。
- 不合理差异集中在能力集合：Group call、safety number、全局搜索、group avatar/
  nickname、shared content、custom background。

### 4.11 Chat 架构重复

- **源码事实，P0**：Desktop 与 Mobile 各自拥有完整 Rust Messaging engine/store/
  lifecycle/transport。
- Mobile messaging Rust 约 28K 行，其中 `adapter.rs` 约 14.9K 行。
- Desktop messaging Rust 约 33K 行，其中 `store.rs` 约 18.9K 行。
- 两端共享 `@peers-touch/client-chat-core` 的部分 TS UI 语义，但不共享 native
  Messaging core 实现。
- **架构影响**：任何协议、MLS、recovery、attachment、receipt 或 command
  reconciliation 修复都需要两套落地和两套证据。
- **长期正确方向，P0**：抽取 portable Messaging Core/Store policy crate，
  Desktop/Mobile 只保留 host adapter、storage backend 和 OS lifecycle adapter。
  不能通过再加 facade 掩盖两套 engine。

## 5. Social 模块

### 5.1 Home / Explore / 导航

- **源码事实**：Mobile 有 Home/Explore segmented scope、sort sheet、bounded feed、
  inline thread、media overlay、Search/Profile/Circles routes。
  见
  [`MomentsPage.tsx`](../../../apps/mobile/src/pages/MomentsPage.tsx#L512-L527)
  和
  [`MomentsPage.tsx`](../../../apps/mobile/src/pages/MomentsPage.tsx#L600-L719)。
- **源码事实**：Mobile 当前实现已经是 flat article + bottom-sheet composer，不应再引用
  旧任务快照中的“card feed + inline composer”作为现状。
  见
  [`Moments.css`](../../../apps/mobile/src/pages/moments/Moments.css#L147-L164)
  和
  [`MomentComposer.tsx`](../../../apps/mobile/src/pages/moments/MomentComposer.tsx#L869-L889)。
- **Mobile / Desktop 结论**：核心 Social information architecture 已对齐；
  Mobile 是 feed-first 单窗，Desktop 是宽屏 page/rail，属于合理适配。

### 5.2 Search / Profile / Follow / Block

**共同能力**

- local/federated actor search；
- profile 和 authored posts；
- follow/unfollow；
- 从 accepted contact 打开 Direct Chat。

**差异**

- **源码事实，P1**：Mobile Profile 有 block/unblock 用户入口，并在操作后刷新 profile、
  Home 和 Explore。
  见
  [`SocialProfilePage.tsx`](../../../apps/mobile/src/pages/moments/SocialProfilePage.tsx#L117-L135)
  和
  [`SocialProfilePage.tsx`](../../../apps/mobile/src/pages/moments/SocialProfilePage.tsx#L339-L374)。
- **源码事实，P1**：Desktop 有 block/unblock Tauri command 和 Acceptance action，但
  Moments Profile / Chat Detail 没有用户入口。
- **用户影响**：Desktop 用户无法在 Social 产品面执行关键安全动作，只能依赖其他端。
- **架构根因**：Desktop 的 relationship command 已存在，产品 capability
  registration 没有要求 UI owner。

### 5.3 Circles 与 Audience

- **源码事实**：Mobile 和 Desktop 都覆盖 PUBLIC、FOLLOWERS、FRIENDS、CIRCLE、
  GROUP、CUSTOM_ALLOW、CUSTOM_DENY(FOLLOWERS)、SELF。
- Mobile 见
  [`MomentComposer.tsx`](../../../apps/mobile/src/pages/moments/MomentComposer.tsx#L72-L132)；
  Desktop 见
  [`AudiencePicker.tsx`](../../../apps/desktop/src/components/moments/AudiencePicker.tsx#L41-L51)。
- **源码事实**：Mobile Circle 支持 create/update/delete、member add/remove、local/
  federated picker，并在写后 authoritative readback。
  见
  [`socialCircles.ts`](../../../apps/mobile/src/features/social/socialCircles.ts#L170-L226)。
- **结论**：这部分产品语义已经高度对齐。

### 5.4 Composer 与内容类型

**读取**

- **源码事实**：Mobile 能渲染 text、image、video、link、poll、repost、location。
  见
  [`MomentContent.tsx`](../../../apps/mobile/src/pages/moments/MomentContent.tsx#L30-L35)
  和
  [`MomentContent.tsx`](../../../apps/mobile/src/pages/moments/MomentContent.tsx#L99-L170)。
- Desktop 同样能投影这些 public/private content kinds。

**创建**

- **源码事实**：Mobile product composer 当前只创建 text/image；
  `MobileMomentDraft` 也是这两个分支。
  见
  [`socialApiTypes.ts`](../../../apps/mobile/src/features/social/socialApiTypes.ts#L58-L118)。
- **源码事实**：Desktop product composer 当前同样主要暴露 text/image，但 Desktop
  domain draft 类型和 private publish intent 已支持 video/link/poll/repost/location。
  见
  [`apps/desktop/src/services/social_api.ts`](../../../apps/desktop/src/services/social_api.ts#L124-L212)
  和
  [`apps/desktop/src/store/moments.ts`](../../../apps/desktop/src/store/moments.ts#L179-L243)。
- **架构差异，P1**：Mobile 手工定义了一个 canonical Post 的子集 draft/request builder，
  Desktop 则保留完整类型。这会让后续 capability-gated creation 再次双实现。
- **长期正确方向**：由 generated capability snapshot 决定可见创建入口，两个客户端消费
  同一 canonical intent builder。

### 5.5 Reaction、Comment 与 Thread

**Comment / Thread**

- 两端都支持 public/private comment、reply、delete、pagination、inline thread 和
  readback/pending 状态。
- Mobile feed 默认 inline 展开一个 thread，符合 Mobile product contract。

**Reaction**

- **源码事实，P1**：Mobile Social feed 只暴露一个 heart reaction。
  见
  [`MomentFeedItem.tsx`](../../../apps/mobile/src/pages/moments/MomentFeedItem.tsx#L34-L35)
  和
  [`MomentFeedItem.tsx`](../../../apps/mobile/src/pages/moments/MomentFeedItem.tsx#L275-L311)。
- **源码事实**：Desktop Social reaction catalog 有 16 种。
  见
  [`reactionCatalog.ts`](../../../apps/desktop/src/components/moments/reactionCatalog.ts#L10-L25)。
- **用户影响**：同一 Post 在 Desktop 可表达的反应，在 Mobile 只能查看汇总或无法新增。
- **架构根因**：Mobile presentation 硬编码 `PRIMARY_REACTION_KIND`，未消费 shared
  reaction catalog/capability。

### 5.6 Media

- **共同能力**：最多 9 图、public/private media、overlay/lightbox、opaque private
  media open/decrypt。
- **Android 特有缺口**：原生相机只产 thumbnail，影响公开和私密 Moment 的内容质量。
- **Mobile 缺口，P1**：虽然能读取 video，composer picker 固定
  `acceptedMediaKinds: ['image']`，没有 video creation。
  见
  [`MomentComposer.tsx`](../../../apps/mobile/src/pages/moments/MomentComposer.tsx#L666-L689)。
- **Desktop 当前 UI**：同样主要是图片创建，因此用户结果接近；但底层 contract
  不对称仍需消除。

### 5.7 Private Social、恢复与撤销

- **源码事实**：Mobile 已有统一 `MobileSocialFacade`，按 canonical Audience 分流
  public/private intent，并将 private projection 合入 Home。
  见
  [`mobileSocialFacade.ts`](../../../apps/mobile/src/features/social/mobileSocialFacade.ts#L225-L252)。
- **源码事实**：Mobile private runtime 支持 publish/read/media/comment/reaction/
  recovery/reconcile/invalidation，secret 通过 native secure input 只回 Rust。
- **源码事实**：Desktop 也有完整 private moment/comment/reaction/media native path。
- **用户结果**：功能面接近，但当前提交没有 Android/iOS/Desktop 双向两 Station
  exact-source 证明。

**架构差异，P0**

- Mobile private Social/Secure Content Rust 和 Desktop Social Rust 是两套平行实现。
- 仅统计主要文件，双方合计超过 30K 行，不含 Station owner。
- **风险**：private delivery、recovery、revocation、media grant 和 unknown outcome
  可能在一个客户端修复、另一个客户端遗漏。
- **长期正确方向**：抽取 portable Secure Social client core；host 只拥有 secure
  storage、native secret input、media file adapter 和 lifecycle。

### 5.8 通知与分享

- 两端都有 notification list/unread/read/delete/preference。
- Mobile 有前台 notification center；Desktop 有 bell/store。
- **源码事实，P1**：Mobile Post share 按钮可见但永远 disabled。
  见
  [`MomentFeedItem.tsx`](../../../apps/mobile/src/pages/moments/MomentFeedItem.tsx#L325-L333)。
- **用户影响**：用户看到一个明确不可用的主操作，且平台设计承诺的 native share
  plugin 尚未实现。
- **处理原则**：在 share capability 落地前移除入口，不应保留 disabled future-work
  clutter。

### 5.9 Social Android / iOS / Desktop 证明状态

- **源码事实**：Social acceptance matrix 要求 iOS、物理 Android、Desktop/iOS、
  Desktop/Android、iOS/Android 双向矩阵。
  见
  [`acceptance-matrix.md`](../../../docs/architecture/platform/client/mobile/social-parity/acceptance-matrix.md#L21-L40)。
- **源码事实**：仓库存在 iOS/Android Gate、environment 和 journey 脚本。
- **源码事实**：当前 v31 task 目录只有计划和任务快照，仓库内未找到绑定当前提交的
  completion artifact。
- **证据边界**：任何绑定其他源码提交的历史 run 都不能证明当前
  `a32dce8acac78794f8775dbad7bb7e6967b74104`。
- **未证明，P0**：当前提交的 Android same-Station、Desktop<->Android、
  iOS<->Android Social 结果。
- **结论**：当前只能声明“源码能力较完整”，不能声明
  `SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN`。

### 5.10 Social 小结

**用户视角**

- Mobile 的 Social 已不是空壳，Home/Explore/Search/Profile/Circles/Audience/private
  read/write 都有实质实现。
- Android/iOS 用户看到同一 Web 产品，但 Android 媒体、返回、push/background
  链路不等价。
- Mobile reaction 和 share 明显弱于 Desktop；Desktop block/unblock 明显弱于 Mobile。

**架构师视角**

- Social 页面层已经接近目标 facade。
- 剩余最大风险在 native core 平行实现、platform capability 缺口和实机证明缺失。
- 不应再通过页面补丁追 parity；需要 shared capability ledger + portable native core。

## 6. 端到端断链清单

### 6.1 Android Push

```text
Station notification
  -> push provider registration
  -> FCM
  -X-> FirebaseMessagingService 缺失
  -> ingestFcmToken / ingestPushReceipt
  -> Rust PushBridge
  -> reconcile
  -> Chat/Social projection
```

断点：FCM provider 到 native plugin。

### 6.2 iOS Push

```text
Station notification
  -> APNs registration
  -X-> aps-environment entitlement 缺失
  -> app delegate hook
  -> Rust PushBridge
  -> reconcile
```

断点：发布签名 capability。

### 6.3 Android Scheduled Reconcile

```text
WorkManager wakes process
  -> ReconcileWorker
  -X-> activeInstance 可能为空
  -> plugin callback queue
  -> Rust drain
  -> reconciliation
```

断点：durable worker 到 Tauri runtime 的进程恢复协议。

### 6.4 Android System Back

```text
Android back gesture/button
  -X-> OS back bridge 缺失
  -> close overlay
  -> pop detail
  -> switch/exit root
```

断点：OS event 到 navigation admission。

### 6.5 Android Camera

```text
Chat/Moments camera intent
  -> ACTION_IMAGE_CAPTURE
  -> extras["data"] thumbnail
  -X-> original image/video
  -> staged handle
  -> encrypted/public upload
```

断点：原始媒体 acquisition。

### 6.6 Mobile Safety Verification

```text
Direct contact
  -> peer fingerprint
  -> safety number / QR
  -X-> Mobile verification UI 与 trust ledger
  -> verified / changed state
```

断点：Mobile product surface。

### 6.7 Mobile Group Call

```text
Group conversation
  -> active room / join
  -X-> Mobile group-call runtime/provider/UI
  -> SFU
  -> participant media
```

断点：Mobile client implementation。

### 6.8 Current-source Social Parity

```text
Current source commit
  -> iOS same-Station
  -> Android same-Station
  -> Desktop/iOS two-Station
  -> Desktop/Android two-Station
  -> iOS/Android two-Station
  -X-> same-source aggregate evidence
```

断点：运行证明，不是单一源码功能。

## 7. 用户旅程对比

### 7.1 首次进入与登录

- iOS/Android：页面和 Access Gate 基本一致。
- Android 风险：OAuth 返回、系统 back、root settings recovery 未证明或断链。
- Desktop：账号/PIN/recovery 更丰富，但 Station 切换入口只在 onboarding 明显。

### 7.2 私聊

- 文本、附件、语音、回复、thread、reaction、编辑、撤回、forward、搜索基本都有。
- Mobile 缺 safety verification、全局搜索和 shared-content 汇总。
- Android 拍照结果质量低于 iOS。

### 7.3 群聊

- 群成员和权限管理能力接近。
- Mobile 缺 group avatar、个人群昵称、群通话。
- Desktop 缺 Mobile 已有的 group description 显式管理。

### 7.4 Social 浏览

- Home/Explore/inline comment/media overlay 已对齐产品结构。
- Mobile 只提供单一 heart reaction；Desktop 提供完整 reaction catalog。
- Android/iOS 页面相同，但底层媒体和后台到达不相同。

### 7.5 Social 发布

- Audience 和 Circles 基本对齐。
- 两端产品 UI 当前主要发布 text/image。
- Android camera source 会降质；Mobile video/link/poll/repost/location 仅能读，不能从
  当前 composer 创建。

### 7.6 安全与恢复

- Mobile 运行时 recovery surface 更系统。
- Desktop backup/recovery 管理更完整。
- Mobile 无 safety number，用户无法在移动端完成联系人身份验证闭环。

## 8. 架构根因

### 8.1 iOS canonical policy 泄漏到跨平台实现

表现：

- `ios_first()`；
- `tauri-ios`；
- iOS-only scripts/checks；
- Android optional diagnostics；
- iOS settings URI。

根因不是单个 bug，而是 platform policy 没有从“早期主平台”升级为双平台 contract。

### 8.2 Shared Web UI 被误当成平台能力对齐

页面共享只保证组件树一致，不保证：

- OS back；
- push；
- background；
- permission semantics；
- camera output；
- system settings；
- codec/WebRTC；
- release signing capability。

### 8.3 Desktop/Mobile 共享 Proto，但未共享 portable client core

Chat 和 Private Social 都有两套大体量 Rust engine/store/lifecycle。Proto 只能统一 wire
shape，不能统一：

- durability；
- replay；
- recovery；
- command reconciliation；
- cache purge；
- lifecycle fencing；
- error semantics。

### 8.4 Capability 没有成为产品入口的唯一依据

结果包括：

- Mobile 显示 unavailable safety-number route；
- Mobile 显示永久 disabled share；
- Desktop 有 block command 但无产品入口；
- Desktop 有 Group call，Mobile generated Proto 却无 runtime/UI；
- Group fields 在两端各暴露一部分。

### 8.5 证明矩阵与日常检查矩阵脱节

产品 claim 要求 Android/iOS/Desktop mixed cells，但 package check 只把 iOS 当主门。
因此 acceptance 计划可以很完整，日常合入仍无法防止 Android 回归。

## 9. 建议的长期收敛顺序

### P0-A：建立真实双平台基线

1. 用 native bootstrap 注入 `platform = android | ios`，删除 `ios_first` 和
   `tauri-ios` 常量。
2. 增加 Android init/dev/build/check 和最小安装启动门。
3. 把 Android/iOS 都纳入 required client matrix；不再让 Android 只是 diagnostics。
4. 每个 release capability 输出 source commit、binary digest、platform、signing
   capability projection。

### P0-B：关闭 OS 链路

1. Android：接入 FCM service、token rotation、receipt/tap。
2. iOS：补 APNs entitlement、remote notification/background mode 和签名检查。
3. Android：定义系统 back 的 overlay/detail/root 状态机。
4. Android/iOS：系统设置、share、biometric 全部走 typed platform port。
5. Android：相机改为 full-resolution URI contract，支持 image/video。
6. Android background：建立不依赖 `activeInstance` 的 durable wake handoff。

### P0-C：关闭 Chat 核心差距

1. Mobile group call。
2. Mobile safety number + QR + trust ledger + changed fingerprint recovery。
3. Direct/Group route、badge、settings、message projection 全部归 Messaging runtime。
4. 建立 Desktop<->iOS、Desktop<->Android、iOS<->Android 当前源码 Chat matrix。

### P0-D：抽取 portable client core

1. Messaging engine/store/reconciliation/recovery 抽成共享 Rust crate。
2. Secure Social/private content client 抽成共享 Rust crate。
3. Desktop/Mobile 只保留 host adapter：
   - storage backend；
   - native event loop；
   - secure input；
   - media file；
   - OS lifecycle。
4. 禁止在两端继续平行复制 command/recovery 语义。

### P1-A：统一产品 capability ledger

1. Group avatar、description、nickname、shared content、custom background 形成一个
   canonical descriptor。
2. Chat search 形成 conversation/global/filter 统一 contract。
3. Social reaction catalog 共享，Mobile 采用 bottom sheet 呈现完整集合。
4. Share capability 未就绪前移除 disabled affordance。
5. Desktop 补 block/unblock 产品入口。
6. Mobile 补 recovery backup 管理页。

### P1-B：统一 content intent

1. 删除 Mobile 手写 text/image-only 平行 domain model。
2. 使用 generated canonical intent + capability snapshot。
3. 两端按 capability 暴露 video/link/poll/repost/location 创建入口。

### P2：平台原生感

1. 统一组件树下增加 Android/iOS presentation tokens。
2. Android 使用系统字体、Material motion/elevation/back affordance。
3. iOS 保留当前 safe-area、blur 和 sheet 行为。
4. 所有差异必须是 platform presentation policy，不得复制业务页面。

## 10. 可声明与不可声明

### 当前可以声明

- Mobile Web 的 Infra/Chat/Social 页面和大部分业务 projection 已有实质实现。
- Android/iOS 共享同一 Mobile Web 产品层。
- Secure Storage 的双平台安全语义基本对齐。
- Direct/Group 消息、Group 管理、Social Audience/Circle/private Social 的源码能力
  已较完整。

### 当前不能声明

- Android 与 iOS 发布能力对齐。
- Android push/background/system back/camera 与 iOS 等价。
- iOS APNs/background 已发布可用。
- Mobile 与 Desktop Chat 完整 parity。
- Mobile group call 和 safety verification 可用。
- 当前提交的 Android/iOS/Desktop Social interop 已证明。
- `SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN`。

## 11. 运行环境与 Acceptance 证据

### 11.1 当前设备可用性

- **现场观察，2026-10-16**：`adb devices -l` 没有返回已连接 Android 设备。
- **现场观察，2026-10-16**：本机有 iOS 17.4、26.5 Simulator runtime，但所有
  Simulator 均处于 Shutdown。
- **结论**：本轮可以复核历史 iOS Native evidence，不能执行当前源码的 Android
  物理机 Journey。
- **边界**：历史任务中记录过一台 OPPO 物理机，不代表它在本轮仍可用。设备可用性必须
  以当前 `adb` 结果为准。

### 11.2 现存 iOS Native Social evidence

本机 Acceptance Evidence Store 中存在：

```text
workspaceId: 293b40f94701d443
gateId: mobile-social-ios-native
runId: 20261016T051544149790Z-723e0cfbcccea394dea9921ae823898e
sourceCommit: 4e7c63f488e4dc7e2a133c90be143dc9dfafaaa7
status: passed
completionStatus: DONE
proofStatus: PROVEN
```

该 run 使用：

- 两个独立 iOS 26.5 Simulator；
- Alice/Bob 两个真实 actor session；
- 一个 source-attested Station；
- 一个复用 Suite Runtime；
- 六个 same-Station Social scenarios；
- Appium/XCUITest、Native AX、DOM、截图和 cleanup artifact。

该 evidence **真实证明**的是旧提交 `4e7c63f...` 的 iOS same-Station Social
业务闭环。它的 manifest 明确排除：

- Android；
- cross-Station / Relay delivery；
- Desktop interoperability；
- `SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN`。

当前审计提交为 `a32dce8a...`，因此：

- 旧 run 不能升级为当前源码证明；
- 旧 run 仍可用于审计 Acceptance oracle 是否足以识别产品质量问题；
- 当前 master 的源码修复不能反向修正旧 evidence 中已经观察到的 UI。

### 11.3 Android evidence 缺失

- Evidence Store 中没有 `mobile-social-android-native/latest.json`。
- Evidence Store 中没有 `mobile-social-android-interoperability/latest.json`。
- 当前设备列表没有可执行物理 Android Journey 的设备。
- **Verdict**：Android Social、Desktop/Android 和 iOS/Android 均为
  `UNPROVEN`，不是 `FAILED`，也不是 `BLOCKED/PASSED`。

### 11.4 当前 worktree 的 Acceptance 控制面缺口

以当前 worktree 执行 Gap Detector：

```text
claim: SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN
required gates:
  mobile-social-ios-native
  mobile-social-android-native
  mobile-social-android-interoperability
  mobile-social-desktop-parity-aggregate
```

第一次因 `PT_ACCEPTANCE_ARTIFACT_ROOT` 未绑定而 fail closed；绑定 canonical evidence
root 后，继续因当前 workspace 没有 `acceptance-plan/latest` pointer 而 fail closed。

这说明当前 worktree 尚未挂载可审计的 Acceptance Plan/Run，不只是“有几个 Gate
没跑”。在 Plan pointer 建立前，aggregate claim 没有合法输入。

### 11.5 iOS Gate 的 scenario 实际覆盖

现存 iOS run 执行了：

1. Home/Explore switch；
2. Search/Profile；
3. Circle create + private publish；
4. inline comment + 5 reactions；
5. draft restart + account switch；
6. native layout observation。

业务动作覆盖较实在，但 native quality scenario 实际只记录：

```text
cardCount: 22
circlesLabelled: true
composerLabelled: true
flatFeed: true
pageWidth: 440
scopeWidth: 440
searchLabelled: true
tabCount: 3
viewport: 440 x 956
nativeAxBytes: non-zero
screenshotBytes: non-zero
```

它没有直接断言：

- tab item 几何是否均分；
- 文本与图标是否重叠；
- raw PTID 是否泄露为主视觉；
- keyboard 是否遮挡 composer；
- Dynamic Type 200% 是否可用；
- VoiceOver traversal 顺序；
- reduced motion；
- long locale / long text；
- tap-to-visible P95；
- prototype/production visual contract。

然而 Gate result 的 `spec` 包含 `MPS-PA18`，而 PA18 要求 safe area、keyboard、
long locale/text、screen reader、reduced motion 和 large-list usability。run 自己又把
VoiceOver/TalkBack 放入 `unprovenScope`。

**结论，P0**：该 Gate 对 PA18 的证明范围过宽。业务行为 evidence 可以保留，Native
quality claim 应降为 partial，直到每个质量断言有对应 oracle。

## 12. 真实截图与原型对比

### 12.1 iOS Chat 空状态截图

旧 iOS Native evidence 的 `sim-ios/screenshot.png` 显示：

- Chat 空状态可以正常显示；
- Search 和“Find someone to message”入口可见；
- 但底部四个 tab item 没有均匀占满 viewport，右侧留下大块空白；
- icon、label、active container 挤在左侧，视觉节奏与当前 390px prototype 明显不同；
- 页面主体几乎全空，但 header/search/CTA 的字号和占位高度偏大，信息密度失衡。

当前 Chat prototype 则表现为：

- 四个 tab 等宽占满底部；
- icon 与 label 有稳定间距；
- conversation row、unread、pin/mute 状态都在首屏形成可扫描信息密度；
- header action 与 search 的层级更克制。

这组对比不能证明当前 master 仍有相同缺陷，因为 evidence 对应旧提交；但它能证明：

> “Native screenshot 非空”不足以识别肉眼可见的 tab 几何和产品密度问题。

### 12.2 iOS Moments 截图

旧 iOS Native evidence 的 `sim-ios-peer/screenshot.png` 显示：

- author 主标题直接显示超长 canonical PTID，昵称没有成为主身份；
- Home/Public/Circles 三个顶层 tab 与确认原型的 Home/Explore + 独立 Search/Circles
  入口不一致；
- reaction summary、reaction picker 和 action bar 同时展开，重复占用首屏；
- 默认展开大量 comments，单条 Post 占据多个屏高；
- comment 作者能显示 Bob，但 Post 作者仍暴露原始 PTID，身份表现不一致；
- screenshot 捕获的是 Acceptance 数据状态，不是普通用户的典型 feed。

确认原型则表现为：

- display name 为主、Station/source 为辅；
- Home/Explore 是内容 scope，Circles 是管理入口；
- reaction summary 与操作入口分层；
- 默认 comments 数量受控；
- Post、thread 和 tab bar 都能在一个手机首屏内建立完整信息层级。

### 12.3 Acceptance 通过与用户体验通过不是同一个结论

现存 run 的 native quality oracle 只验证：

- 有截图；
- 有 AX tree；
- 有若干标签；
- feed item 数量有界；
- viewport/scoped container 有宽度。

这些条件可以在 UI 明显偏离原型、身份文案不合格、tab 几何异常时继续 PASS。

因此必须拆开三个 verdict：

1. **Business Journey**：旧提交 iOS same-Station Social 为 `PROVEN`。
2. **Visual/Interaction Alignment**：旧提交为 `FAILED/UNPROVEN`，截图直接显示偏差，
   但没有 formal visual oracle。
3. **Current Source**：`a32dce8a...` 未跑，整体为 `UNPROVEN`。

### 12.4 原型与产品同步的真正断点

当前仓库已有较新的 Mobile prototype evidence，源码也已从旧版
Home/Public/Circles 迁移到 Home/Explore、bottom-sheet composer 和 flat feed。

问题不是“没有原型”，而是：

- Native Gate 没有绑定 prototype revision/hash；
- Gate 不测关键 geometry token；
- screenshot 没有视觉差异判定；
- Acceptance task 的 `doneWhen` 比 runner oracle 更强；
- master 更新后没有自动要求旧 iOS evidence 失效并重跑；
- Android 没有平行 runtime evidence。

## 13. 官方平台基准复核

### 13.1 Android Back

Android 官方要求自定义返回逻辑使用 `OnBackPressedCallback` 或
`OnBackInvokedCallback`，并让 callback 的 enable/disable 跟随 observable UI state；
overlay、screen 和 system back 形成由内到外的 callback stack。[cite:1]

当前 Mobile 已有 overlay/detail/root 状态，但没有 Android Back bridge。源码推断因此
得到官方平台规范支持：

- overlay 打开时应先关闭 overlay；
- detail stack 非空时 pop detail；
- root 才交还系统 back-to-home；
- callback 不能在返回发生后才临时判断。

该问题应保持 P0，而不是普通 Android UI polish。

### 13.2 Android 与 iOS 顶层导航

Material 3 Navigation Bar 建议：

- compact/medium window 使用；
- 3-5 个同等重要目的地；
- destinations 在不同 screen 间保持稳定；
- active destination 有明确 indicator。[cite:2]

Apple HIG 建议：

- Tab Bar 用于顶层导航，不承载 action；
- 保持可见；
- tab 数量尽量少；
- icon + 单词 label；
- tab 不因内容为空而 disable/hide。[cite:3]

Peers 的 Chats/Moments/Contacts/Me 四 tab 在信息架构上同时符合两端原则。真正问题是：

- Android 没有 Material presentation/back behavior；
- iOS historical screenshot 的实际 geometry 未满足稳定均分；
- Settings 被命名为 `Me`，但内部同时承载账号与全局系统设置，信息架构边界仍需明确；
- Acceptance 只数 tab，不验 tab 交互和布局。

### 13.3 Accessibility

Android 官方建议 interactive touch target 至少 `48dp x 48dp`，小于 18sp 的常规文字
对比度至少 4.5:1，并要求所有交互元素有明确语义。[cite:4]

Apple HIG 建议：

- iOS 默认 control size 为 `44 x 44 pt`；
- 支持至少 200% text enlargement 或 Dynamic Type；
- 默认正文约 17pt；
- VoiceOver、contrast、simple gesture 和 gesture alternative 必须真实审计。[cite:5]

当前 Mobile 源码中的 44px header action 在 iOS nominal size 上接近要求，但这不能证明：

- Android 48dp；
- user font scale；
- browser text autosizing；
- AX traversal；
- 大字下 tab/composer 不重叠。

旧 Gate 只检查 AX payload 非空，不能替代 TalkBack/VoiceOver traversal。

### 13.4 Android Photo Picker

Android 官方 Photo Picker：

- 允许用户只授权选中的图片/视频；
- 使用 `PickVisualMedia` / `PickMultipleVisualMedia`；
- unavailable 时才 fallback 到 `ACTION_OPEN_DOCUMENT`；
- 支持 image/video type 和后续 HDR transcoding capability。[cite:6]

当前 Android 实现直接使用 `ACTION_OPEN_DOCUMENT`，相机则读取
`ACTION_IMAGE_CAPTURE` 的 thumbnail。它不是官方推荐的 primary picker chain，
也无法提供等价的原图/视频结果。

### 13.5 Android FCM

Firebase 官方 Android client 要求：

- Google Services configuration；
- `firebase-messaging` dependency；
- manifest 中注册 `FirebaseMessagingService`；
- `onNewToken` 处理初始 token 和 rotation；
- data payload / foreground handling 进入 service。[cite:7]

当前项目只有 `ingestFcmToken` 和 `ingestPushReceipt`，上述 provider 层都不存在。
因此“Android push 未接通”是官方 integration checklist 下的确定结论，不再只是
仓库搜索推断。

### 13.6 iOS APNs

Apple 官方明确要求：

- Xcode 启用 Push Notifications capability；
- 该 capability 产生 `aps-environment` entitlement；
- launch 时注册并取得 token；
- 实现成功和失败 callback；
- token 转发 provider server。[cite:8]

当前代码实现了注册和成功 token hook，但 entitlements 为空，也没有发现失败 callback
处理。因此 APNs 链路是 partial，不是 release-ready。

## 14. 更新后的优先级

### P0：产品真实性

1. 重建 Android 当前源码实机环境；没有设备就保持 `UNPROVEN`。
2. 当前 master 重跑 iOS same-Station，旧提交 evidence 不复用。
3. 修正 Social Gate：PA18 拆成 geometry、keyboard、large text、AX traversal、
   reduced motion、performance 独立 oracle。
4. prototype revision/hash 纳入 Native runtime manifest。
5. screenshot 必须经过自动 geometry/overlap 检查和人工 UX review，不能只验证非空。

### P0：平台链路

1. Android Back callback stack。
2. FCM provider/service/token rotation。
3. iOS APNs entitlement + failure path。
4. Android full-resolution camera / Photo Picker。
5. Android killed-process background reconcile。

### P0：Chat

1. Mobile safety number。
2. Mobile group call。
3. Direct/Group 单一 Messaging owner。
4. 当前源码 Desktop/iOS/Android 双向 receiver proof。

### P1：产品对齐

1. display name 优先，禁止 raw PTID 成为主视觉。
2. Social reaction catalog 统一。
3. Mobile 全局 Chat search。
4. Group avatar/nickname/description/shared-content capability 统一。
5. Desktop block/unblock 入口。
6. disabled share 在 capability 完成前移除。

## 15. 审计结论

当前最危险的误判是把“Mobile 页面能在 Android 工程中编译”当成“Android 产品已经与
iOS 对齐”。源码事实表明，真正决定移动产品可靠性的 OS 链路仍存在多处断点。

Chat 和 Social 的页面能力已经足够深入，下一阶段不应继续以页面补功能为主。长期正确的
工作重点应转为：

1. 双平台 release capability；
2. OS lifecycle/push/back/media 闭环；
3. portable Chat/Secure Social client core；
4. capability-driven product entry；
5. 当前源码绑定的 Android/iOS/Desktop 实机互操作证明。

在这些问题关闭之前，Android 应被视为“业务页面较完整、平台能力未闭环”，而不是 iOS
的等价发布平台。

同时，现存 iOS evidence 说明另一个独立问题：Acceptance 当前能证明部分业务动作，却
不能证明产品 UI 与确认原型一致。后续不能再用 `DONE/PROVEN` 一词同时代替业务正确、
平台正确和体验正确。

## Sources

- [cite:1] Android Developers, Predictive back gesture (accessed 2026-10-16):
  https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
- [cite:2] Material Design 3, Navigation bar (accessed 2026-10-16):
  https://m3.material.io/components/navigation-bar
- [cite:3] Apple Human Interface Guidelines, Tab bars (accessed 2026-10-16):
  https://developer.apple.com/design/human-interface-guidelines/tab-bars
- [cite:4] Android Developers, Make apps more accessible (accessed 2026-10-16):
  https://developer.android.com/guide/topics/ui/accessibility/apps
- [cite:5] Apple Human Interface Guidelines, Accessibility (accessed 2026-10-16):
  https://developer.apple.com/design/human-interface-guidelines/accessibility
- [cite:6] Android Developers, Photo picker (accessed 2026-10-16):
  https://developer.android.com/training/data-storage/shared/photopicker
- [cite:7] Firebase, Set up an Android client for Cloud Messaging
  (accessed 2026-10-16):
  https://firebase.google.com/docs/cloud-messaging/android/client
- [cite:8] Apple Developer Documentation, Registering your app with APNs
  (accessed 2026-10-16):
  https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns

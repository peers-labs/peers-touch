# Mobile Native Plugin Layer

> Mobile platform source for Android / iOS native capability ownership under the Tauri Mobile mainline.
> This document supersedes the former "native dual-platform UI mainline" interpretation. Compose / SwiftUI are no longer the Mobile main UI path.

---

## 1. 文档目标

### 1.1 目标

- 定义 Tauri Mobile 主线下 Android / iOS 原生代码的职责。
- 明确 native plugin 与 mobile-web、mobile-rust、Station、Model 的关系。
- 约束旧 `apps/mobile/android` 与 `apps/mobile/ios` 的迁移用途。
- 约束移动系统能力的权限、事件和业务边界。

### 1.2 非目标

- 不重新定义 Mobile 主线；主线见 `base.md`。
- 不把 Compose / SwiftUI 恢复为主 UI 路径。
- 不定义每个 plugin 的具体 API 细节。
- 不讨论具体页面设计和 UI 组件规范。

---

## 2. 决策基线

Peers Touch Mobile 的当前主线是：

```text
Tauri Mobile Shell
  + mobile-web
  + mobile-rust capability kernel
  + Android / iOS native plugins
  + Station Relay Endpoint
```

Android Kotlin 与 iOS Swift 的职责从“主 UI 实现”调整为“系统能力插件层”：

- Android：Kotlin / Java plugin implementation。
- iOS：Swift plugin implementation。
- UI 主体：Web UI（React / TypeScript）。
- 本地核心：Rust Capability Kernel。

原因：

- UI/UX 统一是 Mobile 当前优先目标。
- Desktop 已形成 Tauri / React / Rust 资产，Mobile 应复用同一套客户端范式。
- 移动系统能力仍需要原生接入，但不要求原生承载主页面。

---

## 3. 系统关系

```text
mobile-web
    |
    | Tauri invoke / event
    v
mobile-rust capability kernel
    |
    | plugin command / event
    v
Android Kotlin plugin / iOS Swift plugin
    |
    | system APIs
    v
Device capability

Shared business truth:
Station

Shared contract truth:
model/domain/*.proto
```

核心约束：

- 共享业务真源在 `Station`，不在 native plugin。
- 共享契约真源在 `model/domain/*.proto`，不在端侧 DTO。
- Native plugin 只暴露设备能力和系统事件。
- Native plugin 不得定义绕过 Station 的私有业务协议。
- Native plugin 事件必须进入 Rust kernel 或 shared runtime，再驱动 UI projection。

---

## 4. 职责分层

```text
Presentation -> Client Runtime -> Rust Kernel -> Native Plugin -> OS
```

### 4.1 Presentation

- 位于 `apps/mobile/src/`。
- 使用 Web UI 承载页面、导航、主题、交互。
- 不直接调用 Android / iOS SDK。

### 4.2 Client Runtime

- 位于 `packages/client-runtime` 或 `apps/mobile/src/runtimes`。
- 负责 session、sync、projection、outbox、event consumption。
- 消费 Rust kernel 或 Station event 产生的事件。

### 4.3 Rust Capability Kernel

- 位于 `apps/mobile/src-tauri/`。
- 负责 Tauri commands、capability permission、plugin registration、event bridge。
- 对 mobile-web 暴露稳定能力接口。

### 4.4 Native Plugin

- Android 使用 Kotlin / Java。
- iOS 使用 Swift。
- 负责系统 API 接入，例如 push、secure storage、deep link、background task、camera、share、biometric、LynxView。
- 不持有跨端业务状态。

---

## 5. 能力矩阵

| 能力 | Android | iOS | 约束 |
| --- | --- | --- | --- |
| Secure Storage | Android Keystore | Keychain | token 不得明文落盘 |
| Push | FCM | APNs | push 只触发提示、stale 标记或 sync |
| Deep Link | Intent filter | URL scheme / Universal Link | 用于 OAuth callback、通知路由 |
| Background Sync | WorkManager | BGTaskScheduler | 只做低频补齐和 outbox flush |
| Camera / Photo | Photo Picker / CameraX | PhotosUI / AVFoundation | 需权限治理 |
| Share | Android Sharesheet | UIActivityViewController | 只承载系统分享 |
| Biometric | BiometricPrompt | LocalAuthentication | 解锁本地敏感操作 |
| Applet Lynx | LynxView plugin | LynxView plugin | 优先 spike 验证 |

---

## 6. 旧原生工程迁移策略

当前仓库可能仍存在：

```text
apps/mobile/
├── android/
└── ios/
```

迁移口径：

- 不再作为主 UI 入口新增业务页面。
- 可作为 native plugin 实现来源或迁移参考。
- 可复用已有网络、存储、Lynx、push、deep link 等系统能力代码，但必须通过 Tauri plugin 边界重新接入。
- 原生端本地 DTO / JSON 结构只能作为兼容层存在，不能反过来定义共享契约。
- 原生页面和 ViewModel 若不再被 Tauri Mobile 使用，应逐步冻结、迁移或删除。

---

## 7. Proto 与契约

### 7.1 唯一契约真源

- 所有跨端共享数据模型先定义在 `model/domain/*.proto`。
- Station、Desktop、Mobile 都消费同一份契约语义。
- Mobile 不允许手工定义“看起来一样”的平行共享模型来替代 proto。

### 7.2 Mobile 生成链

Mobile 迁移到 Tauri 后，生成链应跟随真实消费端重新收敛：

- Rust / TS contract 路径优先服务 `apps/mobile/src-tauri` 与 mobile-web。
- Android / iOS 生成物只在 native plugin 确实需要 proto 类型时保留。
- 旧 `proto-gen-mobile.sh kotlin/swift` 不得继续作为主 UI 模型来源。

具体生成链以 Tauri Mobile spike 与后续 contract 方案为准，但源头必须仍是 `.proto`。

---

## 8. 跨端一致性约束

### 8.1 与 Station 的关系

- Mobile 只能通过 Station 暴露的协议与服务交互。
- 认证、共享业务规则、跨设备一致性由 Station 持有真源。
- Mobile 可以做本地缓存、outbox 和体验优化，但不能把缓存升级为业务真源。

### 8.2 与 Desktop 的关系

- Desktop 与 Mobile 都消费 `model/domain/*.proto` 和 Station 契约。
- Desktop 与 Mobile 共享 UI/UX 范式、runtime projection 思想和 API 语义。
- Desktop 专属窗口、托盘、菜单能力不进入 Mobile shared runtime。
- Mobile 专属 push、camera、biometric、background task 能力不进入 Desktop shared runtime。

### 8.3 与 Applet 的关系

- Mobile Applet 优先通过 Tauri mobile native plugin 承载 LynxView。
- Applet 协议边界由 `Manifest V2` 与 `Bridge V2` 约束。
- Applet 权限裁决必须同时受 Manifest、Tauri capability 和系统权限约束。

---

## 9. 验收标准

- Mobile 主 UI 路径是 `apps/mobile/src` 的 Web UI。
- Native plugin 不直接拥有业务状态。
- Android / iOS 原生代码只作为系统能力层或迁移参考。
- Proto 共享模型始终以 `model/domain/*.proto` 为唯一真源。
- Mobile 不绕过 Station 契约。
- Flutter 目录不再被作为当前实现或未来扩展方向引用。
- Push、secure storage、deep link 等能力必须通过 Tauri plugin 边界暴露。

---

## 10. 继续阅读

- [Mobile Base](./base.md)
- [Applet Container](./applet-container.md)
- [Sync Protocol](./sync-protocol.md)
- [Tauri Mobile Mainline Migration Plan](./execution-plans/20260531-tauri-mobile-mainline-migration.md)
- [Project Architecture](../../global/architecture.md)

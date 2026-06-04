# Tauri Mobile 能力拓扑设计稿

> Status: accepted as platform direction on 2026-05-31; retained as context record
> Owner: Client Architecture
> Created: 2026-05-31
> Layer: context / exploration
> Current source of truth: `docs/client/mobile/base.md`

---

## 1. 文档定位

本文记录 Mobile 转向 Tauri v2 Mobile 主线的方案形成过程。当前正式口径已迁移到 `docs/client/mobile/base.md`：

- Mobile 以 Tauri v2 Mobile 作为主应用壳。
- UI/UX 范式复用 Desktop 的 Web 技术栈、设计系统与运行时投影思想。
- 原生 Kotlin / Swift 不再承担主 UI 范式，而是作为 Tauri mobile plugins 承接系统能力。
- Station 仍是共享业务真源，Model/proto 仍是共享契约真源。

本文位于 `docs/context/`，不作为当前正式架构真源。当前正式口径请阅读：

- `docs/client/mobile/base.md`
- `docs/client/mobile/native-dual-platform.md`
- `docs/client/mobile/applet-container.md`
- `docs/client/mobile/sync-protocol.md`

本方案已被采纳，`base.md` 和 `native-dual-platform.md` 已迁移为“Tauri Mobile 主线 + Native Plugin 能力层”口径。

---

## 2. 背景

原生双端方案已经能满足系统能力接入，但在 UI/UX 上存在长期成本：

- Android Compose 与 iOS SwiftUI 各自实现，难以沉淀统一组件范式。
- Desktop 已经形成 React/TS + Tauri + Rust 的产品心智，Mobile 原生双端会形成第三套体验资产。
- Peers Touch 的核心体验需要跨 Desktop / Mobile 保持连续，包括 Chat、Agent、Search、Timeline、Profile、Applet 和通知。
- Mobile 更像 Desktop 的随身延伸，而不是一个重新设计的独立 App。

因此 Mobile 的优先目标应从“原生技术纯度”调整为：

- 统一 UI/UX 范式。
- 统一客户端 runtime projection 模型。
- 统一工程资产与设计资产。
- 通过原生插件补足移动系统能力。

---

## 3. 核心结论

Mobile 目标形态：

```text
Mobile = Tauri Mobile Shell
       + Shared Web UI
       + Shared Client Runtime
       + Rust Capability Kernel
       + Kotlin / Swift Native Plugins
       + Station Relay Endpoint
```

一句话：

- Mobile 不再是 Android/iOS 两套原生 UI App。
- Mobile 是一套移动端 Tauri App，通过 Web UI 保持体验统一，通过 Rust 与原生插件承接设备能力。

---

## 4. 总体拓扑

```text
┌──────────────────────────────────────────────────────────────┐
│                           Station                            │
│                                                              │
│  Auth / Chat / Timeline / Search / Profile / Agent / Events  │
│  Federation / Policy / Audit / Shared Business Truth         │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               │ Proto-aligned API / Event Stream
                               │ Push Relay / Delta Sync
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Shared Client Layer                       │
│                                                              │
│  client-api       Station API adapter / proto contract glue  │
│  client-runtime   session / sync / projection / outbox       │
│  client-ui        design tokens / components / layout rules  │
│  applet-sdk       Manifest V2 / Bridge V2 / host contract    │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
                ▼                              ▼
┌────────────────────────────┐   ┌─────────────────────────────┐
│          Desktop            │   │           Mobile            │
│                            │   │                             │
│  Tauri Desktop Shell        │   │  Tauri Mobile Shell         │
│  desktop-web                │   │  mobile-web                 │
│  desktop-rust               │   │  mobile-rust                │
│  window / tray / menu       │   │  push / camera / permission │
└────────────────────────────┘   └─────────────────────────────┘
```

---

## 5. 分层设计

| 层级 | 职责 | 推荐归属 |
| --- | --- | --- |
| Product UI | 页面、组件、布局、主题、动效、响应式规则 | `packages/client-ui` + `apps/mobile` |
| Client Runtime | session、sync、projection、outbox、event consumption | `packages/client-runtime` |
| API Adapter | Station API、proto 契约适配、错误码映射 | `packages/client-api` |
| Rust Kernel | Tauri commands、本地状态、安全存储代理、后台任务协调 | `apps/mobile/src-tauri` |
| Native Plugin | push、deep link、camera、photo、biometric、share、background task | Kotlin / Swift plugin |
| Station Truth | 业务状态机、权限、审计、跨端一致性 | `apps/station` |
| Model Truth | 跨端共享契约 | `model/domain/*.proto` |

依赖方向：

```text
UI -> Client Runtime -> API Adapter -> Station
UI -> Tauri Commands -> Rust Kernel -> Native Plugins
Native Plugins -> Rust Kernel -> Client Runtime events
```

禁止方向：

- UI 直接定义跨端业务真源。
- Native plugin 直接绕过 Station 定义私有业务协议。
- Mobile 本地缓存升级为业务裁决来源。
- 为 Mobile 手写与 proto 平行的共享领域模型。

---

## 6. Runtime 拓扑

Mobile 应复用 Desktop 的 runtime projection 思想，但需要适配移动生命周期。

| Runtime | 职责 | 移动端差异 |
| --- | --- | --- |
| `sessionRuntime` | 登录态、JWT 刷新、Actor 切换、secure storage | App 冷启动、前后台恢复时必须重新校验 |
| `syncRuntime` | 冷启动同步、增量同步、事件消费、reconcile | 前台实时，后台依赖 push 和 delta sync |
| `socialRuntime` | 私聊、群聊、好友、未读、receipt、typing | 消息 push 跳转必须能驱动投影刷新 |
| `notificationRuntime` | 系统通知、应用内通知、badge、点击路由 | iOS APNs / Android FCM 通过插件注入事件 |
| `profileRuntime` | 当前用户、peer profile、profile.updated 失效 | 支持离线资料展示与恢复刷新 |
| `searchRuntime` | 搜索、最近访问、联邦广场入口 | 本地只缓存最近项，不拥有搜索真源 |
| `appletRuntime` | Applet 安装、Manifest 校验、Bridge 权限、生命周期 | 需要决定 Lynx 原生插件承载或 WebView 内承载 |
| `deviceRuntime` | 权限、相册、相机、分享、剪贴板、生物识别 | 全部通过 Tauri plugin 能力边界暴露 |

Projection 规则：

- 每个跨端业务状态必须有 Station 真源。
- 每个端侧长期展示状态必须有唯一 runtime owner。
- 页面只读 projection，不靠页面 mount 保持业务新鲜度。
- 实时事件和周期 reconcile 必须同时存在。
- 后台 push 只能作为唤醒和摘要，不替代 authoritative sync。

---

## 7. Mobile Shell 设计

Mobile Shell 负责移动端壳能力，不负责业务真源。

```text
apps/mobile/
├── package.json
├── src/
│   ├── app/
│   ├── pages/
│   ├── routes/
│   ├── runtimes/
│   ├── services/
│   └── styles/
├── src-tauri/
│   ├── capabilities/
│   ├── plugins/
│   ├── src/
│   └── tauri.conf.json
└── gen/
    ├── android/
    └── apple/
```

说明：

- `src/` 是移动 Web UI，不应复制 Desktop 页面树，而应复用共享 UI 与 runtime 后实现 mobile-first shell。
- `src-tauri/` 是移动 Rust kernel，承载 Tauri commands、插件注册、能力权限、事件转发。
- `src-tauri/gen/apple` 是当前 iOS-first spike 中 Tauri mobile 生成的 iOS 工程承载位，不作为业务 UI 主目录。
- 现有 `apps/mobile/android` 与 `apps/mobile/ios` 可作为迁移参考或插件实现来源，但不再作为主 UI 入口。

---

## 8. 共享包拆分

为了避免“直接把 Desktop 打包到手机”，需要先拆共享层。

| 包 | 目标 | 说明 |
| --- | --- | --- |
| `packages/client-ui` | 设计系统与跨端组件 | tokens、基础组件、移动/桌面响应式规则 |
| `packages/client-runtime` | 跨端 runtime projection | session、sync、events、store ownership |
| `packages/client-api` | Station API 与 proto 适配 | 请求封装、错误码、鉴权、cursor sync |
| `packages/client-platform` | 平台能力接口 | desktop/mobile capability interface |
| `packages/applet-sdk` | Applet 宿主协议 | 继续承载 Manifest / Bridge SDK |

拆分原则：

- 共享包只能依赖平台抽象，不能依赖 Desktop 或 Mobile 具体 shell。
- Desktop 和 Mobile 分别实现 platform adapter。
- 共享 runtime 中不能出现窗口、托盘、APNs、FCM 等平台专属概念。
- UI 组件要支持 mobile-first layout，不允许仅做桌面缩放。

---

## 9. 能力域设计

| 能力域 | Mobile Tauri 形态 | 真源 |
| --- | --- | --- |
| Auth | Web UI + Tauri auth/deep-link plugin + secure storage | Station |
| Chat | Shared chat runtime + mobile responsive UI + push resume | Station |
| Group Chat | Shared group projection + mobile list/detail shell | Station |
| Notification | APNs/FCM plugin + notification runtime + badge projection | Station |
| Search | Shared search runtime + mobile launcher / discovery UI | Station |
| Timeline | Web UI + media picker plugin + delta sync | Station |
| Profile | Shared profile runtime + cache + profile.updated invalidation | Station |
| Agent | Shared AI chat UI + streaming event channel | Station |
| Federation | Mobile federation square / station discovery | Station / Federation ledger |
| Applet | Tauri-hosted applet manager + Bridge V2 permission | Station + Applet manifest |
| Settings | Shared settings UI + mobile device preference adapter | Station + local device state |

---

## 10. Native Plugin 能力矩阵

| 能力 | Android 实现 | iOS 实现 | 备注 |
| --- | --- | --- | --- |
| Secure Storage | Android Keystore | Keychain | token 不得明文落盘 |
| Push | FCM | APNs | push 事件只触发 sync，不成为业务真源 |
| Deep Link | Intent filter | URL scheme / Universal Link | 登录回调与通知路由都依赖 |
| Background Sync | WorkManager | BGTaskScheduler | 只做低频补齐和 outbox flush |
| Camera / Photo | Android Photo Picker / CameraX | PhotosUI / AVFoundation | 需权限治理 |
| Share | Android Sharesheet | UIActivityViewController | 端侧交互能力 |
| Biometric | BiometricPrompt | LocalAuthentication | 解锁本地 session / secret |
| Applet Lynx | LynxView plugin | LynxView plugin | 是否保留 Lynx 需 spike 验证 |

插件设计规则：

- 插件只暴露 capability，不暴露业务真源。
- 插件事件必须进入 Rust kernel 或 client runtime，再驱动 UI projection。
- 插件权限需要同时受系统权限和 Tauri capability 约束。
- 插件错误必须映射为统一客户端错误模型。

---

## 11. Applet 方案

Applet 是本方案的最大不确定点，需要单独 spike。

### 11.1 方案 A：Tauri Plugin 承载 LynxView

```text
mobile-web
   |
   | openApplet(appletId)
   v
tauri command
   |
   v
native LynxView plugin
   |
   v
Applet Bundle + Bridge V2
```

优点：

- 延续现有 `applet-container.md` 的 Lynx 方向。
- Bridge V2 可通过 native plugin 精准实现权限隔离。
- Applet 生命周期能跟随原生 view 管理。

风险：

- Web UI 与原生 LynxView 的嵌入关系需要验证。
- 页面导航、层级、返回手势、动画一致性需要额外设计。

### 11.2 方案 B：WebView 内承载 Applet Runtime

```text
mobile-web
   |
   v
Applet host component
   |
   v
Applet Bundle + JS Bridge
```

优点：

- UI 层一致性更高。
- 与 Tauri WebView 页面组合更自然。

风险：

- 偏离 Lynx 容器方向。
- 安全隔离、资源限制、Bridge 权限需要重新评估。

### 11.3 当前建议

优先 spike 方案 A。

理由：

- 不推翻既有 Manifest V2 / Bridge V2 / Lynx 方向。
- Native plugin 正好适合承载系统级隔离容器。
- 如果方案 A 的嵌入体验不可接受，再评估方案 B。

---

## 12. 同步与后台模型

移动端不能假设 WebView 永远活着。

```text
Foreground:
  Event Stream -> syncRuntime -> projection -> UI

Background:
  Push -> native plugin -> Rust kernel -> mark stale / schedule sync

Resume:
  App foreground -> syncRuntime.reconcile("resume") -> delta sync

Offline write:
  UI action -> outbox -> Station retry -> ACK event -> projection
```

约束：

- 前台实时通道用于低延迟。
- 后台 push 用于唤醒和提示。
- 恢复前台必须执行 delta sync。
- outbox 写入必须幂等。
- 本地缓存只能加速展示，不能裁决共享业务状态。

---

## 13. 与 Desktop 的关系

| 维度 | Desktop | Mobile |
| --- | --- | --- |
| Shell | Tauri desktop | Tauri mobile |
| UI | desktop-web | mobile-web |
| Rust | desktop-rust | mobile-rust |
| 系统能力 | window / tray / menu / file | push / camera / permission / biometric |
| Runtime | app/session runtime projection | mobile lifecycle-aware runtime projection |
| Applet | desktop host | mobile host plugin |
| 真源 | Station | Station |

统一点：

- 设计系统统一。
- 业务语义统一。
- Station API 统一。
- runtime projection 思想统一。
- Applet Manifest / Bridge 语义统一。

差异点：

- Shell capability 不统一。
- 页面布局不强行一致。
- 后台模型不统一。
- 系统权限不统一。

---

## 14. 实施阶段

### Phase 0：Spike

目标：验证 Tauri Mobile 对 Peers Touch 是否存在阻断项。

必须验证：

- iOS / Android Tauri app 能启动并加载 mobile-web。
- Station API 能从 mobile-web 或 mobile-rust 正常访问。
- 登录态能写入 secure storage。
- Deep link / OAuth callback 能返回 App。
- 前台 event stream 能驱动 projection。
- APNs / FCM 或替代 push plugin 能注入事件。
- 一个 Chat 页面能在 mobile layout 下跑通。
- Applet Lynx plugin 能否嵌入或打开。

### Phase 1：Shared Client Layer

目标：从 Desktop 中抽出可共享资产，而不是复制 Desktop。

交付：

- `packages/client-ui`
- `packages/client-runtime`
- `packages/client-api`
- platform adapter interface

### Phase 2：Mobile Shell

目标：建立可迭代的 Tauri Mobile 应用壳。

交付：

- `apps/mobile/src`
- `apps/mobile/src-tauri`
- Android / iOS generated projects
- dev/build scripts

### Phase 3：Core Domains

目标：交付 Mobile 最小闭环。

交付：

- Auth
- Chat
- Notification
- Profile
- Settings

### Phase 4：Discovery / Applet / Agent

目标：补齐 Peers Touch 的差异化能力。

交付：

- Search
- Timeline
- Federation Square
- Applet Host
- Agent Chat

---

## 15. 架构验收标准

- Mobile UI 主链路由 Tauri Web UI 承载，而不是 Compose / SwiftUI 双端分别实现。
- 移动系统能力通过 Tauri plugin 暴露，并受 capability 权限约束。
- Station 仍是共享业务真源。
- `model/domain/*.proto` 仍是共享契约真源。
- Mobile 不引入绕过 Station 的私有业务协议。
- Desktop 与 Mobile 共享 UI/Runtime/API 的核心资产，但不共享平台专属 capability。
- 页面不承担长期业务状态新鲜度，projection owner 必须是 runtime。
- 后台 push 与前台 event stream 都必须通过 sync/reconcile 收敛到 Station。

---

## 16. 待决问题

- `apps/mobile/android` 与 `apps/mobile/ios` 是否保留为历史参考，还是迁移为 plugin source？
- Mobile proto 生成是否仍落在 `apps/mobile/android` / `apps/mobile/ios`，还是改为 Tauri mobile 的 Rust/TS contract 路径？
- Applet 是否坚持 Lynx 原生容器，还是允许 WebView 内 applet runtime？
- Desktop 现有 runtime/store 哪些可以抽到 `packages/client-runtime`？
- LobeUI / antd / 自研 mobile component tokens 的边界如何定义？
- Tauri mobile push、secure storage、background task 采用官方、社区还是自研插件？

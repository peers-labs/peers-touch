# Applet Runtime Architecture — 模块布局

> **Status**: draft
> **Version**: v1.1
> **Created**: 2026-05-19 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/desktop/src/applet/`, `apps/mobile/`, `packages/applet-sdk/`, `packages/applets/`

---

## 1. 目录总览

```text
peers-touch/
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── applet/                 # Desktop Lynx Host + manifest scanning
│   │   │   ├── pages/                  # Applet runtime page descriptor
│   │   │   └── services/desktop_api.ts # Tauri command API surface
│   │   └── src-tauri/src/
│   │       ├── interface/contracts/    # Applet invoke / manifest-facing contracts
│   │       ├── interface/tauri_commands/
│   │       ├── application/applets/    # Capability Gateway orchestration
│   │       ├── domain/applets/         # Permission, lifecycle, audit domain rules
│   │       └── infrastructure/applets/ # storage/network/config adapters
│   └── mobile/
│       ├── android/                    # Android LynxView host
│       └── ios/                        # iOS LynxView host
├── packages/
│   ├── applet-sdk/                     # Cross-platform SDK used by applets
│   ├── applet-contract/                # Shared manifest/bridge/capability types
│   └── applets/                        # Built-in applets build pipeline
├── apps/web/ or web host module         # Future formal Web Host if/when repo path exists
└── docs/architecture/applet-runtime/   # This architecture source
```

Applet package producer 不属于 Peers-Touch 架构输入。Peers-Touch 只接收符合 `applet-contract` 的 applet package。

---

## 2. Desktop 模块

### 2.1 `apps/desktop/src/applet/`

目标结构：

```text
src/applet/
├── AppletManager.ts          # discovery, validation, lifecycle metadata
├── LynxHost.tsx              # React wrapper for <lynx-host>
├── lynx-host-element.ts      # Custom Element, wraps <lynx-view>
├── bridge.ts                 # maps Lynx NativeModules calls to desktop_api
├── schema.ts                 # Manifest/index validation
├── types.ts                  # Desktop-facing applet types
└── diagnostics.ts            # validation/runtime diagnostics
```

职责：

- 扫描 `/applets-dist/index.json`。
- 校验 Manifest。
- 创建 `<lynx-host>`。
- 将 `<lynx-host>` 内部挂载到 `<lynx-view>`。
- 将 Lynx Web 的 `onNativeModulesCall` 转发到 `desktop_api.appletInvoke`。
- 上报加载错误、协议错误、权限错误。

禁止：

- 创建 iframe。
- 监听 `window.message` 作为正式 bridge。
- 在前端绕过 Tauri 直接执行敏感能力。

### 2.2 `apps/desktop/src-tauri/src/application/applets/`

目标结构：

```text
application/applets/
├── mod.rs                 # command entry and usecase orchestration
├── gateway.rs             # capability invoke pipeline
├── registry.rs            # capability handler registry
├── session.rs             # applet session lifecycle
├── manifest.rs            # manifest loading / validation adapter
└── audit.rs               # audit event writing
```

职责：

- 作为 Desktop Applet Capability Gateway。
- 按 applet id 和 session id 执行权限校验。
- 统一调用 `storage/network/config/system` handlers。
- 返回统一错误码。
- 写审计日志。

### 2.3 `apps/desktop/src-tauri/src/domain/applets/`

目标结构：

```text
domain/applets/
├── mod.rs
├── capability.rs          # capability and method model
├── permission.rs          # manifest permission rules
├── lifecycle.rs           # applet instance state machine
├── error.rs               # applet domain error codes
└── audit.rs               # audit event model
```

职责：

- 定义 permission 与 capability 的领域规则。
- 定义状态机：`discovered → validated → loading → active → paused → destroyed`。
- 定义不可绕过的不变量。

---

## 3. Mobile 模块

### 3.1 Android

目标结构：

```text
apps/mobile/android/
└── feature/applet/
    ├── AppletContainerView.kt        # Compose wrapper
    ├── LynxViewFactory.kt            # LynxView creation
    ├── AppletBridgeModule.kt         # NativeModule bridge
    ├── AppletCapabilityGateway.kt    # permission + dispatch
    ├── AppletManifestValidator.kt
    └── AppletLifecycleController.kt
```

职责：

- 初始化 Lynx Android 环境。
- 创建并销毁 LynxView。
- 注入 NativeModule bridge。
- 执行 Mobile 本地 capability。
- 与 Station / local cache 协作。

### 3.2 iOS

目标结构：

```text
apps/mobile/ios/
└── Features/Applet/
    ├── AppletContainerView.swift       # SwiftUI wrapper
    ├── LynxViewFactory.swift           # LynxView creation
    ├── AppletBridgeModule.swift        # NativeModule bridge
    ├── AppletCapabilityGateway.swift   # permission + dispatch
    ├── AppletManifestValidator.swift
    └── AppletLifecycleController.swift
```

职责与 Android 对齐，平台差异只存在于 LynxView 接入方式和设备能力适配。

### 3.3 HarmonyOS Reserved

目标结构在 HarmonyOS 正式进入工程前只定义为预留：

```text
apps/mobile/harmony/
└── feature/applet/
    ├── AppletContainer.ets
    ├── LynxViewFactory.ets
    ├── AppletBridgeModule.ets
    ├── AppletCapabilityGateway.ets
    ├── AppletManifestValidator.ets
    └── AppletLifecycleController.ets
```

规则：

- 未有真实 Lynx Harmony adapter 前不得声明已支持。
- Host 必须识别 `harmony` target 并返回 unsupported platform。
- SDK 不为 HarmonyOS 增加私有 API。

---

## 4. SDK 与契约包

### 4.1 `packages/applet-contract/`

跨端契约包，住在 peers-touch 主仓。

```text
packages/applet-contract/
├── src/
│   ├── manifest.ts
│   ├── bridge.ts
│   ├── capability.ts
│   ├── lifecycle.ts
│   └── errors.ts
├── schemas/
│   ├── manifest.schema.json      # 从 TypeScript 类型自动生成
│   ├── bridge.schema.json
│   └── capability.schema.json
├── package.json
└── scripts/
    └── generate-schemas.ts        # ts-json-schema-generator
```

职责：

- 定义 Manifest TypeScript 类型。
- 定义 Bridge envelope。
- 定义 capability method 命名。
- 给 Desktop、SDK、构建工具共享。
- 自动从 TypeScript 类型生成 JSON Schema，供 Mobile 端消费。

**治理规则**：

- **所有权**：`applet-contract` 的变更权属于 peers-touch 主仓，必须经架构 review。
- **消费方式**：Desktop Host 和 SDK 直接 import TypeScript 类型；Mobile Host 消费 `schemas/*.schema.json` 做运行时校验。
- **发布**：每次变更 bump patch 版本；breaking change 需经 ADR 审批。
- **向后兼容规则**：
  - Manifest 字段只增不删。新增字段必须 optional。
  - Bridge method 只增不删。
  - params 只增字段，不改已有字段类型或语义。
  - error code 只增不改已有 code 的含义。
  - 如必须做 breaking change，升级 `bridge.protocol` 字段值（如 `peers-touch.applet.bridge.next`），但不以数字版本号命名。
- **升级顺序**：Host 先升级（向后兼容） → SDK 升级 → Applet 升级。Host 必须能同时服务新旧 Applet。
- **CI 保障**：`packages/applet-contract/scripts/generate-schemas.ts` 在 CI 中运行，生成的 JSON Schema 提交到仓库。Mobile 工程 CI 引用 JSON Schema 做 manifest 校验。

Mobile 可按同一 schema 在 Kotlin / Swift 重写校验逻辑，或由 JSON Schema 生成 Kotlin/Swift 数据类。

### 4.2 `packages/applet-sdk/`

目标结构：

```text
packages/applet-sdk/
├── src/
│   ├── index.ts
│   ├── host.ts               # bridge discovery and invoke
│   ├── adapters/
│   │   ├── lynx.ts           # LynxBridgeAdapter
│   │   ├── host-injected.ts  # HostInjectedBridgeAdapter
│   │   ├── web-host.ts       # WebHostBridgeAdapter
│   │   ├── standalone.ts     # StandaloneBridgeAdapter for non-integrated standalone outlet
│   │   └── wx.ts             # WxBridgeAdapter
│   ├── storage.ts
│   ├── network.ts
│   ├── config.ts
│   ├── system.ts
│   └── errors.ts
└── package.json
```

职责：

- Applet 业务代码唯一依赖入口。
- 启动时自动检测运行时，选择对应 BridgeAdapter。
- 封装 Lynx NativeModules / 注入对象 / 直接 API 调用。
- 提供类型安全的 capability API。
- 统一错误处理。

禁止：

- 依赖 `window.parent`。
- 直接依赖 Browser DOM 作为运行时假设。
- 暴露 Desktop / Android / iOS / HarmonyOS / Web 私有桥接对象。
- Applet 直接 import adapter 实现（只通过 `index.ts` 公开 API）。

---

## 5. Applet 工程模块

标准 Applet 工程结构：

```text
applets/<applet-id>/
├── applet.json
├── lynx.config.ts
├── package.json
├── src/
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   │   └── capability/
│   ├── presentation/
│   └── index.tsx
└── dist/
    └── main.lynx.bundle
```

职责：

- `domain/`：纯业务概念和计算。
- `application/`：用例编排，依赖 capability ports。
- `infrastructure/capability/`：把 applet-sdk 适配成应用层端口。
- `presentation/`：ReactLynx UI。
- `lynx.config.ts`：声明 `web` 与 `lynx` 双构建目标。

---

## 6. 依赖方向

允许：

```text
presentation → application → domain
application → capability port
infrastructure → applet-sdk
applet-sdk → Lynx NativeModules bridge
Host bridge → Capability Gateway
Capability Gateway → platform adapters / Station
```

禁止：

```text
presentation → desktop_api
applet → Tauri API
applet → Android SDK / iOS SDK
applet → Browser DOM as runtime contract
Host frontend → execute permissions without Rust/native Gateway
```

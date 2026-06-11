# Applet Runtime Architecture — 运行时架构

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/desktop/src/applet/`, `apps/mobile/`, `packages/applet-sdk/`

---

## 1. 真实升级目标

本次设计是把历史 Applet 实现升级为正式 Runtime 产品线，不是补几个 SDK 方法。

目标：

- 一套 TypeScript + ReactLynx Applet 源码运行在 Desktop、Android、iOS、HarmonyOS reserved、Web。
- Lynx 是移动端与 Desktop Applet 的主运行时；Web Host 是正式环境，不是 iframe fallback。
- Host 管理 Applet 的加载、生命周期、Bridge、权限、审计和资源治理。
- Applet 业务代码只看到 SDK，不感知平台 Bridge 差异。

非目标：

- 不恢复 iframe runtime。
- 不把 WebView 当作 Mobile Applet 主容器。
- 不允许 Applet 直接调用 Tauri command、Android SDK、iOS SDK、Harmony API 或 Browser privileged API。

---

## 2. 运行时域模型

```text
AppletPackage
  ├── Manifest
  ├── Bundle
  ├── Assets
  └── Integrity

RuntimeHost
  ├── PackageResolver
  ├── RuntimeContainer
  ├── BridgeEndpoint
  ├── SessionController
  ├── LifecycleController
  └── CapabilityGatewayClient

CapabilityGateway
  ├── PermissionGuard
  ├── MethodRegistry
  ├── AuditWriter
  └── PlatformHandlers
```

责任边界：

- `AppletPackage` 是分发产物，不执行能力。
- `RuntimeContainer` 只负责渲染和 Bridge 传输，不做权限最终判定。
- `SessionController` 创建和销毁 Applet session。
- `CapabilityGateway` 是敏感能力唯一执行点。

---

## 3. 平台支持矩阵

| Environment | Container | UI Runtime | Bridge | Gateway owner | 状态 |
|-------------|-----------|------------|--------|---------------|------|
| Desktop | Tauri Webview 内 `<lynx-host>` | Lynx for Web `<lynx-view>` | NativeModules → Tauri command | Desktop Rust | 主线 |
| Android | Tauri mobile native plugin route | Native LynxView | NativeModule Kotlin | Android native / Station client | 主线 |
| iOS | Tauri mobile native plugin route | Native LynxView | NativeModule Swift | iOS native / Station client | 主线 |
| HarmonyOS | reserved native plugin route | Lynx Harmony adapter if available | ArkTS NativeModule | Harmony native / Station client | 预留 |
| Web | Web Host page | Lynx for Web 或 Web Host Renderer | injected host bridge | Web Host BFF / Station | 主线 |

`standalone` 是 applet 的非集成独立运行出口，不等于 Peers-Touch Web Host。正式 Web Host 必须提供 Manifest 校验、session、Bridge、permission、audit 和 network proxy。

---

## 4. 包加载闭环

```text
Host route opens applet
  → PackageResolver resolves manifest and bundle
  → validate manifest target platform
  → verify integrity
  → create session
  → create RuntimeContainer
  → inject runtime context
  → load Lynx bundle
  → Applet SDK reportReady()
  → LifecycleController marks active
```

加载规则：

- `validated` 之前不能创建 RuntimeContainer。
- integrity 失败必须拒载。
- target platform 不匹配必须拒载。
- Host 必须给加载阶段设置超时。
- session id 只能由 Host 创建，不能由 Applet 自行生成。

---

## 5. Desktop Runtime

```text
AppletRuntimePage
  → LynxHost React wrapper
  → <lynx-host applet-id url>
  → <lynx-view url="...main.lynx.bundle">
  → NativeModules.bridge.invoke
  → api.appletInvoke
  → Tauri command
  → Rust Capability Gateway
```

Desktop 职责：

- `apps/desktop/src/applet` 负责 Host UI wrapper、manifest discovery、diagnostics。
- `apps/desktop/src-tauri/src/application/applets` 负责 capability orchestration。
- `apps/desktop/src-tauri/src/domain/applets` 负责 permission、lifecycle、error、audit 规则。

Desktop 禁止：

- iframe。
- `window.parent.postMessage`。
- Applet 直接 import `desktop_api`。
- 前端自行执行 storage/network/config/system 权限。

---

## 6. Android Runtime

```text
Mobile Web route / native plugin command
  → AppletContainerView
  → LynxEngineManager
  → LynxViewFactory
  → LynxView.loadTemplateUrl(bundle)
  → AppletBridgeNativeModule
  → BridgeDispatcher
  → CapabilityGateway
```

Android 职责：

- 管理 Lynx engine 初始化与复用。
- 管理 Applet bundle local cache。
- 将 lifecycle 与 Android activity/app lifecycle 对齐。
- 把 NativeModule 调用统一转入 `BridgeDispatcher`。
- 提供 device、notification、UI 等 Android 平台 handler。

---

## 7. iOS Runtime

```text
Mobile Web route / native plugin command
  → AppletContainerView
  → LynxEngineManager
  → LynxViewFactory
  → LynxView.loadTemplate(bundle)
  → AppletBridgeNativeModule
  → BridgeDispatcher
  → CapabilityGateway
```

iOS 职责与 Android 对齐。SwiftUI / UIKit 只是宿主 UI 技术选择，不能改变 Bridge 和 Gateway 语义。

---

## 8. HarmonyOS Reserved Runtime

HarmonyOS 当前只定义预留契约，不承诺首批落地。

预留规则：

- Manifest platform 使用 `harmony`。
- Runtime type 仍为 `lynx`，如果 Lynx Harmony adapter 不满足要求，则该平台保持不可用。
- Bridge 名称、method、error model 必须与 Android/iOS 一致。
- 不为 HarmonyOS 单独扩展 SDK API；平台能力通过 `system` / `device` 返回差异。

需要验证：

- Lynx Harmony runtime 可用性。
- ArkTS native module 与 JS/Lynx bridge 的传输模型。
- Bundle asset URL、沙箱存储、network proxy、系统权限弹窗。

---

## 9. Web Runtime

Web 是正式支持环境，适用于浏览器访问 Peers-Touch Web Host。

```text
Web Host page
  → validate applet manifest
  → create web applet session
  → load Lynx for Web renderer or Web Host Renderer
  → inject __PEERS_TOUCH_APPLET_HOST__
  → WebHostBridgeAdapter
  → Web Host Gateway / Station BFF
```

Web Host 与 standalone 的区别：

| 项 | Web Host | Standalone |
|----|----------|------------|
| 权限 | Host 强制 | 本地 best-effort |
| 网络 | Host proxy | browser fetch |
| 存储 | per-applet namespace + quota | localStorage |
| 审计 | 必须 | 可选 |
| 分发 | Station applet store | 本地 dev server |
| 适用 | 生产 | 开发调试 |

Web Runtime 禁止使用 iframe 作为正式隔离边界。隔离应依赖 package integrity、capability gateway、CSP、trusted host injection 和可审计 session。

---

## 10. 生命周期状态机

```text
discovered
  → validated
  → loading
  → active
  → hidden
  → active
  → paused
  → active
  → destroying
  → destroyed

invalid / error 可从 discovered、validated、loading 进入。
```

事件映射：

| Runtime event | SDK event | 说明 |
|---------------|-----------|------|
| bundle loaded | `onReady` | Applet UI runtime 创建完成 |
| host visible | `onShow` | 页面/窗口可见 |
| host hidden | `onHide` | 页面/窗口隐藏 |
| app background | `onPause` | Mobile 或 Desktop app 进入后台 |
| app foreground | `onResume` | 恢复 |
| container dispose | `onDestroy` | session 即将失效 |

规则：

- `reportReady()` 是 Applet 主动确认，不等同于 bundle load。
- `destroyed` 后所有 invoke 都返回 `INVALID_SESSION`。
- `hidden` 状态默认允许 storage/config/system，是否允许 network 由 Host 策略决定。

---

## 11. Bridge Envelope

所有平台的传输实现可以不同，但 envelope 语义必须一致。

```typescript
export interface RuntimeInvokeEnvelope {
  protocol: 'peers-touch.applet.bridge'
  version: string
  appletId: string
  sessionId: string
  requestId: string
  method: string
  params?: unknown
  timestamp: number
}
```

Host 处理链：

```text
receive envelope
  → validate protocol
  → validate session
  → parse method
  → call Capability Gateway
  → normalize result/error
  → return envelope response
```

---

## 12. Runtime Verification

每个平台必须提供 contract test：

- manifest target mismatch must fail。
- missing permission must fail。
- invalid session must fail。
- `storage.set/get/remove` roundtrip。
- `network.request` goes through Host proxy。
- lifecycle `ready → active → destroy` observable。
- Host audit event exists for every invoke。

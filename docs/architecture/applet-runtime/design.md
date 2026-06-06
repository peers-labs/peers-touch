# Applet Runtime Architecture — 架构设计

> **Status**: draft
> **Version**: v1.2
> **Created**: 2026-05-19 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/desktop/src/applet/`, `apps/mobile/android/...core/applet/`, `apps/mobile/ios/.../Core/Applet/`, `packages/applet-sdk/`, `packages/applet-contract/`

---

## 1. 核心原则

1. **Lynx-first, not WebView-first**
   - Applet 的 UI 运行在 Lynx Runtime 中，而不是普通 Browser DOM 或 iframe 中。
   - Desktop 通过 Lynx for Web 承载，Mobile 通过原生 LynxView 承载，Web 通过正式 Web Host 承载。

2. **One source, one bundle, all platforms**
   - Applet 前端源码使用 ReactLynx 与 Lynx 元素。
   - Rspeedy 构建产出 **一份** `main.lynx.bundle`，所有平台共用同一产物。
   - Desktop 的 Lynx for Web 和 Mobile 的原生 Lynx Engine 均可消费该 bundle。

3. **Host owns power, Applet owns intent**
   - Applet 可以表达“我要调用 storage/network/config”，但不能直接持有 Host 权限。
   - Host Capability Gateway 是所有敏感能力的唯一执行点。

4. **Protocol stability before feature richness**
   - Manifest、Bridge、Capability、Lifecycle 先稳定，再扩展复杂 UI、市场、远程安装、复杂图表。

5. **No historical runtime fallback**
   - 正式架构不保留 iframe runtime。
   - 正式 Applet 不依赖 `window.parent.postMessage`、React DOM、DOM API、浏览器私有全局对象。

---

## 2. 系统架构

```text
┌────────────────────────────────────────────────────────────────────┐
│                         Applet Source                              │
│                                                                    │
│  ReactLynx components + applet-sdk + business application layer     │
│  No React DOM / no Browser DOM / no iframe assumption               │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ Rspeedy build
                               ▼
               ┌────────────────────────────────────┐
               │      main.lynx.bundle               │
               │  (unified artifact for all hosts)   │
               └──────────────────┬─────────────────┘
                 ┌────────────────┼─────────────────────┐
                 ▼                ▼                      ▼
┌──────────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│ Desktop Host              │ │ Android/iOS Host     │ │ Harmony Host         │ │ Web Host             │
│ <lynx-host>→<lynx-view>  │ │ LynxView (native)    │ │ reserved Lynx adapter│ │ Lynx for Web / host  │
│ Lynx for Web (@lynx-js)  │ │ BridgeNativeModule   │ │ ArkTS bridge         │ │ injected bridge      │
└───────────────┬──────────┘ └──────────┬──────────┘ └──────────┬──────────┘ └──────────┬──────────┘
                │ NativeModules bridge  │ NativeModules bridge  │ reserved             │ injected bridge
                ▼                       ▼                       ▼                      ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Host Capability Gateway                         │
│                                                                    │
│  permission check → session check → audit → capability handler       │
│                                                                    │
│  storage / network / config / notification / system / future APIs   │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                       Station / Local Runtime                       │
│                                                                    │
│  Station owns shared business truth                                 │
│  desktop-rust owns Desktop local runtime and native gateway          │
│  Mobile native host owns device-local capability execution           │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Runtime 分工

| 运行单元 | Owner | 职责 | 禁止事项 |
|---------|-------|------|----------|
| Applet Source | Applet repo | UI、交互意图、业务应用层编排 | 直接依赖 DOM、直接访问 Host 敏感能力 |
| Applet SDK | Platform contract | 暴露稳定跨端 API，封装 Bridge 差异 | 暴露平台私有实现细节 |
| Desktop `<lynx-host>` | Desktop web | 创建 `<lynx-view>`，注入 Desktop bridge，处理错误/生命周期 | 创建 iframe 或自行绕过 Gateway |
| Desktop `desktop-rust` | Desktop runtime | Capability Gateway、权限、审计、本地存储、网络代理 | 把权限判断放回前端 |
| Android Host | Mobile native | 创建 LynxView，注入 NativeModule，执行设备能力 | 让 Applet 直接调用 Android SDK |
| iOS Host | Mobile native | 创建 LynxView，注入 NativeModule，执行设备能力 | 让 Applet 直接调用 iOS SDK |
| HarmonyOS Host | Mobile native reserved | 预留 Lynx Harmony adapter 与 ArkTS bridge | fallback 到 WebView 或跳过 Gateway |
| Web Host | Web platform | 创建正式 Web session，注入 Host bridge，执行 Web Gateway | 把 standalone dev fallback 当成生产 |
| Station | Server truth | 共享业务真源、跨端持久状态、服务端权限 | 被 Applet 直接绕过 Client Gateway 访问敏感内部接口 |

---

## 4. Desktop 渲染链路

```text
AppletRuntimePage
  → LynxHost React wrapper
  → <lynx-host applet-id src>
  → internally creates <lynx-view url="...main.lynx.bundle">
  → injects nativeModulesMap / onNativeModulesCall
  → api.appletInvoke(...)
  → Tauri command applets_invoke
  → Rust Capability Gateway
```

Desktop 的 `<lynx-host>` 是 Peers-Touch 自定义宿主元素。它不是 iframe 容器，而是 Lynx for Web 的平台适配层：

- 负责把 Manifest 的 `load.desktop.entry` 转成 `<lynx-view url>`。
- 负责设置 `browserConfig`、`initData`、`globalProps`。
- 负责接收 `<lynx-view>` 的 `error` 事件并上报诊断。
- 负责把 Lynx NativeModules 调用转入 Tauri Gateway。

---

## 5. Mobile 渲染链路

```text
Native route / Applet page
  → AppletContainerView
  → LynxView
  → load main.lynx.bundle
  → register NativeModule bridge
  → native Capability Gateway
  → Station / local device capability
```

Mobile 和 Desktop 使用相同 Manifest、Bridge、SDK 语义，但宿主实现不同：

- Android 使用 `LynxView` 嵌入 Compose 或原生 View 层。
- iOS 使用 `LynxView` 嵌入 SwiftUI / UIKit 桥接层。
- Bridge module 名称和 method 语义必须与 Desktop 一致。

---

## 6. Applet SDK 接口

Applet SDK 是 Applet 代码唯一允许依赖的宿主能力入口。

```typescript
export interface AppletHost {
  readonly appletId: string
  readonly platform: 'desktop' | 'android' | 'ios' | 'harmony' | 'web' | 'standalone'
  invoke<T>(method: string, params?: unknown): Promise<T>
}

export interface AppletCapabilities {
  storage: {
    get<T>(key: string): Promise<T | null>
    set<T>(key: string, value: T): Promise<void>
    remove(key: string): Promise<void>
  }
  network: {
    request<T>(input: NetworkRequest): Promise<T>
  }
  config: {
    get<T>(key: string): Promise<T | null>
  }
  system: {
    getInfo(): Promise<SystemInfo>
  }
}
```

SDK 内部通过 **BridgeAdapter** 抽象隔离不同运行时的桥接差异：

```typescript
export interface BridgeAdapter {
  invoke<T>(method: string, params?: unknown): Promise<T>
}
```

内置 adapter：

| Adapter | 触发条件 | 实现方式 |
|---------|---------|---------|
| `LynxBridgeAdapter` | 检测到 Lynx NativeModules 存在 | `NativeModules.bridge.invoke(method, params)` |
| `WebHostBridgeAdapter` | 检测到 `globalThis.__PEERS_TOUCH_APPLET_HOST__` | 正式 Web Host 注入对象的 `invoke()` |
| `StandaloneBridgeAdapter` | 以上都不存在（浏览器独立运行） | `fetch` + `localStorage` 直接执行 |
| `WxBridgeAdapter` | 检测到 `wx` 全局对象 | 微信小程序 API 适配 |

SDK 启动时自动检测运行时并选择对应 adapter。Applet 业务代码不感知运行时差异，不直接访问 NativeModules、DOM API 或平台私有对象。

**独立运行模式**：

Applet 可以在纯浏览器中独立运行（开发调试 / 第三方平台）。此时 `StandaloneBridgeAdapter` 生效：
- `network.request` → 浏览器 `fetch`
- `storage.get/set/remove` → `localStorage`
- `config.get` → URL params / 环境变量
- `system.getInfo` → `navigator.userAgent` 构造

这不改变 SDK 对外接口，也不改变 Host 治理模型。独立运行只是"无 Host 时的 best-effort 模式"。

---

## 7. Capability Gateway

Gateway 是 Host 的强制执行点，不是 SDK 的辅助工具。

```text
invoke(applet_id, session_id, method, params)
  → resolve manifest
  → validate session
  → normalize capability + action
  → check permission
  → validate params
  → audit start
  → execute handler
  → audit result
  → return typed response
```

能力粒度应细到 method：

- `storage.get`
- `storage.set`
- `network.request`
- `config.get`
- `notification.show`
- `system.getInfo`

Manifest 中的 `permissions` 是上限，不是自动授权全部细粒度方法。Host 可以继续按平台策略收紧。

---

## 8. UI 与业务分层

Applet 内部仍应保持 DDD / Clean Architecture 风格，但要适配前端运行时：

```text
applet source
├── domain/             # 业务概念、值对象、纯计算
├── application/        # 用例编排，依赖 capability ports
├── infrastructure/     # Applet SDK adapter，不直接碰 Host 私有 API
└── presentation/       # ReactLynx UI
```

跨端 UI 约束：

- 使用 Lynx 元素，不使用 DOM 元素作为基础。
- 第一阶段避免复杂 SVG / DOM Canvas 依赖。
- 图表先以 Lynx 原生布局表达，必要时再引入 Lynx 支持的 Canvas / 自定义元素。
- 交互状态放在 Applet 应用层，跨端持久状态通过 `storage` capability。

---

## 9. Contingency：Lynx for Web 不可用时的降级路径

Lynx for Web 是 Desktop 容器的主线技术。如果 POC 阶段验证出不可接受的兼容性问题（Worker 不可用、WKWebView CSP 冲突、asset URL 不通等），按以下决策树行动：

```text
POC 验证 Lynx for Web in Tauri Webview
  │
  ├── 通过 → 主线落地，无降级
  │
  ├── 部分通过（可 patch）→ 贡献上游修复 / 本地 patch，继续主线
  │
  └── 根本不适用 → 启用 Desktop-only 降级方案
```

**Desktop-only 降级方案（非 iframe）**：

- 容器改为 Shadow DOM 隔离 + dynamic import `main.lynx.bundle`
- Applet 内部调用 `applet-sdk` 不变
- SDK BridgeAdapter 检测到 Web Host Runtime，走 `globalThis.__PEERS_TOUCH_APPLET_HOST__.invoke()` 注入桥接
- Mobile 不受影响，仍然是原生 LynxView
- Bridge/Manifest/Capability 协议不变
- 协议向 Applet 透明：Applet 源码不感知自己在哪种容器里

**关键约束**：

- **任何降级路径都不允许引入 iframe**
- **降级只影响 Desktop 容器层，不影响 SDK、协议、权限模型、Mobile**
- 降级是临时方案，待 Lynx for Web 成熟后必须回到主线

---

## 10. 设计缺点

这个方案不是“最省事”的方案，它的缺点必须被正视：

1. **迁移成本高**
   - 现有 React DOM Applet 不能直接复用 UI 层。
   - Antd、LobeUI、SVG、DOM API 都不能作为 Applet 跨端基础。

2. **Lynx Web 成熟度需要工程验证**
   - Desktop 依赖 Lynx for Web 在 Tauri Webview 中稳定运行。
   - Worker、custom protocol、asset URL、CSP、source map 需要专项验证。

3. **调试链路更复杂**
   - Desktop 用 Web DevTools + Lynx Web 诊断。
   - Mobile 用 Lynx DevTool + 原生调试器。

4. **组件生态较 Web 小**
   - 很多 Web 组件不能直接用。
   - 复杂图表、富文本、编辑器需要重新评估 Lynx 兼容性。

5. **Host 实现成本更高**
   - 三端都要实现 NativeModule / Gateway。
   - 但这是换取安全、跨端一致性和长期治理能力的必要成本。

---

## 11. 适用性边界

适合 Applet 的能力：

- 需要独立页面和交互闭环
- 需要跨 Desktop / Mobile 复用 UI 与逻辑
- 需要 Host 能力但不应直接修改 Host
- 可以接受 Lynx UI 约束

不适合 Applet 的能力：

- 只是一个无 UI 函数调用：应做 Tool
- 只是 Agent 指令或知识：应做 Skill
- 是外部进程工具集：应做 MCP
- 强依赖 Web DOM 生态且无法 Lynx 化：不应进入跨端 Applet 主线

---

## 12. 各端落地状态口径

本节记录当前仓库已有实现线索，不等同于生产完成声明。正式验收以 `runtime-architecture.md`、`service-architecture.md` 和执行计划中的 contract tests 为准。

| Platform | Container | Bridge 注入 | Capability Modules | 状态 |
|----------|-----------|------------|-------------------|------|
| **Desktop** | `<lynx-host>` → `<lynx-view>` | `onNativeModulesCall` → Tauri Gateway | storage, network, config, system (via Rust) | existing implementation, needs formal contract verification |
| **Android** | `AppletContainerView` → `LynxView` | `AppletBridgeNativeModule` → `BridgeDispatcher` | storage, network, config, system, device, notification, UI | existing implementation, needs formal contract verification |
| **iOS** | `AppletContainerView` → `LynxView` | `AppletBridgeNativeModule` → `BridgeDispatcher` | storage, network, config, system | existing implementation, needs formal contract verification |
| **HarmonyOS** | reserved native plugin route | reserved | reserved | reserved, must reject until implemented |
| **Web** | Web Host | injected Host bridge | Gateway-backed capabilities | required by formal architecture |
| **Standalone** | Browser SPA (no host) | `StandaloneBridgeAdapter` | localStorage + fetch | development compatibility only |

### 构建产物统一

```text
applet source (ReactLynx)
    │
    ▼  rspeedy build
main.lynx.bundle  ← 唯一构建产物，所有平台共用
    │
    ├── Desktop: <lynx-view url="applets-dist/{id}/main.lynx.bundle">
    ├── Android: LynxView.loadTemplateUrl("file:///assets/applets/{id}/main.lynx.bundle")
    ├── iOS:     LynxView.loadTemplate(url: bundleUrl)
    └── Web:     Web Host loads the same Lynx bundle through Lynx for Web
```

### Bridge 通信统一

```text
Applet code → sdk.storage.get("key")
    │
    ▼  AppletSDK internal
adapter.invoke("storage.get", { key: "..." })
    │
    ├── LynxBridgeAdapter: NativeModules.bridge.invoke({ method, params })
    ├── WebHostBridgeAdapter: globalThis.__PEERS_TOUCH_APPLET_HOST__.invoke(...)
    ├── StandaloneBridgeAdapter: localStorage.getItem(key)
    │
    ▼  Host side (Desktop / Android / iOS / HarmonyOS reserved / Web)
Capability Gateway → permission check → execute → return result
```

### Web 与 HarmonyOS 口径

- Web 是正式 Host，必须实现 session、permission、audit、network proxy。
- Standalone 是 applet 的非集成独立运行出口，不能作为 Peers-Touch integrated 的生产安全边界。
- HarmonyOS 是 reserved platform；如果 Host 未实现，manifest target 为 `harmony` 的 Applet 必须明确拒载。

### 验证脚本

```bash
# Build any applet
./tooling/scripts/build-applet.sh <source-dir> <applet-id>

# Desktop full check
cd apps/desktop && pnpm run check && pnpm run build

# Android
cd apps/mobile/android && ./gradlew build

# SDK
cd packages/applet-sdk && npx tsc --noEmit
```

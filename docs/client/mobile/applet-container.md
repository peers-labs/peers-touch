# Applet 容器设计（Mobile 端）

> Mobile 主线已迁移为 Tauri v2 Mobile。本文采用 `@peers-touch/applet-contract` 的 canonical manifest 与 `peers-touch.applet.bridge` 协议；历史 Bridge V2 / Manifest V2 术语仅作为兼容背景，不再作为新实现目标。Android / iOS 原生集成方式应通过 Tauri mobile native plugin 承载，而不是 Compose / SwiftUI 主 UI 直接嵌入。

## 1. 文档目标

### 1.1 目标
- 定义 Tauri Mobile 下通过 Android / iOS native plugin 集成 Lynx 引擎、运行 Applet 的容器架构。
- 明确 Native Bridge 在 Kotlin / Swift 各自的实现方案。
- 说明 Applet SDK、canonical manifest、canonical bridge 协议在 Mobile 端的复用策略。
- 与 Desktop 端的 `<lynx-host>` 方案形成对比参照。

### 1.2 非目标
- 不讨论 Applet 业务开发指南与 SDK API 细节。
- 不讨论 Applet 审核与分发流程。
- 不替代 Lynx 引擎本身的技术文档。

---

## 2. 架构总览

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Applet Runtime                            │
│                                                                  │
│  ┌───────────────────────┐    ┌───────────────────────┐         │
│  │   Applet Bundle (TS)   │    │   Applet Bundle (TS)   │  ...   │
│  │   @peers-touch/        │    │   @peers-touch/        │        │
│  │   applet-sdk           │    │   applet-sdk           │        │
│  └──────────┬────────────┘    └──────────┬────────────┘         │
│             │ Canonical bridge             │ Canonical bridge      │
│  ┌──────────┴────────────────────────────┴────────────┐         │
│  │              Lynx Engine (Native SDK)               │         │
│  │         Android: LynxView (Maven)                   │         │
│  │         iOS:     LynxView (CocoaPods)               │         │
│  └──────────┬─────────────────────────────────────────┘         │
│             │ Native Bridge (invoke)                             │
│  ┌──────────┴─────────────────────────────────────────┐         │
│  │              Tauri Host Capabilities                 │         │
│  │  Storage / Network / Notification / System / Chat    │         │
│  └─────────────────────────────────────────────────────┘         │
│                                                                  │
│  ┌─────────────────────────────────────────────────────┐         │
│  │              Applet Manager                          │         │
│  │  扫描 → 校验 Manifest → 加载 → 生命周期管理          │         │
│  └─────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Lynx 引擎集成方案

### 3.1 Android 集成

依赖引入：
```kotlin
// build.gradle.kts (feature:applet)
dependencies {
    implementation("com.lynx:lynx-android-sdk:${lynxVersion}")
}
```

集成方式：
- `LynxView` 由 Tauri mobile Android plugin 承载，需要时通过插件 view / native route 暴露给 mobile-web。
- 每个 Applet 实例对应一个独立的 `LynxView`，隔离 JS 运行时上下文。
- Lynx SDK 通过 Maven Central 或内部 Maven 仓库分发。

生命周期绑定：
- `LynxView` 的创建与销毁跟随 Tauri plugin / native route 生命周期。
- 当 Applet 页面离开导航栈时，`LynxView` 进入 `pause` 状态；页面销毁时执行 `destroy`。
- Activity 级别的 `onTrimMemory` 回调中，对后台 Applet 执行内存释放。

### 3.2 iOS 集成

依赖引入：
```ruby
# Podfile (PeersTouch target)
pod 'LynxSDK', '~> x.y.z'
```

集成方式：
- `LynxView` 作为 `UIView` 子类，由 Tauri mobile iOS plugin 承载，需要时通过插件 view / native route 暴露给 mobile-web。
- 每个 Applet 实例对应一个独立的 `LynxView`，隔离 JS 运行时上下文。
- Lynx SDK 通过 CocoaPods 分发（后续可迁移至 SPM）。

生命周期绑定：
- `LynxView` 的创建与销毁跟随 Tauri plugin / native route 生命周期。
- 当 Applet 页面不可见时，`LynxView` 进入 `pause` 状态；页面被移除时执行 `destroy`。
- 收到 `didReceiveMemoryWarning` 时，对后台 Applet 执行内存释放。

---

## 4. Native Bridge 实现

### 4.1 Bridge 协议回顾

Applet 内部的 JS 代码通过 `@peers-touch/applet-sdk` 调用宿主能力。SDK 在 Lynx 运行时内通过以下优先级查找 Native Bridge：

```typescript
interface LynxNativeModules {
  bridge: {
    invoke?: (payload: { method: string; params?: Record<string, unknown> }) => unknown | Promise<unknown>
    call?: (
      name: string,
      data: { method: string; params?: Record<string, unknown> },
      callback: (result: unknown) => void,
    ) => void
  }
}

interface LynxRuntime {
  requireModule?(name: string): LynxNativeModules['bridge'] | undefined
  getJSModule(name: string): {
    addListener(topic: string, handler: (payload: unknown) => void): void
    removeListener(topic: string, handler: (payload: unknown) => void): void
  }
}
```

所有通信均通过统一的 `invoke(method, params)` 接口完成，method 命名空间示例：
- `system.getInfo` → 获取系统信息
- `storage.get` / `storage.set` / `storage.remove` → 本地存储操作
- `network.request` → 网络请求代理
- `ui.showToast` → 展示 toast

### 4.2 Android Native Bridge 实现

```kotlin
class AppletNativeBridge(
    private val appletId: String,
    private val capabilities: AppletCapabilities
) {
    fun invoke(method: String, params: Any?): Any? {
        val (module, action) = method.split(".", limit = 2)
        return when (module) {
            "system"       -> capabilities.system.handle(action, params)
            "storage"      -> capabilities.storage.handle(action, params)
            "network"      -> capabilities.network.handle(action, params)
            "notification" -> capabilities.notification.handle(action, params)
            else           -> throw UnsupportedOperationException("Unknown module: $module")
        }
    }
}
```

注入方式：
- 在 `LynxView` 初始化时，通过 Lynx SDK 提供的 `registerModule` / `addJavascriptInterface` 机制将 Bridge 实例注入到 JS 全局作用域。
- 注入对象必须暴露为 `NativeModules.bridge` 或 `lynx.requireModule('bridge')`，并返回 canonical response envelope。
- 每个 Applet 实例拥有独立的 Bridge 实例，权限校验基于 Manifest 声明的 `permissions`。

### 4.3 iOS Native Bridge 实现

```swift
class AppletNativeBridge {
    let appletId: String
    let capabilities: AppletCapabilities

    func invoke(method: String, params: Any?) -> Any? {
        let parts = method.split(separator: ".", maxSplits: 1)
        guard parts.count == 2 else { return nil }
        let (module, action) = (String(parts[0]), String(parts[1]))
        switch module {
        case "system":       return capabilities.system.handle(action, params: params)
        case "storage":      return capabilities.storage.handle(action, params: params)
        case "network":      return capabilities.network.handle(action, params: params)
        case "notification": return capabilities.notification.handle(action, params: params)
        default:             return nil
        }
    }
}
```

注入方式：
- 在 `LynxView` 初始化时，通过 Lynx SDK 提供的原生模块注册机制将 Bridge 实例注入。
- 注入对象必须暴露为 `NativeModules.bridge` 或 `lynx.requireModule('bridge')`，并返回 canonical response envelope。
- 权限校验逻辑与 Android 一致。
- iOS `LynxViewFactory` 必须为每个 Applet view 创建 session-scoped `LynxConfig`，用当前
  `AppletBridgeSession` 注册 `AppletBridgeNativeModule`；不得只加载 bare `LynxView`，也不得把 session param
  写进共享 engine config 后复用给多个 Applet。

---

## 5. Applet SDK 复用

### 5.1 零修改原则

`@peers-touch/applet-sdk`（位于 `packages/applet-sdk/`）是 Applet 开发者使用的统一 SDK，运行在 Lynx JS 运行时内。该 SDK 的设计特点：

- **平台无关**：SDK 只依赖 Lynx `NativeModules.bridge` / `lynx.requireModule('bridge')` 形态，不依赖任何平台特有 API。
- **协议驱动**：所有宿主能力调用通过 `invoke(method, params)` 完成，SDK 不感知底层是 Desktop 还是 Mobile。
- **无需修改**：Mobile 端只需在原生侧正确实现 Native Bridge 并注入到 Lynx 全局作用域，SDK 即可正常工作。

### 5.2 平台差异适配

部分 SDK API 在不同平台可能返回不同的值，但接口契约不变：

| SDK 调用 | Desktop 返回 | Android 返回 | iOS 返回 |
| --- | --- | --- | --- |
| `system.getInfo().platform` | `'desktop'` | `'android'` | `'ios'` |
| `system.getInfo().os` | `'windows'`/`'macos'`/`'linux'` | `'android'` | `'ios'` |
| `system.getInfo().statusBarHeight` | `undefined` | 状态栏高度（px） | 状态栏高度（pt） |

Applet 开发者可通过 `sdk.system.getInfo().platform` 判断平台，实现自适应布局。

---

## 6. Applet Manifest 协议复用

### 6.1 Manifest 结构

Mobile 端复用 `@peers-touch/applet-contract` 定义的 canonical manifest，关键字段：

```json
{
  "id": "example-applet",
  "name": "Example Applet",
  "version": "1.0.0",
  "targets": ["desktop", "android", "ios"],
  "entries": {
    "lynx": "main.lynx.bundle"
  },
  "load": {
    "android": { "type": "lynx-native", "entry": "main.lynx.bundle" },
    "ios": { "type": "lynx-native", "entry": "main.lynx.bundle" },
    "desktop": { "type": "lynx-web", "entry": "main.lynx.bundle" }
  },
  "bridge": {
    "protocol": "peers-touch.applet.bridge",
    "version": "1.0.0"
  },
  "permissions": ["app.getContext", "network.request", "storage.get"],
  "services": [
    {
      "id": "primary-api",
      "kind": "http",
      "binding": "station-resolved",
      "allowedMethods": ["GET", "POST"],
      "allowedPaths": ["/api/v1/*"]
    }
  ],
  "skills": [],
  "integrity": {
    "algorithm": "sha256",
    "files": {
      "main.lynx.bundle": "sha256:..."
    }
  }
}
```

### 6.2 Mobile 端相关字段

- `targets`：Applet 声明支持的平台列表。Android 只加载包含 `"android"` 的 Applet；iOS 只加载包含 `"ios"` 的 Applet。`targetPlatforms` 仅作为历史兼容输入，不能作为新协议主字段。
- `load.android` / `load.ios`：Mobile 原生 LynxView 加载配置，`type` 必须为 `"lynx-native"`。
- `entries.lynx`：集成 Lynx bundle 入口，必须被 `integrity.files` 覆盖。
- `services`：Host-controlled network/service binding 声明，Applet 不能直接传 raw URL。
- `skills`：声明式 skill schema，schema 文件必须被 `integrity.files` 覆盖。
- `integrity`：包内关键文件 SHA-256 摘要，移动端加载前必须校验或保持与平台 gate 一致。
- `minPlatformVersion`：Mobile 端与 Desktop 端独立维护版本号，各自校验兼容性。
- `permissions`：权限校验逻辑在 Native Bridge 层实现，使用完整 capability method，例如 `network.request`、`storage.get`、`ai.chat`。

### 6.3 Manifest 校验

Mobile 端应复用 `@peers-touch/applet-contract` 的语义（或按同一规则在原生端重新实现）：
- `id` 为非空 DNS-like 小写标识。
- `version` 匹配 SemVer。
- `targets` 必须非空，且 Android/iOS 仅加载对应平台 target。
- `load.<platform>.type` 必须匹配平台：Android/iOS/Harmony 为 `lynx-native`，Desktop/Web 为 `lynx-web`，Standalone 为 `web-spa`。
- `bridge.protocol` 必须为 `peers-touch.applet.bridge`。
- `network.request` 权限要求至少一个 `services` 声明。
- `integrity.files` 必须包含 `entries.lynx` 以及所有 skill schema。

---

## 7. Canonical Bridge 协议原生实现

### 7.1 协议结构

Canonical bridge 协议（`peers-touch.applet.bridge`）定义了 Applet 与宿主之间的通信信封：

```typescript
{
  protocol: 'peers-touch.applet.bridge',
  kind: 'response' | 'event',
  appletId: string,
  sessionId: string,
  requestId: string,
  ok?: boolean,
  result?: unknown,
  error?: {
    code: 'PERMISSION_DENIED' | 'INVALID_PARAMS' | 'CAPABILITY_FAILED' | string,
    message: string,
    requestId?: string
  },
  event?: string,
  payload?: unknown,
}
```

### 7.2 原生端处理流程

1. **session 阶段**：宿主校验 manifest 合法性，创建 `AppletBridgeSession`，绑定 `appletId/sessionId/permissions`。
2. **运行阶段**：Applet 通过 SDK 调用宿主能力，宿主返回 canonical response envelope，并通过 canonical event envelope 向 Applet 推送事件。
3. **销毁阶段**：宿主发送 `destroy` 事件，Applet 执行清理，宿主回收 LynxView 与 Bridge 实例。

### 7.3 Android 实现要点
- Bridge response/event envelope 序列化/反序列化使用平台 JSON 能力，错误码必须使用 canonical applet error code。
- Bridge 消息通过 Lynx SDK 的 `evaluateJavascript` 从宿主推送到 Applet。
- 宿主侧维护 `Map<String, AppletBridgeSession>` 管理各 Applet 的 Bridge 会话。
- Android runtime release evidence 入口必须在 Tauri Android native plugin 落地后重建；旧 `apps/mobile/android` standalone APK 已删除，不能再作为验收宿主。
- Tauri plugin 宿主加载前必须扫描本地 applet bundle，并把 `load.android.entry` 解析为 app sandbox 中的实际 bundle URL，而不是只把相对 entry 传给 Lynx。
- 最终 Android E2E 必须通过 Tauri Mobile app/plugin 在真实 emulator/device 中打开 applet route，并且只有在 `AppletBridgeNativeModule` 观察到 SDK canonical marker 后才能写出 release evidence。

### 7.4 iOS 实现要点
- Bridge response/event envelope 序列化/反序列化使用 `Codable` / dictionary bridge，错误码必须使用 canonical applet error code。
- Bridge 消息通过 Lynx SDK 的 JS 执行接口从宿主推送到 Applet。
- 宿主侧维护 `[String: AppletBridgeSession]` 字典管理各 Applet 的 Bridge 会话。
- iOS runtime release evidence 入口必须在 Tauri iOS native plugin 落地后重建；旧 `apps/mobile/ios/PeersTouch` standalone App 已删除，不能再作为验收宿主。
- 最终 iOS E2E 必须通过 Tauri Mobile app/plugin 在 Simulator/device 中打开 applet route，并且只有在 `AppletBridgeNativeModule` 观察到 SDK canonical marker 后才能写出 release evidence。

---

## 8. Applet 生命周期管理

### 8.1 生命周期状态机

> **唯一真源**：跨端七态状态机冻结在 `packages/applet-contract/src/lifecycle.ts:22-29`（状态 union）与 `:113-124`（`TRANSITION_RULES`）。Mobile **不重新定义状态**，本节仅镜像契约。历史的 `discovered/validated/loading/active/invalid` 命名已废弃（Manifest 扫描/校验属于 catalog 层，不是实例生命周期态）。参照架构真源 [`applet-lifecycle-architecture.md §3`](../../architecture/applet-runtime/applet-lifecycle-architecture.md) 与落地子计划 [`execution-plans/2026-07-03-applet-kernel-mobile-native-buildout.md §5.3`](./execution-plans/2026-07-03-applet-kernel-mobile-native-buildout.md)。

```text
  cold → materializing → visible ⇄ hidden-warm → suspended → destroyed
                            │  ▲        │  ▲          ▲
                          pause│      pause│        restore│
                            ▼  │resume    ▼  │suspend      │
                          paused ─────────────────────────┘
```

状态说明（`lifecycle.ts:22-29`）：
- `cold`：尚未实例化，再次打开即冷启动。
- `materializing`：`launch`（`cold → materializing`）后，Bundle 拉取 + capability session 建立中。
- `visible`：`ready`（`materializing → visible`）后 LynxView 可见运行。冷启首帧直接 `applySurfaceCommand('show')` 挂载，**不 dispatch `show`**（`show` 合法源不含 `visible`，见 §5.3 子计划）。
- `hidden-warm`：`hide`（`visible → hidden-warm`）后 LynxView 保活（保留实例，切回不重载）。
- `paused`：`pause`（源 `visible | hidden-warm`）后 timer/rAF 冻结（App 后台 / 系统 idle）；`resume` 回到 `visible` 或 `hidden-warm`。
- `suspended`：`suspend`（源 `hidden-warm | paused`）后释放渲染资源、保留最小状态，`restore` 快速恢复。
- `destroyed`：`destroy`（任意非 `cold`/`destroyed` 态可达）后完全回收，再次打开是冷启。

`error` 与 `memory-pressure` 是**喂给 Kernel 的信号**，会被解析为 `destroy`/`suspend` 转换，不是独立目标态（`lifecycle.ts:44-58`）。合法转换校验以 `isValidTransition`（`lifecycle.ts:147`）为准，非法转换一律拒绝。

### 8.2 AppletManager 职责

扫描：
- 启动时从本地缓存目录扫描已安装的 Applet（读取 `applet.json` manifest）。
- 定期或事件驱动从 Station 同步 Applet 安装列表与版本信息。

加载：
- 校验 Manifest → 创建 LynxView → 注入 Native Bridge → 加载 Bundle Entry。
- 加载超时（建议 10s）自动标记为 `error`。

卸载：
- 发送 `destroy` 事件 → 等待 Applet 清理（500ms 超时） → 销毁 LynxView → 清理缓存文件。

### 8.3 多实例与资源策略

> 资源策略以契约为准：`MOBILE_RESOURCE_POLICY`（`packages/applet-kernel/src/policy.ts:25-31`），回收决策由 `ResourceScheduler`（`resource-scheduler.ts`）统一裁决，AppletManager/容器不自行淘汰。

- 同一个 Applet ID 同一时间只允许一个活跃实例（`instanceId` 维度，与 Desktop 行为一致）。
- LRU 保活上限 `lruSize = 3`（Mobile 比 Desktop 的 4 更紧，唯一差异）；超出时最旧 `hidden-warm` 实例被 `suspend`。
- `suspended` 上限 `maxSuspended = 8`，超出时最旧 `suspended` 被 `destroy`。
- TTL：`hidden-warm` 30min → `suspended`；`suspended` 120min → `destroyed`；`paused` 15min → `suspended`。
- 内存压力（`resource-scheduler.ts:128-158`）：`moderate` 销毁最旧 `suspended`；`critical` 销毁所有非 `visible` 实例。

---

## 9. 与 Desktop `<lynx-host>` 方案对比

| 维度 | Desktop (`<lynx-host>`) | Mobile (LynxView Native) |
| --- | --- | --- |
| 渲染容器 | Web Component `<lynx-host>` 内嵌于 Webview | `LynxView` 原生 View 直接嵌入布局 |
| JS 运行时 | Lynx 引擎在 Web 环境中运行 | Lynx 引擎在原生环境中运行 |
| Bridge 注入 | 通过 Web Component 的 JS 桥接层注入 | 通过 Lynx SDK 原生模块注册机制注入 |
| 渲染性能 | 受 Webview 渲染管线约束 | 直接使用平台原生渲染管线 |
| 内存隔离 | 同进程内多 Applet 共享 Webview 内存池 | 每个 LynxView 独立内存空间 |
| 调试方式 | Chrome DevTools | Android Studio Debugger / Xcode Debugger + Lynx Inspector |
| SDK 兼容性 | 完全一致（`@peers-touch/applet-sdk`） | 完全一致 |
| Manifest 协议 | Canonical manifest | Canonical manifest |
| Bridge 协议 | Canonical bridge (`peers-touch.applet.bridge`) | Canonical bridge (`peers-touch.applet.bridge`) |

关键结论：
- **协议层完全一致**：SDK、Manifest、Bridge 三层协议在 Desktop 与 Mobile 之间零差异，Applet 开发者无需为不同平台维护不同版本。
- **渲染层差异透明**：Desktop 使用 Web Component 包装，Mobile 使用原生 View 嵌入，差异被 Lynx 引擎抽象屏蔽。
- **性能上限不同**：Mobile 端 LynxView 直接走原生渲染管线，理论性能上限高于 Desktop 的 Webview 内嵌方案。

---

## 10. Applet Bundle 分发与更新

### 10.1 分发通道
- 首次安装：从 Station Applet Store 服务下载 Bundle（ZIP 包含 manifest + entry + assets）。
- 增量更新：Station 提供 Bundle 版本 diff，客户端增量 patch（若 diff 不可用则全量下载）。
- 内置 Applet：随 App 安装包预置常用 Applet Bundle，避免首次启动时的下载等待。

### 10.2 本地缓存结构
```text
{app_data}/applets/
├── {applet-id}/
│   ├── applet.json              # Manifest
│   ├── index.html               # Entry
│   └── assets/                  # 静态资源
└── index.json                   # 已安装 Applet 索引
```

### 10.3 缓存策略
- 已安装的 Applet Bundle 持久化存储，App 更新时不清理。
- Station 推送版本变更事件时触发后台更新，用户无感知。
- 缓存空间上限（建议 200MB），超限时按 LRU 策略清理未使用的 Applet。

---

## 11. 验收标准
- Android 与 iOS 均能正确加载、运行、销毁 Applet，生命周期事件完整。
- `@peers-touch/applet-sdk` 在 Mobile 端的 API 行为与 Desktop/Web Host 的 canonical contract 一致。
- Canonical bridge response/event envelope 在双端均可正确序列化与处理，错误码不回退到平台私有 `BRIDGE_*`。
- Manifest 校验逻辑与 Desktop/Web Host 行为一致（相同的合法/非法 manifest 得到相同的校验结果）。
- Native manifest/bridge session 行为必须有可执行 gate：iOS 通过 Swift harness，Android 通过 SDK 环境下的 JVM contract test；没有 Android SDK 的本地 run 只能记录 SKIP，不能当作 Android runtime E2E。
- Release 级 native runtime evidence 必须来自 `applet-ios-lynx-runtime-e2e` / `applet-android-lynx-runtime-e2e` 的真 simulator/emulator/device marker，不得用 source parity scan 或 JVM/Swift harness 代替。
- 同一个 Applet Bundle（`targets` 包含 `desktop`、`android`、`ios`）可以在 Android、iOS、Desktop 三端无修改运行。

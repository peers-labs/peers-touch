# Applet Kernel — Mobile Native 落地子计划

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-03 | **Updated**: 2026-07-03
> **Owner**: Mobile Team
> **Depends on**:
> - 父计划：[`applet-runtime-lifecycle-buildout.md`](../../../architecture/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md)（§5 实现位置、§7 Phase 3b Mobile、§8 验收）
> - 状态机权威：[`applet-lifecycle-architecture.md`](../../../architecture/applet-runtime/applet-lifecycle-architecture.md)（§3 七态状态机、§5 资源策略、§10 数据模型）
> - 平台契约：[`applet-container.md`](../applet-container.md)、[`docs/.agent/mobile.md`](../../../.agent/mobile.md)

---

## 1. 定位

本文是父计划 **Phase 3b: Mobile — Native Lynx Lifecycle** 的落地子计划，只做文档落盘，不写任何 Kotlin/Swift/TS 代码。

核心事实（决定本计划形态，必须准确反映，不可臆造）：

- **Mobile 必须用 Kotlin/Swift 原生重实现 Kernel。** 原生 `LynxView` + `Activity`/`Scene` 生命周期 + `onTrimMemory`/`didReceiveMemoryWarning` 从 Tauri webview 的 JS 侧**不可达**，因此 `packages/applet-kernel` 的 TS 内核不能作为 Mobile 运行时依赖。
- **TS Kernel 是冻结契约的真源，不是运行时依赖。** `apps/mobile` 对 `@peers-touch/applet-kernel` / `@peers-touch/applet-contract` **零依赖**（已核验 `apps/mobile/package.json` dependencies 不含二者）。Mobile 原生实现按 TS 契约逐条对齐语义，而非引入包。
- Desktop 侧（`packages/applet-kernel` + `apps/desktop/src/applet/kernel/*` + `apps/desktop/src/runtimes/appletsRuntime.ts`）是**参照实现**：Mobile 原生实现应做到与它的事件语义/surface 语义逐条对齐。

本计划的产出是**原生契约蓝图 + 分平台任务拆解 + 收敛项 + 验收**，为后续 Kotlin/Swift 落地提供唯一权威依据。用户已明确：在本蓝图落盘前，暂不进行原生编码。

---

## 2. Host Decision（宿主形态，已裁决）

> **裁决（2026-07-03）**：Mobile Kernel 与 LynxView 集成采用 **Tauri native plugin 承载**。Android Kotlin / iOS Swift 只作为 native plugin 实现层，不作为独立主 UI 主线。该选择对齐 `docs/.agent/mobile.md §3` 与 `applet-container.md §3`，也消除 standalone 原生 App 成为第二跨端真源的风险。

**冲突事实**：

- 现状：`apps/mobile/android` 与 `apps/mobile/ios` 是**独立的原生 App 工程**（Android 有 Hilt/Compose 主 UI，iOS 有 SwiftUI 主 UI；见 §4）。
- 契约：`docs/.agent/mobile.md` §3 与 `applet-container.md` §3 规定 Mobile 主线是 **Tauri v2 Mobile**（共享 Web UI + Rust capability kernel + Android/iOS **native plugin** 层），Android Kotlin / iOS Swift 只作为 native plugin 实现层，不是主 UI 主线。

即：现状的 standalone 原生 App 代码只能作为可迁移地基，最终物理落点必须收敛到 Tauri native plugin 层。

| 选项 | 描述 | 影响 / 代价 |
|------|------|-------------|
| **A. Tauri native plugin 承载（已选）** | Mobile Kernel 与 LynxView 集成落在 Tauri v2 Mobile 的 Android/iOS native plugin 层，`LynxView` 由插件 view / native route 暴露给 mobile-web（`applet-container.md §3.1/§3.2`） | 需要先完成/对齐 Tauri Mobile 主线迁移（见 `execution-plans/20260531-tauri-mobile-mainline-migration.md`）；现有 `core/applet`、`core/lynx` 代码需从 standalone App 迁入 plugin；生命周期事件源变为 Tauri 插件桥接的 Activity/Scene 回调 |
| **B. Standalone 原生 App 承载（沿用现状代码）** | Mobile Kernel 落在现有 `apps/mobile/android`、`apps/mobile/ios` 原生工程内，直接复用现有 `AppletManager`/`LynxViewFactory` 等 | 与 `docs/.agent/mobile.md` §3 / `applet-container.md §3` 的 Tauri 主线契约冲突，需上层重新裁决主线归属；可能形成第二个跨端主线，违反 mobile.md「Mobile 不自成跨端真源」约束 |

**门禁更新**：§6 原生落地可以启动，但必须以 Tauri native plugin 为目标形态；当前 standalone 原生工程内的 `core/applet`、`core/lynx` 仅作为迁移地基和语义验证场，不得被声明为最终主线。

---

## 3. 当前 Mobile 地基（已有资产）

以下为可复用地基（已核验存在）：

| 资产 | Android 路径 | iOS 路径 |
|------|-------------|---------|
| Lynx 引擎管理 / View 工厂 | `core/lynx/LynxEngineManager.kt`、`core/lynx/LynxViewFactory.kt` | `Core/Lynx/LynxEngineManager.swift`、`Core/Lynx/LynxViewFactory.swift` |
| Applet Manager（`appletId` 键单例） | `core/applet/AppletManager.kt` | `Core/Applet/AppletManager.swift` |
| Canonical Bridge Dispatcher | `core/lynx/bridge/BridgeDispatcher.kt` | `Core/Lynx/Bridge/BridgeDispatcher.swift` |
| 6 个 capability 模块（Device/Network/Notification/Storage/System/UI） | `core/lynx/bridge/{Device,Network,Notification,Storage,System,UI}BridgeModule.kt` | `Core/Lynx/Bridge/{Device,Network,Notification,Storage,System,UI}BridgeModule.swift` |
| Applet Bridge Native Module（注入 JS） | `core/lynx/bridge/AppletBridgeNativeModule.kt` | `Core/Lynx/Bridge/AppletBridgeNativeModule.swift` |
| 会话 + 权限校验 | `core/applet/AppletBridgeSession.kt` | `Core/Applet/AppletBridgeSession.swift` |
| Bundle 存储 | `core/applet/AppletBundleStorage.kt` | `Core/Applet/AppletBundleStorage.swift` |
| 容器 View | `core/applet/ui/AppletContainerView.kt` | `Core/Applet/UI/{AppletContainerView,AppletLynxViewRepresentable}.swift` |
| E2E marker | `core/applet/AppletRuntimeE2E.kt` | （E2E 入口见 `applet-container.md §7.4`） |

**结论**：Mobile 已具备「渲染 + Bridge + capability + session + bundle」全套地基，缺的是 **Kernel 层与保活语义**（§4）。

---

## 4. Gap vs Phase 3b（缺口）

对照 `applet-lifecycle-architecture.md §3/§5` 与父计划 Phase 3b，Mobile 缺失如下：

1. **Kernel 五模块**：无 instance-registry / lifecycle-orchestrator / resource-scheduler / session-manager / permission-manager 的原生对等实现（须按 `packages/applet-kernel/src/ports.ts` 端口语义在原生侧重建）。
2. **Lifecycle Adapter**：无 Activity/Scene → Kernel 事件的翻译层。
3. **LynxView detach/reattach 缓存（保活）**：当前是「切换即销毁」，与保活语义相反：
   - Android：`core/applet/ui/AppletContainerView.kt` 的 `DisposableEffect.onDispose` 直接 `appletManager.unloadApplet(appletId)`（切走即卸载）。
   - iOS：`Core/Applet/UI/AppletLynxViewRepresentable.swift` 的 `makeUIView` 每次重建 `LynxView`；`AppletContainerView.swift` 的 `.onDisappear` 直接 `viewModel.unload()`。
   - 目标应为 Desktop `SurfaceManager` 的 `hide`（保活）/`detach`（保留缓存实例）语义（见 §6）。
4. **Memory Pressure handler**：无 `onTrimMemory` / `didReceiveMemoryWarning` → Kernel 的接线。
5. **后台 pause / timer 冻结**：无 App 后台 → `pause` → LynxView timer/rAF 冻结的链路。
6. **`instanceId` 维度**：现有 `AppletManager` 仅以 `appletId` 为键（`AppletManager.kt` `applets`/`sessions` 均为 `Map<String, ...>`），无 `instanceId` 生命周期维度。
7. **状态机不对齐契约**：现有 `core/applet/AppletState.kt` 为 `REGISTERED / LOADING / READY / RUNNING / SUSPENDED / ERROR / UNLOADED`，**与契约的 `cold / materializing / visible / hidden-warm / paused / suspended / destroyed`（`packages/applet-contract/src/lifecycle.ts:22-29`）不一致**。iOS `AppletBridgeSession` 亦使用 `.running` 等非契约态。

---

## 5. 原生契约蓝图（Native Contract Blueprint）

所有原生实现按下列 TS 契约逐条对齐语义。契约是真源，Mobile 侧**重实现语义**，不引入包。

### 5.1 PlatformAdapter（原生对等）

契约：`packages/applet-contract/src/platform-adapter.ts:39-61`（`onLifecycleEvent` / `applySurfaceCommand` / `estimateMemory`），`SurfaceCommand = 'mount' | 'show' | 'hide' | 'detach' | 'destroy'`（`platform-adapter.ts:25`）。

| 成员 | Android（Kotlin） | iOS（Swift） |
|------|-------------------|--------------|
| `platform` | `'android'` | `'ios'` |
| `onLifecycleEvent(handler)` | Activity/Fragment 生命周期 + `onTrimMemory` → 事件回调总线 | UIScene 生命周期 + `didReceiveMemoryWarning` → 事件回调总线 |
| `applySurfaceCommand(cmd, target)` | 路由到原生 SurfaceManager（LynxView attach/detach） | 路由到原生 SurfaceManager（`addSubview`/`removeFromSuperview`） |
| `estimateMemory(target)` | `Debug.MemoryInfo` / `ActivityManager` best-effort | `task_info` / `os_proc_available_memory` best-effort |

参照 Desktop：`apps/desktop/src/applet/kernel/DesktopPlatformAdapter.ts`。

### 5.2 Kernel 依赖（原生对等）

契约：`packages/applet-kernel/src/index.ts:48-59`（`AppletKernelDeps`：`clock` / `logger` / `adapter` / `policy` / `sessionBackend` / `auditSink`）。原生须提供全部六个注入项，组装出与 `packages/applet-kernel/src/index.ts:70-125` 等价的 composition root（`dispatch` / `runSweep` / `handleMemoryPressure`）。

Orchestrator 是**状态唯一写入者**（对齐 `packages/applet-kernel/src/lifecycle-orchestrator.ts`），Scheduler 只产出事件、不改状态（对齐 `resource-scheduler.ts`）。

### 5.3 七态状态机（唯一权威）

严格对齐 `packages/applet-contract/src/lifecycle.ts`：

- 状态：`cold / materializing / visible / hidden-warm / paused / suspended / destroyed`（`lifecycle.ts:22-29`）。
- 合法转换表：`lifecycle.ts:116-124`。关键约束：
  - `show` 的合法源为 `hidden-warm | paused | suspended`（`lifecycle.ts:119`），**不含 `visible`**。
  - `pause` 源为 `visible | hidden-warm`（`lifecycle.ts:121`）；`suspend` 源为 `hidden-warm | paused`（`lifecycle.ts:122`）；`restore` 源为 `suspended`（`lifecycle.ts:123`）。
- **冷启首帧不 dispatch `show`**（与 Desktop §6.2 同规则）：`ready`（materializing → visible）后，首帧直接经 `applySurfaceCommand('show', target)` 挂载，不发 `show` 事件（从 `visible` 再 `show` 会被合法性校验拒绝）。参照 `apps/desktop/src/runtimes/appletsRuntime.ts:204-245`。

原生须实现与 `isValidTransition` / `nextState`（`lifecycle.ts:147-182`）等价的转换校验，非法转换一律拒绝。

### 5.4 MOBILE 资源策略

契约：`packages/applet-kernel/src/policy.ts:25-31`（`MOBILE_RESOURCE_POLICY`）。与 Desktop 唯一差异是 `lruSize`：

| 参数 | Mobile | Desktop | 备注 |
|------|--------|---------|------|
| `lruSize` | **3** | 4 | 仅此项不同（Mobile 内存更紧张） |
| `maxSuspended` | 8 | 8 | 一致 |
| `hiddenWarmTtlMs` | 30 min | 30 min | 一致 |
| `suspendedTtlMs` | 120 min | 120 min | 一致 |
| `pausedTtlMs` | 15 min | 15 min | 一致 |

内存压力语义对齐 `resource-scheduler.ts:128-158`：`low` 无动作；`moderate` 销毁最旧 `suspended`；`critical` 销毁所有非 `visible`。

### 5.5 SessionBackend / AuditSink（原生对等）

**SessionBackend**（契约端口 `packages/applet-kernel/src/ports.ts:80-84`）——采用 Desktop `DesktopSessionBackend`（`apps/desktop/src/applet/kernel/DesktopSessionBackend.ts`）的 **ADOPT 模式**：

- **不新铸 session**：原生 `AppletManager` 是 session/manifest 的**唯一 owner**（`AppletManager.kt:52-83` `loadApplet` 已创建 `AppletBridgeSession`）。SessionBackend 只**领养**已创建的 session。
- 维护 `sessionId → appletId` 映射。
- `renewSession` 为 **no-op**（Gateway 无续租概念）。
- `destroySession(sessionId)` **反查** appletId，委托 `AppletManager.unloadApplet(appletId)`（唯一卸载路径，对齐 `appletsRuntime.ts:254-266` 的单一 unload）。

**AuditSink**（契约端口 `ports.ts:106-115`）——对齐 Desktop `DesktopAuditSink`（`apps/desktop/src/applet/kernel/DesktopAuditSink.ts`）：只记录 `appletId / instanceId / method / granted / timestamp / reason`，**绝不记录 `sessionId` / token / PII**（AGENTS.md 日志安全）。原生用平台 logger（Android 项目 logger，非 `Log.*`；iOS 项目 logger，非 `print`）。

### 5.6 事件流镜像表（Desktop → Mobile）

对齐 Desktop Lifecycle Adapter（`apps/desktop/src/runtimes/appletsRuntime.ts`）与 `applet-lifecycle-architecture.md §4`：

| 语义维度 | Desktop 信号源 → 事件 | Android 信号源 → 事件 | iOS 信号源 → 事件 |
|----------|----------------------|----------------------|-------------------|
| 冷启首帧 | `acquirePage` 首次：`ready` + `applySurfaceCommand('show')`（`appletsRuntime.ts:230-240`） | 打开 applet：register + `ready` + surface `show`（不 dispatch `show`） | 同左 |
| active-page 切走 | `notifyActiveAppletPage` → `hide`（`appletsRuntime.ts:281-286`） | Fragment `onPause`（tab 切换）→ `hide` | `viewDidDisappear`（tab）→ `hide` |
| active-page 切回 | `notifyActiveAppletPage` → `show`（`appletsRuntime.ts:288-293`） | Fragment `onResume` → `show` | `viewDidAppear` → `show` |
| App 后台 → pause | `window blur` / `document hidden` → `pause`（`appletsRuntime.ts:114-131,138-149`） | `Activity.onStop`（`Lifecycle.Event.ON_STOP`）→ `pause` | `sceneDidEnterBackground` → `pause` |
| App 前台 → resume | `window focus` / `document visible` → `resume`（`appletsRuntime.ts:151-162`） | `Activity.onStart`（`ON_START`）→ `resume` | `sceneWillEnterForeground` → `resume` |
| pause/resume 的 timer/rAF 冻结 | pause/resume **无 surface 命令**；经 `SurfaceManager.signalPause/signalResume` → `host.surfacePause/Resume`（`SurfaceManager.ts:126-132`，`appletsRuntime.ts:147,160`） | Kernel 接受 `pause` 后，向 LynxView 下发原生 pause 信号冻结 timer；`resume` 反向 | 同左 |
| lease / active-page 权威 | `activeAppletPageIds` + `foregroundAppletPageId`（`appletsRuntime.ts:29-32`） | 导航栈/前台 route 维护 active instance | UIScene 前台 route 维护 active instance |
| surface 命令 | Orchestrator `applySideEffect`（`lifecycle-orchestrator.ts:172-192`）：show/restore/resume→`show`；hide→`hide`；suspend→`detach`；destroy/error→`destroy` | 同语义，落到 LynxView attach/detach | 同语义，落到 `addSubview`/`removeFromSuperview` |
| TTL 周期扫描 | `runSweep` 定时器（`appletsRuntime.ts:71-82`） | 周期任务（`Handler`/coroutine）→ `runSweep` | 周期任务（`Timer`）→ `runSweep` |
| 内存压力 | JS heap 采样 → `handleMemoryPressure`（`appletsRuntime.ts:99-106`） | `onTrimMemory` → `handleMemoryPressure` | `didReceiveMemoryWarning` → `handleMemoryPressure` |

**Surface 命令 → Mobile 原生动作映射**（对齐 §6）：

| Kernel surface 命令 | Mobile 原生动作 |
|--------------------|-----------------|
| `mount`/`show` | 创建 / `addSubview` LynxView（可见）；`mount` 仅内部按需触发，Orchestrator 不发裸 `mount` |
| `hide` | `View.GONE`（Android）/ `isHidden = true`（iOS），**保留实例** |
| `detach` | `removeFromSuperview`（iOS）/ 从 view hierarchy 移除（Android），**保留缓存实例**供 instant reattach |
| `destroy` | 彻底销毁 LynxView；**不**自行销毁 session（Orchestrator 已 `sessions.destroy` + `registry.remove`，对齐 `lifecycle-orchestrator.ts:103-116`） |

---

## 6. 分平台任务拆解

> §2 已裁决为 Tauri native plugin 承载；以下任务可以进入编码，但当前 standalone 原生工程仅作为迁移地基和语义验证场，不得被声明为最终主线。

| 任务 | Android（Kotlin） | iOS（Swift） |
|------|-------------------|--------------|
| 状态机对齐契约 | ✅ 已将 `AppletState.kt` 替换为七态 + 转换校验；`AppletBridgeSession` 使用 `dispatchLifecycle` | ✅ 已将 `AppletBridgeSession` 状态替换为七态 + 转换校验 |
| Instance Registry | ✅ `AppletInstanceRegistry` 已按 `instanceId` 记录 state/timestamps/memory estimate | ✅ `AppletInstanceRegistry` 已按 `instanceId` 记录 state/timestamps/memory estimate |
| Lifecycle Orchestrator | ✅ `AppletLifecycleOrchestrator` 已成为状态写入入口，并在 destroy/error 路径清理 session/registry/surface | ✅ `AppletManager` 内置 orchestrator 等价路径，状态写入收口到 `dispatchLifecycle` / scheduler 事件 |
| Resource Scheduler | ✅ `AppletResourceScheduler` 已实现 LRU(3)、TTL、suspended overflow、moderate/critical memory pressure 决策 | ✅ `AppletResourceScheduler` 已实现 LRU(3)、TTL、suspended overflow、moderate/critical memory pressure 决策 |
| Session Manager + Backend | 🔄 `AppletManager` 仍是 session owner，Kernel 通过 session destroyer 反查清理；独立 SessionBackend 接口未拆出 | 🔄 `AppletManager` 仍是 session owner，Kernel 通过 manager 内部路径清理；独立 SessionBackend 接口未拆出 |
| Permission Manager + AuditSink | 🔄 权限仍复用 `AppletBridgeSession`；独立 PermissionManager/AuditSink 未拆出 | 🔄 权限仍复用 `AppletBridgeSession`；独立 PermissionManager/AuditSink 未拆出 |
| PlatformAdapter | 🔄 surface 路由已接入；真实 Activity/Fragment `onTrimMemory` 自动接线仍 pending | 🔄 `didReceiveMemoryWarning` 与 scene pause/resume 已接入；Tauri native plugin 物理落点仍 pending |
| Lifecycle Adapter | 🔄 Manager 暴露 `pause/resume/trim/sweep` 入口；真实 Fragment/Activity 自动接线仍 pending | ✅ App/Scene hooks 已接入 `pause/resume/sweep/memory` |
| SurfaceManager（保活） | ✅ `AppletSurfaceCache` 已实现真实 LynxView cache + show/hide/detach/destroy；容器切走改为 `hideApplet` | ✅ `AppletSurfaceCache` 已实现 UIView cache + show/hide/detach/destroy；容器切走改为 `hideApplet` |
| Memory Pressure | 🔄 `handleTrimMemory` 入口与 scheduler 策略已实现；真实 Activity 回调接线仍 pending | ✅ `didReceiveMemoryWarning` → scheduler memory pressure 已接入 |
| 后台 pause/timer 冻结 | 🔄 `pauseApplet/resumeApplet` 入口已实现；真实 `ON_STOP/ON_START` 自动接线与 Lynx timer freeze 仍 pending | 🔄 scene background/active 已接入 pause/resume；Lynx timer/rAF 原生冻结仍 pending |
| 周期 sweep 定时器 | 🔄 `runResourceSweep` 已实现；真实 coroutine/Handler 周期接线仍 pending | ✅ `Timer` 周期 sweep 已接入 |

---

## 7. 收敛项（Convergence）

| 收敛项 | 说明 |
|--------|------|
| **iOS 双 Bridge 目录残留** | ✅ **已收敛（2026-07-03）**：保留 Xcode Sources 与运行调用链实际使用的 `Core/Lynx/Bridge/`（`BridgeDispatcher` + 6 capability 模块 + `AppletBridgeNativeModule`），删除未进工程、会与现用全局 Swift 类型冲突的 `Core/Applet/Bridge/` 旁路实现（`BridgeDispatcher` / `BridgeModule` / `System` / `Storage` / `Network` / `Config` 模块）。Android 侧无此残留（仅 `core/lynx/bridge/`）。 |
| **状态机命名不一致** | ✅ **已收敛（2026-07-03）**：`applet-container.md §8.1` 原 `discovered/validated/loading/active/invalid` 六态图 + §8.3「最多 5 个并发 / 优先销毁 paused」已重写为契约七态（`lifecycle.ts:22-29`）与 `MOBILE_RESOURCE_POLICY`（`policy.ts:25-31`，LRU=3 + suspended-first 内存压力）。真源仍是 `applet-lifecycle-architecture.md §3` / `lifecycle.ts`。 |
| **standalone vs plugin 宿主形态** | ✅ **已收敛（2026-07-03）**：见 §2 Host Decision，已选择 Tauri native plugin 承载；standalone 原生工程仅作为迁移地基。 |

---

## 8. 验收

### 8.1 镜像父计划 §8（多端一致）

- A → B → A 切换不重载、不重拉 bundle、不丢 UI/scroll/input（对齐 `applet-lifecycle-architecture.md §11 切换保活）。
- 事件顺序 `hide(A) → show(B) → hide(B) → show(A)` 与 Desktop 一致（contract test）。
- TTL：hidden-warm 30min → suspended；suspended 120min → destroyed；paused 15min → suspended。
- LRU：并发超 `lruSize=3` → 最旧 hidden-warm 被 suspend；suspended 超 8 → 最旧 destroy。
- crash 隔离：单 applet JS 异常经 `error` 事件回收单实例，不影响主 UI。
- 权限撤销 / 版本升级 → 立即 destroy。

### 8.2 Mobile 专项验收

- **App 后台 → pause**：`Activity.onStop` / `sceneDidEnterBackground` 触发 `pause`，LynxView timer/rAF 冻结可观测；前台恢复 `resume`。
- **低内存回收最旧**：`onTrimMemory(MODERATE)` / `didReceiveMemoryWarning` → 销毁最旧 `suspended`（`critical` 时销毁所有非 `visible`）。
- **事件顺序与 Desktop 平价**：同一 applet bundle 在 Android/iOS/Desktop 的生命周期事件序列通过跨端 contract test（对齐父计划 §8「事件一致性」）。
- **保活成立**：切走 applet 后 LynxView 实例保留（`hide`/`detach`），切回 instant，不重建。
- Native runtime evidence 走真机/模拟器 marker（`applet-ios-lynx-runtime-e2e` / `applet-android-lynx-runtime-e2e`，见 `applet-container.md §11`），不得用 source parity scan 代替。

### 8.3 当前证据状态（2026-07-03）

- ✅ Android/iOS Lynx runtime E2E：`pnpm applet:android-lynx-runtime-e2e`、`pnpm applet:ios-lynx-runtime-e2e` 均通过，真实 SDK bridge marker 已观测。
- ✅ Cold start latency（bundle cached applet session → first bridge marker）：Android 88ms，iOS 59ms，均 < 800ms（`applet-readiness-evidence/mobile/lifecycle-hardening-gate-output.txt`）。
- ✅ LRU / TTL / memory pressure / surface cache：`pnpm applet:lifecycle-hardening-gate` 通过，覆盖 Android source test、iOS scheduler constants、Android/iOS surface cache。
- ⚠️ Hot restore latency（hidden-warm → visible <80ms）：尚无专用 A→B→A switch benchmark runner，当前只具备 surface cache source evidence，不声明 runtime latency 完成。

---

## 9. 风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| **Tauri native plugin 物理落点未完成** | 高 | 已裁决宿主形态；后续需把 standalone 地基迁入/接入 Tauri native plugin，而不是声明 standalone 为最终主线 |
| 原生重实现与 TS 契约漂移 | 中 | 跨端 contract test 覆盖事件顺序与非法转换；以 `lifecycle.ts` 为唯一真源逐条比对 |
| iOS 双 Bridge 目录导致注入歧义 | 中 | 先收敛到单一 BridgeDispatcher 再接 Kernel（§7） |
| LynxView detach 后状态丢失，hidden-warm 不成立 | 中 | 验证 offscreen 保留 vs snapshot/restore（`applet-lifecycle-architecture.md §14`） |
| 后台节流干扰 timer 语义 | 中 | Kernel 统一下发 pause/resume 冻结 applet 侧 timer，不依赖系统节流行为 |
| 内存估算不精确 | 低 | best-effort 平台 API + 保守 LRU/TTL 兜底 |

---

## 10. 实施状态

| 阶段 | 状态 | 备注 |
|------|------|------|
| §2 Host Decision 裁决 | ✅ done | 已选择 Tauri native plugin 承载；standalone 原生工程仅作为迁移地基 |
| §3–§5 契约蓝图冻结 | ✅ done | 与宿主形态无关；本文已冻结 PlatformAdapter、Kernel deps、七态状态机、Mobile 策略、SessionBackend/AuditSink、事件流镜像表 |
| §6 分平台落地 | 🔄 partial | Android/iOS 原生 Kernel 与 SurfaceManager 源码基础已落地；独立 Backend/Audit、Android 真实宿主回调、Tauri plugin 物理落点、hot restore benchmark 仍待落地 |
| §7 收敛项 | ✅ done | 状态机命名不一致、iOS 双 Bridge、standalone vs plugin 宿主形态均已收敛 |
| §8 验收 | 🔄 partial | Android/iOS runtime E2E、cold-start、LRU/TTL/memory/surface hardening gate 已通过；hot restore latency 专用 benchmark 仍 pending |

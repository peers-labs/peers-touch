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

**冲突事实（已处理）**：

- 历史现状：`apps/mobile/android` 与 `apps/mobile/ios` 曾是**独立的原生 App 工程**（Android Hilt/Compose 主 UI，iOS SwiftUI 主 UI），会与 Tauri Mobile 主线形成第二真源。
- 契约：`docs/.agent/mobile.md` §3 与 `applet-container.md` §3 规定 Mobile 主线是 **Tauri v2 Mobile**（共享 Web UI + Rust capability kernel + Android/iOS **native plugin** 层），Android Kotlin / iOS Swift 只作为 native plugin 实现层，不是主 UI 主线。
- 用户裁决（2026-07-04）：旧 standalone Android/iOS 壳不再保留；`apps/mobile/android` 与 `apps/mobile/ios` 已删除，后续不得作为 E2E 宿主或迁移地基声明。

即：Mobile applet runtime 必须在 Tauri native plugin 物理落点重建；不得继续维护 standalone 原生 App 作为并行宿主。

| 选项 | 描述 | 影响 / 代价 |
|------|------|-------------|
| **A. Tauri native plugin 承载（已选）** | Mobile Kernel 与 LynxView 集成落在 Tauri v2 Mobile 的 Android/iOS native plugin 层，`LynxView` 由插件 view / native route 暴露给 mobile-web（`applet-container.md §3.1/§3.2`） | 需要在 Tauri iOS/Android 生成工程与 native plugin 中重建 applet runtime；生命周期事件源为 Tauri 插件桥接的 Activity/Scene 回调 |
| **B. Standalone 原生 App 承载（已删除）** | Mobile Kernel 落在独立 Android/iOS 原生 App 内 | 已裁决删除；不得再作为产品主线、E2E 宿主或 readiness 证据来源 |

**门禁更新**：§6 原生落地必须以 Tauri native plugin 为目标形态；旧 standalone runtime smoke 证据全部作废，新的 release evidence 必须来自 Tauri Mobile 宿主。

---

## 3. 当前 Mobile 地基（Tauri 真源）

旧 standalone 原生资产已按用户裁决删除；当前可声明为 Mobile 真源的地基只有：

| 资产 | 路径 | 状态 |
|------|------|------|
| Mobile Web 产品壳 | `apps/mobile/src` | ✅ 真源，包含 Station 选择 / access gate / shell |
| Tauri Rust 能力层 | `apps/mobile/src-tauri/src` | ✅ 真源，包含 station / secure storage / native event 等 commands |
| Tauri iOS 生成工程 | `apps/mobile/src-tauri/gen/apple` | ✅ 已存在 |
| Tauri Android 生成工程 | `apps/mobile/src-tauri/gen/android` | ❌ 未生成 / 未落地 |
| Applet native plugin runtime | Tauri Android/iOS native plugin 层 | ❌ 待重建 |

**结论**：Mobile 当前不再具备可声明的 native Lynx/Applet runtime 实现；后续必须在 Tauri native plugin 中重建「渲染 + Bridge + capability + session + bundle + Kernel/保活」。

---

## 4. Gap vs Phase 3b（缺口）

对照 `applet-lifecycle-architecture.md §3/§5` 与父计划 Phase 3b，Mobile 缺失如下：

1. **Kernel 五模块**：无 instance-registry / lifecycle-orchestrator / resource-scheduler / session-manager / permission-manager 的原生对等实现（须按 `packages/applet-kernel/src/ports.ts` 端口语义在原生侧重建）。
2. **Lifecycle Adapter**：无 Activity/Scene → Kernel 事件的翻译层。
3. **LynxView detach/reattach 缓存（保活）**：Tauri plugin 物理落点尚未实现；目标应为 Desktop `SurfaceManager` 的 `hide`（保活）/`detach`（保留缓存实例）语义（见 §6）。
4. **Memory Pressure handler**：无 `onTrimMemory` / `didReceiveMemoryWarning` → Kernel 的接线。
5. **后台 pause / timer 冻结**：无 App 后台 → `pause` → LynxView timer/rAF 冻结的链路。
6. **`instanceId` 维度**：Tauri native plugin 侧尚未建立 instance registry。
7. **状态机对齐**：Tauri native plugin 侧尚未实现契约七态（`cold / materializing / visible / hidden-warm / paused / suspended / destroyed`）。

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

> §2 已裁决为 Tauri native plugin 承载；旧 standalone 原生工程已删除，以下任务必须在 Tauri native plugin 物理落点重建，不得引用旧宿主证据。

| 任务 | Android（Kotlin） | iOS（Swift） |
|------|-------------------|--------------|
| 状态机对齐契约 | ❌ 待在 Tauri Android plugin 实现七态 + 转换校验 | ❌ 待在 Tauri iOS plugin 实现七态 + 转换校验 |
| Instance Registry | ❌ 待实现 | ❌ 待实现 |
| Lifecycle Orchestrator | ❌ 待实现 | ❌ 待实现 |
| Resource Scheduler | ❌ 待实现 LRU(3)、TTL、memory pressure 决策 | ❌ 待实现 LRU(3)、TTL、memory pressure 决策 |
| Session Manager + Backend | ❌ 待实现 | ❌ 待实现 |
| Permission Manager + AuditSink | ❌ 待实现 | ❌ 待实现 |
| PlatformAdapter | ❌ 待接入 Activity/Fragment / `onTrimMemory` | ❌ 待接入 Scene / memory warning |
| Lifecycle Adapter | ❌ 待接入真实 Tauri route/plugin 生命周期 | ❌ 待接入真实 Tauri route/plugin 生命周期 |
| SurfaceManager（保活） | ❌ 待实现 LynxView cache + show/hide/detach/destroy | ❌ 待实现 UIView cache + show/hide/detach/destroy |
| Memory Pressure | ❌ 待实现 | ❌ 待实现 |
| 后台 pause/timer 冻结 | ❌ 待实现 | ❌ 待实现 |
| 周期 sweep 定时器 | ❌ 待实现 | ❌ 待实现 |

---

## 7. 收敛项（Convergence）

| 收敛项 | 说明 |
|--------|------|
| **iOS 双 Bridge 目录残留** | ✅ **已收敛（2026-07-03）**：保留 Xcode Sources 与运行调用链实际使用的 `Core/Lynx/Bridge/`（`BridgeDispatcher` + 6 capability 模块 + `AppletBridgeNativeModule`），删除未进工程、会与现用全局 Swift 类型冲突的 `Core/Applet/Bridge/` 旁路实现（`BridgeDispatcher` / `BridgeModule` / `System` / `Storage` / `Network` / `Config` 模块）。Android 侧无此残留（仅 `core/lynx/bridge/`）。 |
| **状态机命名不一致** | ✅ **已收敛（2026-07-03）**：`applet-container.md §8.1` 原 `discovered/validated/loading/active/invalid` 六态图 + §8.3「最多 5 个并发 / 优先销毁 paused」已重写为契约七态（`lifecycle.ts:22-29`）与 `MOBILE_RESOURCE_POLICY`（`policy.ts:25-31`，LRU=3 + suspended-first 内存压力）。真源仍是 `applet-lifecycle-architecture.md §3` / `lifecycle.ts`。 |
| **standalone vs plugin 宿主形态** | ✅ **已收敛（2026-07-04）**：见 §2 Host Decision，已选择 Tauri native plugin 承载；旧 standalone Android/iOS 工程已删除，不再作为迁移地基或验收宿主。 |

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
- Native runtime evidence 必须走 Tauri Mobile native plugin 宿主的真机/模拟器 marker；旧 standalone `applet-ios-lynx-runtime-e2e` / `applet-android-lynx-runtime-e2e` 已删除，不得恢复为验收入口。

### 8.3 当前证据状态（2026-07-04）

- ❌ Android/iOS Lynx runtime E2E：旧 standalone 宿主证据已作废并删除；Tauri native plugin 版本尚未重建。
- ❌ Cold start latency：旧 standalone marker latency 已作废；Tauri Mobile 宿主尚无有效证据。
- ❌ LRU / TTL / memory pressure / surface cache：旧 standalone source/runtime gate 已删除；Tauri native plugin 尚无有效证据。
- ❌ Hot restore latency（hidden-warm → visible <80ms）：尚无专用 A→B→A switch benchmark runner。

---

## 9. 风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| **Tauri native plugin 物理落点未完成** | 高 | 已裁决宿主形态并删除 standalone 壳；后续只能在 Tauri native plugin 中重建 runtime 与 E2E |
| 原生重实现与 TS 契约漂移 | 中 | 跨端 contract test 覆盖事件顺序与非法转换；以 `lifecycle.ts` 为唯一真源逐条比对 |
| 误用旧 standalone 证据 | 中 | 旧目录、旧 runtime E2E 脚本与误导性 evidence 已删除；新增 gate 必须检查 Tauri bundle id / Tauri app route |
| LynxView detach 后状态丢失，hidden-warm 不成立 | 中 | 验证 offscreen 保留 vs snapshot/restore（`applet-lifecycle-architecture.md §14`） |
| 后台节流干扰 timer 语义 | 中 | Kernel 统一下发 pause/resume 冻结 applet 侧 timer，不依赖系统节流行为 |
| 内存估算不精确 | 低 | best-effort 平台 API + 保守 LRU/TTL 兜底 |

---

## 10. 实施状态

| 阶段 | 状态 | 备注 |
|------|------|------|
| §2 Host Decision 裁决 | ✅ done | 已选择 Tauri native plugin 承载；standalone 原生工程已删除 |
| §3–§5 契约蓝图冻结 | ✅ done | 与宿主形态无关；本文已冻结 PlatformAdapter、Kernel deps、七态状态机、Mobile 策略、SessionBackend/AuditSink、事件流镜像表 |
| §6 分平台落地 | ❌ pending | 旧 standalone 实现已删除；Tauri native plugin runtime 待重建 |
| §7 收敛项 | ✅ done | 状态机命名不一致、standalone vs plugin 宿主形态已收敛；旧 iOS 双 Bridge 随旧壳删除不再适用 |
| §8 验收 | ❌ pending | 旧 standalone runtime E2E 与 hardening gate 已作废；Tauri native plugin 验收待重建 |

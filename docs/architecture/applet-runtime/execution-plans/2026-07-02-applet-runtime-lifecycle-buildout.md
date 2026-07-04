# Applet Runtime & Lifecycle — 构建计划

> **Status**: draft
> **Version**: v3.0
> **Created**: 2026-07-02 | **Updated**: 2026-07-02
> **Owner**: Architecture Team
> **Depends on**: [`applet-lifecycle-architecture.md`](../applet-lifecycle-architecture.md), [`runtime-architecture.md`](../runtime-architecture.md)

---

## 1. 定位

直接构建跨端 Applet Runtime 与统一生命周期/保活体系。

- **Desktop = Tauri WebView + Lynx for Web**（`<lynx-view>`），与 Mobile 共用同一份 `main.lynx.bundle`。
- **Mobile = 原生 LynxView**。
- 保活/回收（切换不重载、长期回收）由跨端 **Applet Kernel** 统一提供，与渲染 runtime 无关。
- 不自研 Rust FFI 嵌入 Lynx native engine（远期观察项，见 §12）。

---

## 2. 原则

1. **验证先行** — 关键技术假设必须通过 spike 验证才能进入正式实施。
2. **保活归 Kernel** — 生命周期状态机、LRU/TTL/内存压力策略跨端一致，不绑定渲染技术。
3. **Contract first** — 先冻结协议，再写实现。
4. **跨端统一** — Desktop/Android/iOS 共用同一个 Applet Kernel 设计，Platform Adapter 各端独立。
5. **Applet SDK 不感知平台** — 小程序代码不出现 Tauri/Android/iOS/WebView 任何字样。
6. **不引入 iframe** — 任何路径（含降级）都不用 iframe 作为 applet 隔离边界。

---

## 3. Phase 0: Spike 验证

### 目标

验证 Lynx for Web 在 Tauri 系统 WebView 中承载 applet 并支持 Kernel 保活。

**重要事实**：Desktop Lynx-for-Web runtime **已存在于生产代码**，不是从零起步。因此 Phase 0
**不新建 `experiments/` PoC**，而是"基于现有 runtime 补齐验证证据 + 精确定位保活缺口"。

### 现有资产（证据来源）

| 资产 | 路径 | 作用 |
|------|------|------|
| `<lynx-host>` Custom Element | `apps/desktop/src/applet/lynx-host-element.ts` | 挂载 `<lynx-view>`、Bridge 拦截、生命周期事件、事件轮询 |
| Runtime loader | `apps/desktop/src/applet/lynx-web-runtime.ts` | dev/prod 加载 `@lynx-js/web-core/client`，预热规避竞态 |
| React 容器 | `apps/desktop/src/applet/LynxContainer.tsx` | 解析 session、渲染 `<lynx-host>` |
| Manager（单例） | `apps/desktop/src/applet/AppletManager.ts` | 扫描 / 校验 / 完整性校验 / session 创建销毁 |
| Dev applet | `apps/desktop/applets-dev/hello-lynx/` | `@lynx-js/react` + rspeedy 构建的验证 bundle |
| 测试 | `apps/desktop/src/applet/{lynx-host-element,AppletManager}.test.ts` | 22 tests passed，作为 spike 证据 |

### Spike 矩阵（Desktop）

| # | 假设 | 验证方式 | 现状 |
|---|------|---------|------|
| 1 | Lynx for Web 可在 Tauri 系统 WebView 稳定运行 | 现有 `<lynx-host>` + host 单测 | **Proven** |
| 2 | Worker / custom protocol / asset URL / CSP 三平台 WebView 兼容 | WKWebView(mac) + WebView2(win) 加载真实 bundle | **Partial**（缺实机证据，Phase 3 补齐） |
| 3 | host `display:none` / detach 保活切回不丢状态 | A→B→A 切换 | **Unproven（真实缺口）** |
| 4 | 多个 `<lynx-view>` host 共存 | 同时挂载 2+ applet | **Partial**（架构隔离已具备，缺实机串扰验证） |
| 5 | Kernel `pause` 冻结后台 applet timer/rAF | 后台计时行为 | **Proven（事件语义）**，applet 侧冻结待 Phase 2 |
| 6 | NativeModules Bridge → Rust Capability Gateway roundtrip | invoke bridge → Gateway | **Proven** |

### 已定位的保活缺口

> **修正（Phase 3 探查）**：早期措辞"只要 DOM 卸载就销毁"不精确。实测现状是
> `PageHost` 以 `keepAlive:{ lru:4 }` **用 `display:none` 保活后台 applet 帧**（4 个以内 DOM 不卸载），
> 超出 LRU cap 才 `releasePageRuntimeLease('evict')` → 卸载 → `disconnectedCallback` → `destroyLynxView`。
> 即：**存在页面级 LRU 保活**，但它与 Kernel ResourceScheduler 语义完全重叠，形成"双 LRU"。

- `AppletManager` 以 `appletId` 为 key 的单例 Map，**无 `instanceId` / TTL / 内存压力**回收维度。
- 页面级 `keepAlive:{ lru:4 }`（`PageHost`）与 Kernel `ResourceScheduler`（lruSize 4）**双 LRU 重叠**，
  两套淘汰权威并存。
- `<lynx-host>` `disconnectedCallback` → `destroyLynxView` → **自决 `unloadApplet`**（销毁 session），
  与 Orchestrator `destroy`→`sessions.destroy`+`registry.remove` 语义冲突（双重 unload）。
- 后台 `display:none` 的 applet **不发 `pause`**（document 仍 visible），timer/rAF 继续跑。
- 缺口归属：状态机 → Phase 1/2；LRU/TTL/内存 → Phase 2 Kernel；**双 LRU 收敛 + Surface Manager 保活分支 +
  pause 冻结 → Phase 3 Desktop（Kernel 单一权威）**。

### Spike 矩阵（Mobile）

沿用 `applet-lifecycle-architecture.md §8` 的 Mobile 验证项：LynxView detach/reattach 保活、后台暂停 timer、内存压力安全 destroy。

### 产出

- `apps/desktop/spike-reports/applet-runtime-spike.md` — 逐项 proven/unproven/partial 结论 + 证据 + 保活缺口定位。

### Gate

| 结果 | 行动 |
|------|------|
| 渲染 / Bridge / 生命周期事件成立，无路径阻塞 | 进入 Phase 1（当前判定） |
| partial 项（三平台实机 / 多实例） | 在 Phase 3 Desktop 实机验收补齐 |
| Lynx for Web 在某 WebView 根本不适用 | 启用 `design.md §9` 降级路径（Shadow DOM + dynamic import，不引入 iframe），不阻塞 Mobile |

### 预计工期

已基本完成（基于现有 runtime）；partial 项随 Phase 3 实机验收收尾。

---

## 4. Phase 1: Contract Lock

### 前提

Phase 0 Gate 通过。

### 目标

冻结跨端生命周期协议、Bridge 协议、Platform Adapter Interface。

### 产出

| 产出物 | 位置 | 状态 |
|--------|------|------|
| `AppletLifecycleState` union + `AppletLifecycleEvent` + `AppletInstance` + 转换校验（`isValidTransition`/`nextState`） | `packages/applet-contract/src/lifecycle.ts` | **已交付** |
| `PlatformAdapter` interface（含 `SurfaceCommand`/`AppletPlatform`） | `packages/applet-contract/src/platform-adapter.ts` | **已交付** |
| `BridgeEnvelope` protocol | `packages/applet-contract/src/bridge.ts` | 已存在（Phase 前冻结） |
| `AppletManifest` schema | `packages/applet-contract/src/manifest.ts` | 已存在（Phase 前冻结） |
| SDK lifecycle hooks | `packages/applet-sdk/src/capabilities/core.ts`（`createLifecycleAPI`） | 已存在；已对齐 6/7 态（`restore`→applet 侧呈现为 `show`），暂不迁出独立文件 |
| Contract test suite | `packages/applet-contract/tests/lifecycle.test.mjs` | **已交付** |

### 验收

- TypeScript compile pass — **PASS**（`applet-contract` + `applet-sdk` `tsc --noEmit`）
- Contract tests cover：状态转换合法性、事件顺序（`hide→show→hide→show`）、非法转换拒绝 — **PASS**（`pnpm --filter @peers-touch/applet-contract run test`）
- SDK lifecycle hooks 对齐状态机 — hooks（onReady/reportReady/onShow/onHide/onPause/onResume/onDestroy）覆盖 §11 要求；`restore` 对 applet 呈现为 `show`
- Bridge envelope 与现有 applet bundle 兼容 — 未改动 `bridge.ts`，既有 `applet:contract-test` **PASS**

### 预计工期

1-2 周。

---

## 5. Phase 2: Applet Kernel

### 目标

实现跨端 Applet Kernel core logic（渲染无关）。

### 产出

| 模块 | 职责 | 位置 | 状态 |
|------|------|------|------|
| `AppletInstanceRegistry` | 管理所有 applet 实例状态、时间戳、内存估算 | `packages/applet-kernel/src/instance-registry.ts`（`DefaultInstanceRegistry`） | **已交付** |
| `LifecycleOrchestrator` | 根据事件 + 策略驱动状态转换（状态唯一写入者，含 crash `error`→destroyed） | `packages/applet-kernel/src/lifecycle-orchestrator.ts`（`DefaultLifecycleOrchestrator`） | **已交付** |
| `ResourceScheduler` | LRU (applet 维度) + TTL + 内存压力扫描（纯函数，只产出事件） | `packages/applet-kernel/src/resource-scheduler.ts`（`DefaultResourceScheduler`） | **已交付** |
| `SessionManager` | 创建/续租/销毁 capability session | `packages/applet-kernel/src/session-manager.ts`（`DefaultSessionManager`） | **已交付** |
| `PermissionManager` | manifest 声明 + runtime grant + 调用审计 | `packages/applet-kernel/src/permission-manager.ts`（`DefaultPermissionManager`） | **已交付** |
| 内部 ports（冻结接口） | 模块间契约，模块只依赖接口不依赖兄弟类 | `packages/applet-kernel/src/ports.ts` | **已交付** |
| 策略预设（架构 §5 数值） | Desktop lruSize 4 / Mobile 3 / maxSuspended 8 / TTL | `packages/applet-kernel/src/policy.ts` | **已交付** |
| Composition root（组装五模块 + Scheduler→Orchestrator 派发） | `AppletKernel` facade | `packages/applet-kernel/src/index.ts` | **已交付** |
| Kernel test suite | 各模块单测 + 组装根集成测试 | `packages/applet-kernel/tests/*.test.mjs` | **已交付** |


### 实现位置

- TypeScript 跨端内核（Desktop WebView + Web 直接用）：`packages/applet-kernel/`
- Rust 侧 Capability Gateway（权限/审计/存储/网络最终执行）：`apps/desktop/src-tauri/src/domain/applets/`
- Mobile 版本由 Android/iOS 各端根据 TypeScript 抽象实现（Kotlin/Swift）

### 验收

- Unit tests：状态机转换、LRU 淘汰、TTL 触发、内存压力处理、crash recovery — **PASS**（`pnpm --filter @peers-touch/applet-kernel run test`：instance-registry / session-manager / lifecycle-orchestrator / resource-scheduler / permission-manager + composition-root integration 全绿）
- 不依赖任何具体渲染框架（Lynx-for-Web / LynxView 由 PlatformAdapter 注入） — **PASS**（tsconfig `lib` 无 DOM；kernel 仅经 `PlatformAdapter` 端口触达 surface）
- 不依赖任何平台特有 API（由 PlatformAdapter 注入） — **PASS**（`clock`/`logger`/`adapter`/`sessionBackend`/`auditSink` 全部依赖注入；`tsc --noEmit` 通过）


### 预计工期

3-4 周。

---

## 6. Phase 3: Desktop — Tauri WebView + Lynx for Web

### 目标

构建 Desktop 完整 Applet Runtime。

### 架构

```text
Desktop App (Tauri)
├── Applet Kernel (TS, in WebView) — Phase 2 产出
├── Surface Manager
│   ├── mount_host(applet_id) → <lynx-view> host container
│   ├── show_host / hide_host（display / attach-detach）
│   └── destroy_host
├── Lynx for Web runtime
│   └── load main.lynx.bundle, render in system WebView
├── Bridge Host Module
│   └── NativeModules handler → Kernel → Rust Capability Gateway
├── Lifecycle Adapter
│   └── window focus/blur/minimize/visibility → Kernel 生命周期事件
├── Memory Monitor
│   └── JS heap (performance.memory) + Rust 进程 RSS → ResourceScheduler
└── Rust Host (Tauri)
    └── Capability Gateway: permission / audit / storage / network
```

### 6.1 结构决策：Kernel 单一权威（已定，用户拍板）

**问题**：现状存在"双 LRU"——`PageHost` 的 `keepAlive:{ lru:4 }`（`display:none` 保活 + 超 cap 卸载）
与 `AppletKernel.ResourceScheduler`（lruSize 4 + TTL + 内存压力）语义完全重叠，两套淘汰权威并存。

**决策**：**Kernel 是生命周期/回收的唯一权威（架构 §2.1「Kernel 管生命周期，Shell 管 surface」）**。

| 层 | 改造后职责 | 不再负责 |
|----|-----------|---------|
| `PageHost` / 页面 descriptor（Shell） | 保证 applet 页面 React frame 常驻（`keepAlive:'forever'`，`display:contents\|none`） | **不做任何淘汰/LRU 决策** |
| `SurfaceManager`（新，Desktop 适配层） | 拥有 `<lynx-host>` 的 imperative 挂载点，执行 Kernel 下发的 `mount/show/hide/detach/destroy` | 不决定何时回收 |
| `AppletKernel.ResourceScheduler` | **唯一** LRU / TTL / 内存压力决策者 | — |
| `LifecycleOrchestrator` | 状态唯一写入者；`destroy/error` 时**自行** `sessions.destroy`+`registry.remove` | — |

**推论**：`<lynx-host>` 不能再在 `disconnectedCallback` 里自决 `destroyLynxView`→`unloadApplet`。
DOM 帧常驻后，`<lynx-view>` 的 attach/detach/销毁改由 SurfaceManager 按 Kernel 的 surface 命令 imperatively 驱动。

### 6.2 Desktop seam 冻结（本 Phase 实现契约）

**新增文件（不破坏现有路径）**：

| 文件 | 职责 |
|------|------|
| `apps/desktop/src/applet/kernel/desktopKernel.ts` | Desktop `AppletKernel` composition-root 单例：注入 `Clock`(Date.now) / `KernelLogger`(→`log`) / `DESKTOP_RESOURCE_POLICY` / `DesktopPlatformAdapter` / `DesktopSessionBackend` / `DesktopAuditSink` |
| `apps/desktop/src/applet/kernel/DesktopPlatformAdapter.ts` | 实现 `PlatformAdapter`：`applySurfaceCommand` 路由到 `SurfaceManager`；`onLifecycleEvent` 由 Lifecycle Adapter 推送；`estimateMemory` 读 `performance.memory` |
| `apps/desktop/src/applet/kernel/SurfaceManager.ts` | 拥有每个 instance 的 `<lynx-host>` DOM 挂载点；执行 `mount/show/hide/detach/destroy` |
| `apps/desktop/src/applet/kernel/DesktopSessionBackend.ts` | 实现 `SessionBackend`：`createSession`→`api.appletCreateSession`；`destroySession`→`api.appletInvoke(lifecycle/destroy)`；`renewSession` no-op（Gateway 无续租，记录 touch） |
| `apps/desktop/src/applet/kernel/DesktopAuditSink.ts` | 实现 `AuditSink`：`record`→`log.info`（绝不记 sessionId/PII） |

**surface 命令 → SurfaceManager → `<lynx-host>` 映射（严格对齐 Orchestrator 冻结语义）**：

| Kernel surface 命令 | 触发事件 | SurfaceManager 动作 |
|--------------------|---------|--------------------|
| `show` | `show`/`restore`/`resume` | 若无 host 则 mount `<lynx-host>`（含 attr `applet-id`/`session-id`/`url`），置 `display:contents`（可见） |
| `hide` | `hide` | host 置 `display:none`（保活，DOM 保留、bundle 不卸载） |
| `detach` | `suspend` | 移除 `<lynx-view>` 子节点（释放渲染资源），保留 host 壳与 instance 记录，供 `restore` instant 重挂 |
| `destroy` | `destroy`/`error`/memory-pressure/TTL 到期 | 彻底移除 host + `<lynx-view>`；**不** 自行销毁 session（Orchestrator 已 `sessions.destroy`+`registry.remove`） |

> 注：Orchestrator 对 `launch`/`ready`/`pause` **不下发** surface 命令。`materializing`→`visible` 的首帧挂载**不经 `show` dispatch**
> （冻结状态机中 `show` 的合法源为 `hidden-warm`/`paused`/`suspended`，不含 `visible`，从 `visible` 再 `show` 会被拒为非法转换）。
> 冷启首帧由 Lifecycle Adapter 在 `ready`（→`visible`）后**直接调用 `adapter.applySurfaceCommand('show', target)`** 挂载 surface；
> `mount` 命令仅 SurfaceManager 内部按需触发。

### 6.3 事件注入（Lifecycle Adapter → Kernel.dispatch）

Kernel 的状态推进完全由 `dispatch(event)` 驱动。Desktop 事件来源与映射：

| 来源信号 | dispatch 事件 | 说明 |
|---------|--------------|------|
| `appletsRuntime.acquirePage(pageId,'activate')` 首次 | `ready` + surface `show` | 冷启：先 `sessions.create`（adopt AppletManager session）+ `registry.create`（instance 初始 `materializing`），再 `dispatch(ready)`（materializing→visible），最后 `applySurfaceCommand('show')` 挂首帧（**不 dispatch `launch`/`show`**，见 6.2） |
| 页面切换到该 applet（已存在 warm instance） | `show` | hidden-warm/paused/suspended → visible |
| 页面从该 applet 切走（active page 变化，`ReadyView` 监听 `router.page` → `notifyActiveAppletPage`） | `hide` | visible → hidden-warm；`display:none` |
| `window blur` / `document hidden` | `pause` | 冻结前台 applet timer/rAF（当前 host 内自发 pause 迁移到 Kernel 统一下发） |
| `window focus` / `document visible` | `resume` | 恢复 |
| `appletsRuntime.releasePage(pageId,'explicit-close')` | `destroy` | 用户显式关闭 |
| Memory Monitor 采样越阈值 | `handleMemoryPressure(level)` | Scheduler 产出 suspend/destroy 事件 |
| 周期 `runSweep(now)`（TTL） | — | Scheduler 产出 TTL suspend/destroy |
| host `error` 事件 | `error` | crash 隔离，reclaim 单实例 |

> 后台 `pause` 冻结：`<lynx-host>` 收到 Kernel 下发的 `pause` 语义后 `sendEvent('pause')`，applet SDK 侧冻结 timer/rAF。
> 由 Kernel 统一决策取代 host 自发的 `visibilitychange/blur` 直接 `sendEvent`（消除"后台不发 pause"缺口）。

### 6.4 instanceId 维度

Desktop 当前 `AppletManager` 以 `appletId` 为 key。Kernel 需要 `instanceId`。
Desktop 单端策略：**每个 applet 页面一个 instance**，`instanceId = pageId`（`applet:<id>`），
与 `AppletManager` 的 `appletId` 一一映射（Desktop 不做同一 applet 多开）。
`AppletManager` 保持 `appletId` 键不变（session/manifest 存储），Kernel registry 用 `instanceId=pageId` 记录生命周期状态；
SurfaceManager 用 `instanceId` 定位 host。

### 任务

| 任务 | 说明 |
|------|------|
| Desktop Kernel 组装 | `desktopKernel.ts` 注入六依赖，单例暴露 dispatch/runSweep/handleMemoryPressure |
| SurfaceManager | 拥有 `<lynx-host>` imperative 挂载点，执行 mount/show/hide/detach/destroy |
| DesktopPlatformAdapter | surface 命令 → SurfaceManager；lifecycle 事件源；estimateMemory |
| DesktopSessionBackend | create/destroy → Rust Gateway via `desktop_api`；renew no-op |
| DesktopAuditSink | permission 审计 → log（无 PII） |
| 页面 descriptor 翻转 | `AppletRuntimePage.descriptor` `keepAlive:{lru:4}` → `'forever'`（消除页面级 LRU） |
| `<lynx-host>` 去自决 | 移除 `disconnectedCallback`→`unloadApplet` 与自发 pause/resume；改由 Kernel 驱动 |
| `appletsRuntime` 接 Kernel | acquire→launch/ready/show；explicit-close→destroy；install 启 sweep 定时器 + memory monitor；active-page 监听→hide/show |
| Rust Capability Gateway | 复用现有 session 注册/校验/销毁（已具备），无需大改 |

### 验收

- launch → show → hide → show（切换不重载）→ destroy：全链路正确
- 2+ applet 并行运行，互不干扰
- TTL 30min 后 suspended，恢复正确
- 内存压力触发 destroy
- Bridge roundtrip < 10ms
- 后台 pause 冻结 timer，前台 resume 恢复
- **无双 LRU**：页面 descriptor `keepAlive:'forever'`，唯一淘汰权威是 Kernel ResourceScheduler
- **无双 unload**：`<lynx-host>` 不再自决销毁 session；session 销毁只经 Orchestrator

### 预计工期

3-5 周。

---

## 7. Phase 3b: Mobile — Native Lynx Lifecycle

> **落地子计划**：[`docs/client/mobile/execution-plans/2026-07-03-applet-kernel-mobile-native-buildout.md`](../../../client/mobile/execution-plans/2026-07-03-applet-kernel-mobile-native-buildout.md)（原生契约蓝图 + 分平台任务 + 收敛项 + 验收；含未决的宿主形态 Blocking Decision）。

### 目标

Android/iOS 基于 Native LynxView 实现完整 Applet Lifecycle。

### 架构

```text
Mobile App
├── Applet Kernel (Kotlin/Swift)
├── Applet Container (Fragment/ViewController)
│   └── LynxView (native, per applet)
├── Lifecycle Adapter
│   └── Activity/Scene lifecycle → Kernel events
├── LynxView Cache
│   └── detach 保留实例，reattach instant 恢复
├── Memory Pressure Handler
│   └── onTrimMemory / didReceiveMemoryWarning → Kernel
└── Bridge Dispatcher
    └── NativeModule → Kernel → Capability
```

### 任务

| 任务 | Android | iOS |
|------|---------|-----|
| Applet Kernel | Kotlin 实现 | Swift 实现 |
| Lifecycle Adapter | Fragment/Activity → events | ViewController/UIScene → events |
| LynxView Cache | detach/reattach LynxView | removeFromSuperview/addSubview |
| Background Timer | WorkManager / AlarmManager | BackgroundTask |
| Memory Pressure | onTrimMemory → Kernel | didReceiveMemoryWarning → Kernel |
| Bridge Dispatcher | NativeModule → Kernel | NativeModule → Kernel |

### 验收

- 同 Phase 3 Desktop 验收标准
- App 后台 → pause，前台 → resume 正确
- 低内存回收最旧 applet
- 与 Desktop 事件语义一致

### 预计工期

2-3 周（可与 Phase 3 并行；Mobile LynxView 地基相对成熟）。

---

## 8. Phase 4: Integration & Hardening

### 目标

全平台压测、稳定性验证、边界情况覆盖。

### 测试矩阵

| 类型 | 场景 | 验收 |
|------|------|------|
| 多实例 | 同时打开 8 个 applet | LRU 正确淘汰，visible 不受影响 |
| 长期后台 | 后台 2 小时 | TTL suspend/destroy 正确触发 |
| Crash recovery | applet JS 异常 | 单个 applet 隔离，不影响主 UI |
| 版本升级 | manifest version 变化 | destroy → cold start with new bundle |
| 权限撤销 | runtime revoke | immediate destroy |
| 网络断开 | offline 状态 | session 续租失败 → graceful degrade |
| 事件一致性 | Desktop/Android/iOS 同一 applet | 事件顺序 contract test 通过 |
| 冷启动性能 | cold start latency | < 800ms (bundle cached) |
| 热恢复性能 | hidden-warm → visible | < 80ms |

### 预计工期

2-3 周。

---

## 9. Phase 5: 收敛旧 applet 页面运行时

### 目标

统一 applet host 到新 Kernel + Surface Manager，移除临时/重复的保活逻辑。

### 任务

| 任务 | 说明 |
|------|------|
| 统一 host 挂载 | applet 区域统一走 Surface Manager + `<lynx-view>` |
| 移除重复保活逻辑 | 清理散落在 PageHost / 页面层的临时保活代码 |
| 生命周期收口到 Kernel | 页面层不再自行决定 destroy/suspend |
| 文档同步 | 更新 `docs/client/desktop/` 落地文档 |

### 预计工期

1-2 周。

---

## 10. 总工期

| Phase | 工期 | 依赖 |
|-------|------|------|
| Phase 0: Spike | 基本完成（基于现有 runtime） | 无 |
| Phase 1: Contract Lock | 1-2 周 | Phase 0 gate |
| Phase 2: Kernel | 3-4 周 | Phase 1 |
| Phase 3: Desktop Runtime | 3-5 周 | Phase 2 |
| Phase 3b: Mobile Runtime | 2-3 周 | Phase 2（并行 Phase 3） |
| Phase 4: Hardening | 2-3 周 | Phase 3 + 3b |
| Phase 5: 收敛 | 1-2 周 | Phase 4 |

**Total**: ~14-22 周。Phase 0 若 gate 不过，按降级路径处理，不阻塞 Mobile。

---

## 11. 风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| Lynx for Web 在某平台 WebView 兼容问题（Worker/CSP/asset） | 中 | 降级到 Shadow DOM + dynamic import，不引入 iframe；贡献上游 patch |
| WebView 后台节流干扰 timer/rAF 语义 | 中 | Kernel 统一发 pause/resume 冻结 applet 侧 timer |
| 多实例内存超预期 | 中 | 严格 LRU + suspend 策略 |
| Desktop/Mobile 事件时序不一致 | 中 | contract test 覆盖事件顺序 |
| Bridge roundtrip 延迟 | 低 | 批量/异步优化，监控 p99 |

---

## 12. 远期观察项（不做）

- **Native FFI 嵌入 Lynx engine**：官方无 Desktop native 集成文档，暂不投入。
- **Lynxtron（Electron X + Lynx）**：Lynx 官方 Desktop 方案，本质是 Electron fork，2026 H1 才逐步开源、非 GA。待成熟且开源可用后，可评估作为 Desktop Shell 替代宿主——届时 SDK/协议/生命周期契约不变，只换容器。
- 不引入 iframe 作为 applet 隔离边界。
- 不用 React mount/unmount 做保活（保活归 Kernel + Surface Manager）。

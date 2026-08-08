# Desktop Applet Runtime Lifecycle

> Status: Desktop 平台落地文档（Phase 5 收敛后的实现真源）。
> Audience: Desktop applet runtime 工程师、reviewer、AI agent。
> Updated: 2026-07-03。

本文档描述 **收敛后（Kernel 单一权威）** 的 Desktop applet 运行时生命周期落地实现。它是平台层文档，向上受两份架构层真源约束，向下对齐 `desktop-web` kernel 契约：

- 架构真源（跨端状态机 / 资源策略）：[`../../architecture/applet-runtime/applet-lifecycle-architecture.md`](../../architecture/applet-runtime/applet-lifecycle-architecture.md)（§3 状态机、§5 资源策略、§6 分层职责）。
- 执行计划：[`../../architecture/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md`](../../architecture/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md)（§6 Phase 3 Desktop、§9 Phase 5 收敛）。
- Desktop kernel 契约（Page / Runtime / Boot）：[`runtime-projections.md §6`](./runtime-projections.md#6-kernel-contracts)。本文所引 `§6.1/§6.2/§6.3` 均指 `runtime-projections.md` 的对应小节。
- Launcher 交互契约（打开入口、身份、恢复态）：[`applet-launcher-ux-contract.md`](./applet-launcher-ux-contract.md)。本文只讲 launcher 之后的运行时生命周期，不重复 launcher UX。

跨端状态机（`cold → materializing → visible → hidden-warm / paused → suspended → destroyed`）与合法转换表冻结在契约包中，Desktop 不重新定义：`packages/applet-contract/src/lifecycle.ts:22`（状态 union）、`:113`（`TRANSITION_RULES`）、`:147`（`isValidTransition`）。

阅读实现前先读这些文件：

- `apps/desktop/src/runtimes/appletsRuntime.ts` — Desktop Lifecycle Adapter（本文核心）。
- `apps/desktop/src/applet/kernel/{desktopKernel,DesktopPlatformAdapter,DesktopSessionBackend,DesktopAuditSink,SurfaceManager}.ts` — 组装根 + adapter + 单一 unload 路径。
- `apps/desktop/src/pages/AppletRuntimePage.descriptor.tsx` — 页面帧 `keepAlive:'forever'`。
- `apps/desktop/src/applet/lynx-host-element.ts` — `<lynx-host>` Custom Element，只释放渲染资源、不自决 session 回收。
- `packages/applet-kernel/src/{index,ports,policy,resource-scheduler,lifecycle-orchestrator}.ts` — 跨端内核。

---

## 1. 职责划分：Page / Runtime / Boot 与 Kernel

收敛后的所有权边界（执行计划 §6.1 的"结构决策：Kernel 单一权威"落地）：

| 层 | 归属实现 | 职责 | 不负责 |
|----|---------|------|--------|
| Shell / 页面 descriptor | `apps/desktop/src/pages/AppletRuntimePage.descriptor.tsx:28` | 保证 applet 页面 React frame 常驻（`keepAlive:'forever'`） | **不做任何 LRU / 淘汰 / destroy 决策** |
| Lifecycle Adapter（Runtime） | `apps/desktop/src/runtimes/appletsRuntime.ts:298`（`appletsRuntime`） | 持有页面 lease、把页面/窗口信号翻译成 Kernel 生命周期事件、跑周期 sweep + 内存监控喂给 Kernel | 不决定何时回收（只喂信号） |
| SurfaceManager（Desktop 适配层） | `apps/desktop/src/applet/kernel/SurfaceManager.ts:72` | 拥有每个 instance 的 `<lynx-host>` DOM 挂载点，执行 Kernel 下发的 `mount/show/hide/detach/destroy` | 不决定何时回收 |
| `AppletKernel.ResourceScheduler` | `packages/applet-kernel/src/resource-scheduler.ts:34` | **唯一** LRU / TTL / 内存压力决策者（只产出事件，不改 registry） | — |
| `LifecycleOrchestrator` | `packages/applet-kernel/src/lifecycle-orchestrator.ts:41` | 实例状态**唯一写入者**；`destroy/error` 时自行 `sessions.destroy` + `registry.remove` | 不含 LRU/TTL 策略 |

Desktop Kernel 组装根（进程级单例）注入六个协作者：`apps/desktop/src/applet/kernel/desktopKernel.ts:45`（`clock` / `kernelLogger` / `DesktopPlatformAdapter` / `DESKTOP_RESOURCE_POLICY` / `DesktopSessionBackend` / `DesktopAuditSink`）。

---

## 2. Kernel 单一权威（消除"双 LRU"）

收敛前存在"双 LRU"：`PageHost` 的 `keepAlive:{lru:4}`（`display:none` 保活、超 cap 卸载）与 `AppletKernel.ResourceScheduler`（`lruSize:4` + TTL + 内存压力）语义完全重叠，两套淘汰权威并存（执行计划 §6.1、Phase 0 §3 保活缺口）。

收敛后：applet 页面帧翻转为 `keepAlive:'forever'`，`PageHost` 不再对 applet 做任何 LRU/eviction；`AppletKernel.ResourceScheduler` 成为 **唯一** LRU/TTL/内存压力回收权威。descriptor 处有显式注释禁止再引入页面级 LRU：`apps/desktop/src/pages/AppletRuntimePage.descriptor.tsx:25-29`。

Desktop 资源策略数值：`lruSize:4`、`maxSuspended:8`、`hiddenWarmTtlMs:30min`、`suspendedTtlMs:120min`、`pausedTtlMs:15min`（`packages/applet-kernel/src/policy.ts:17`）。Scheduler 的 sweep 逻辑（TTL pass → LRU eviction pass → suspended overflow pass，每 instance 每轮最多一个决策）见 `packages/applet-kernel/src/resource-scheduler.ts:49`；内存压力分级（`moderate` 淘汰最旧 suspended、`critical` 回收所有非 visible）见 `:128`。

---

## 3. 单一 unload 路径（消除"双 unload"）

收敛前 `<lynx-host>` 的 `disconnectedCallback` 会自决 `destroyLynxView → unloadApplet`（销毁 session），与 Orchestrator 的 `destroy` 语义冲突形成双重 unload（执行计划 Phase 0 §3）。

收敛后 session 销毁**只有一条路径**：

```text
Orchestrator.dispatch(destroy)
  → adapter.applySurfaceCommand('destroy')   // 只移除 host + <lynx-view>
  → sessions.destroy(sessionId)              // 唯一 session 回收点
  → registry.remove(instanceId)
```

- Orchestrator 的 `destroy`/`error` 分支在 `packages/applet-kernel/src/lifecycle-orchestrator.ts:103-116`：先 surface `destroy`，再 `sessions.destroy`，再 `registry.remove`；`error` 会先 `incrementCrashCount` 记录 crash。
- `DesktopSessionBackend.destroySession` 委托给 `AppletManager.unloadApplet`（`AppletManager` 是 session/manifest 的唯一所有者，按 `appletId` 存储），并注释"只有 Orchestrator 的 destroy/error 路径会调用"：`apps/desktop/src/applet/kernel/DesktopSessionBackend.ts:53-58`。
- `<lynx-host>` 的 `disconnectedCallback` 现在**只释放自身渲染资源**（`<lynx-view>` 子节点 + 事件轮询），显式注释"never self-destroys the capability session"：`apps/desktop/src/applet/lynx-host-element.ts:186-194`、`:265-288`（`teardownLynxView`）。
- SurfaceManager 的 `destroy` 命令也注释"DOES NOT destroy the session（Orchestrator 已 sessions.destroy + registry.remove）"：`apps/desktop/src/applet/kernel/SurfaceManager.ts:16-19`、`:171-179`。

> 旧的示例页 `apps/desktop/src/pages/AppletExample.tsx` **已被移除**（它直接调用 `AppletManager.unloadApplet` 绕开 Kernel）。验证：全仓 `apps/desktop/src` 内已无 `AppletExample` 引用。页面层不再自行决定 destroy。

Lifecycle Adapter 的 `releaseAppletPage` 在有 Kernel instance 时只 dispatch `destroy`（走上面单一路径）；仅当没有 instance 时（防御性）才回退到 store 的直接 unload：`apps/desktop/src/runtimes/appletsRuntime.ts:254-266`。

---

## 4. instanceId = pageId 策略

Desktop 采用"每个 applet 页面一个 instance"，`instanceId = pageId = 'applet:<appletId>'`，与 `AppletManager` 的 `appletId` 一一映射（Desktop 不做同一 applet 多开，执行计划 §6.4）。

- 页面前缀常量 `APPLET_PAGE_PREFIX = 'applet:'`：`apps/desktop/src/runtimes/appletsRuntime.ts:19`；`appletIdFromPageId` 反解 `:34`。
- `surfaceTarget` 用 `{ appletId, instanceId: pageId }`：`:39`。
- 冷启注册 `registry.create({ appletId, instanceId: pageId, ... })`：`:230-238`。
- `AppletManager` 仍按 `appletId` 存 session/manifest；`DesktopSessionBackend` 记录 `sessionId → appletId` 以便只带 `sessionId` 的 destroy 能回收 AppletManager 条目：`apps/desktop/src/applet/kernel/DesktopSessionBackend.ts:20-21`。

---

## 5. 冷启首帧：为什么不 dispatch `show`

冷启（首次 `acquirePage`）流程：`loadApplet`（materialize bundle + 建立 AppletManager capability session）→ `sessions.create`（adopt AppletManager session，记录 `instanceId→appletId`）→ `registry.create`（初始 `materializing`）→ `dispatch('ready')`（`materializing → visible`）→ `applySurfaceCommand('show')` 挂首帧。实现见 `apps/desktop/src/runtimes/appletsRuntime.ts:204-245`。

关键点：**首帧通过 `applySurfaceCommand('show', target)` 直接挂载，而不是 dispatch 一个 `'show'` 事件**。原因是冻结状态机中 `show` 的合法源是 `hidden-warm/paused/suspended`，**不含 `visible`**（`packages/applet-contract/src/lifecycle.ts:119`）；`ready` 已把状态推到 `visible`，再从 `visible` dispatch `show` 会被 Orchestrator 拒为非法转换。注释见 `appletsRuntime.ts:196-203`。单测断言了这一点：冷启会 dispatch `ready`、**不会** dispatch `show`、并且调用 surface `show` 命令（`appletsRuntime.test.ts:199-211`）。

> 若页面已有 warm instance（从后台切回），则走合法的 `show` dispatch（`hidden-warm/paused/suspended → visible`）：`appletsRuntime.ts:220-225`。

Orchestrator 对 `launch`/`ready`/`pause` 不下发 surface 命令；`show`/`restore`/`resume` → surface `show`，`hide` → surface `hide`，`suspend` → surface `detach`（`packages/applet-kernel/src/lifecycle-orchestrator.ts:172-192`）。

---

## 6. 页面 lease、active-page 桥、pause/resume 事件流

### 6.1 页面资源 lease（acquire / release）

`appletsRuntime` 实现 `RuntimeDescriptor` 的可选 `acquirePage/releasePage` 钩子（`runtime-projections.md §6.1`），由 PageHost 的页面 lease 派发触发：

- `acquirePage(pageId)`：见 §5 冷启，或对已有 warm instance 走 `show`（`appletsRuntime.ts:343-345` → `:204`）。幂等：若该 pageId 已持有相同 appletId 的 lease 则直接返回（`:207`）。
- `releasePage(pageId)`：走 §3 单一 unload 路径（`:346-348` → `:254`）。
- 因为 applet 页面帧是 `keepAlive:'forever'`，**普通页面切换不会触发 `releasePage`**；释放只发生在 explicit-close 或 Kernel LRU/TTL 淘汰。用户显式关闭时 `AppletRuntimePage` 先导航回 launcher 再 `requestPageRuntimeRelease(pageId, 'explicit-close')`：`apps/desktop/src/pages/AppletRuntimePage.tsx:58-59`、`:64-65`。

### 6.2 active-page 桥（hide / show 可见性轴）

由于页面帧常驻、PageHost 切换时不发 release，applet 的 hide/show 可见性轴由 **active-page 桥** 单独驱动：

- `ReadyView` 监听 `router.page`，每次变化调用 `notifyActiveAppletPage(router.page)`：`apps/desktop/src/views/ReadyView.tsx:65-67`。
- `notifyActiveAppletPage` 维护单一前台 pageId：离开当前 applet 时对旧实例 dispatch `hide`（`visible → hidden-warm`，保活），进入 warm applet 时 dispatch `show`：`apps/desktop/src/runtimes/appletsRuntime.ts:275-296`。
- 单测覆盖 A→B→A 切换：切回时 B `hide`、A 从 hidden-warm `show`（`appletsRuntime.test.ts:233-253`）。

### 6.3 后台 pause / 前台 resume（窗口 blur/focus + visibilitychange）

`install` 注册 `document.visibilitychange` 与 `window.focus/blur` 监听（`appletsRuntime.ts:306-312`），只对**单一前台 applet**做 app 级 pause/resume：

- 窗口 blur / 页面 hidden → `pauseForegroundApplet`：仅当前台实例处于 `visible` 时 dispatch `pause`（`visible → paused`），accepted 后调用 `surfaces.signalPause(target)`：`appletsRuntime.ts:138-149`、`handleWindowBlur` `:129`、`handleVisibilityChange` `:114`。
- 窗口 focus / 页面 visible → `resumeForegroundApplet`：仅当前台实例处于 `paused` 时 dispatch `resume`，accepted 后 `surfaces.signalResume(target)`：`:151-162`、`:124`、`:116-118`。visible/focus 还顺带触发一次 catalog reconcile。

**pause/resume 不携带 surface 命令**（Orchestrator 对 `pause` 不下发 surface 命令，`resume → show`），applet 侧 timer/rAF 冻结/解冻通过 SurfaceManager 的 `signalPause/signalResume` 单独驱动（`apps/desktop/src/applet/kernel/SurfaceManager.ts:121-132`），最终由 `<lynx-host>` 的 `surfacePause/surfaceResume` 向 applet SDK 发 `pause`/`resume` 事件（`apps/desktop/src/applet/lynx-host-element.ts:315-329`）。`<lynx-host>` 内已删除由 `visibilitychange/blur` 自发 pause 的旧逻辑，改由 Kernel 统一下发（`:599-602`）。单测覆盖 blur→pause+signalPause、focus→resume+signalResume（`appletsRuntime.test.ts:305-336`）。

---

## 7. Surface 命令映射

Orchestrator 下发的 surface 命令经 `DesktopPlatformAdapter.applySurfaceCommand`（`apps/desktop/src/applet/kernel/DesktopPlatformAdapter.ts:50-52`）路由到 `SurfaceManager`（`apps/desktop/src/applet/kernel/SurfaceManager.ts:101-119`），严格对齐冻结的 Orchestrator 语义：

| 命令 | 触发的 Orchestrator 事件 | SurfaceManager 动作 | 实现 |
|------|-------------------------|---------------------|------|
| `show` | `show`/`restore`/`resume`（及冷启首帧直呼） | 无 host 则 mount `<lynx-host>`；已 detach 则 `surfaceRemount`；`display:block` | `SurfaceManager.ts:134-149` |
| `hide` | `hide` | `display:none`（保活，DOM + bundle 保留） | `:151-158` |
| `detach` | `suspend` | 移除 `<lynx-view>` 子节点（释放渲染资源），保留 host 壳供 `restore` instant 重挂 | `:160-169` |
| `destroy` | `destroy`/`error`（及 memory-pressure/TTL 到期收敛为 destroy） | 彻底移除 host + `<lynx-view>`；**不**销毁 session | `:171-179` |

注：`mount` 是 `show` 的内部步骤，Orchestrator 从不单独下发 `mount`（`SurfaceManager.ts:103-106` 把 `mount` 与 `show` 合并）。host `<-> ` 页面通过 `bindSlot` 解耦：页面帧（LynxContainer）拥有 DOM slot 与回调，SurfaceManager 拥有 host 元素，wiring 与 `show`/`bindSlot` 到达顺序无关（`:75-99`、`:206-228`）。

---

## 8. 定时器与阈值

`appletsRuntime.install` 启动的定时器（`apps/desktop/src/runtimes/appletsRuntime.ts:301-313`）：

| 定时器 | 周期 | 动作 | 常量 |
|--------|------|------|------|
| catalog reconcile | 60s | `useAppletsStore.refresh()` 刷新目录投影 | `APPLET_CATALOG_RECONCILE_MS` `:16` |
| Kernel sweep | 60s | `kernel.runSweep(Date.now())`（喂 TTL/LRU 决策给 Kernel） | `KERNEL_SWEEP_MS` `:17`（`scheduleKernelSweep` `:71`） |
| memory sample | 30s | `sampleMemoryPressure()` → 越阈值则 `kernel.handleMemoryPressure(level, now)` | `MEMORY_SAMPLE_MS` `:18`（`scheduleMemoryMonitor` `:99`） |

内存压力阈值（读 `performance.memory` 的 `usedJSHeapSize / jsHeapSizeLimit`，`sampleMemoryPressure` `:89-97`）：

- ratio ≥ 0.90 → `critical`（`CRITICAL_HEAP_RATIO` `:21`）
- ratio ≥ 0.75 → `moderate`（`MODERATE_HEAP_RATIO` `:20`）
- 否则不发信号

Kernel 是权威：runtime 只按固定节奏喂 `now` / 采样级别，**由 Kernel 决定回收什么**。单测断言每个 sweep 周期恰好调用一次 `runSweep`、teardown 后停止（`appletsRuntime.test.ts:255-276`），以及 heap 越 0.75/0.90 阈值分别路由 `moderate`/`critical`（`:278-303`）。

此外 `install` 还会在空闲期预热 Lynx-for-Web runtime（`scheduleLynxRuntimePrewarm` `:164`），`teardown` 清理所有定时器 + 监听并对残留 lease dispatch `destroy`（`:314-336`）。

---

## 9. 审计与安全

`DesktopAuditSink.record` 把 Kernel 的权限决策写入统一 logger，只记 `appletId/instanceId/method/granted/timestamp/reason`，**绝不记 sessionId、token 或 PII**（`apps/desktop/src/applet/kernel/DesktopAuditSink.ts:14-31`）。Scheduler 日志只记事件计数、不记实例身份（`packages/applet-kernel/src/resource-scheduler.ts:121-124`）。

---

## 10. 验证

| 手段 | 位置 / 命令 | 覆盖 |
|------|------------|------|
| Runtime wiring 单测 | `apps/desktop/src/runtimes/appletsRuntime.test.ts` | 目录 reconcile、lease acquire/release 幂等、冷启 register/ready/首帧 show（不 dispatch show）、A→B 切换保活 + LRU release、active-page 桥 hide/show、Kernel sweep 定时器、内存压力阈值路由、blur/focus pause-resume |
| Kernel 单测 | `packages/applet-kernel/tests/*.test.mjs` | 状态机转换、LRU、TTL、内存压力、crash recovery（执行计划 §5 验收） |
| Contract 单测 | `packages/applet-contract/tests/lifecycle.test.mjs` | 合法/非法转换、事件顺序 |
| 平滑度门禁 | `tooling/scripts/applet-desktop-lifecycle-smoothness-gate.mjs` | 静态校验 explicit-close 延迟释放、close 先导航后释放、launcher 刷新不整屏 loading、A→B 切换 lease 语义，并跑 `pageRuntimeLease.test.ts` + `appletsRuntime.test.ts`，产出 `tooling/acceptance/evidence/applets/desktop/lifecycle-smoothness-gate/` 证据 |

平台通用验证命令（`AGENTS.md §10`）：`cd apps/desktop && pnpm run check && pnpm run test && pnpm run build`。

> 门禁的 `unprovenScope` 明确记录：这是本地 acceptance gate，**不等于**打包后的产品窗口浏览器 E2E；带两个 applet 卡片的完整 A→B 可视化切换仍需产品窗口 harness（`applet-desktop-lifecycle-smoothness-gate.mjs:104-108`）。

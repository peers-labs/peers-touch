# Frontend Runtime Architecture — 集成与迁移

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-07-02 | **Updated**: 2026-08-27
> **Owner**: Client Platform Team
> **Module**: `docs/client/common/ui-identity/`, `docs/client/desktop/`, `apps/desktop/src/`

---

## 1. 上下游关系

```text
docs/architecture/frontend-runtime/
  owns: cross-client runtime model, scheduling, lifetime, budget, evidence

docs/client/common/ui-identity/frontend-component-tree.md
  implements: component tree layers, alive taxonomy, review rules

docs/client/common/ui-identity/frontend-component-tree-registry.md
  records: per-surface lifetime, owner, budget, evidence

docs/client/desktop/runtime-projections.md
  implements: Desktop PageDescriptor, RuntimeDescriptor, BootPipeline

docs/architecture/mobile/
  implements: Mobile NavigationHost, dependency-aware RuntimeDescriptor,
              InteractionAdmission adapter, native lifecycle evidence

apps/desktop/src/kernel/
  implements: PageHost, Runtime registry, scheduling, profiler, SectionHost
```

## 2. 与 UI Identity 的关系

UI Identity 回答“产品应该感觉如何”；Frontend Runtime 回答“实现树怎样加载、保活、调度和观测，才能持续给出这种感觉”。

Required updates:

- `frontend-component-tree.md` 必须引用本架构作为上游。
- `frontend-component-tree-registry.md` 必须补 budget/evidence 口径。
- UI review checklist 的 frontend tree 项必须要求性能证据或明确 `unproven`。

## 3. 与 Desktop Runtime Projections 的关系

Desktop `runtime-projections.md` 已经定义：

- `RuntimeDescriptor`
- `PageDescriptor`
- Boot phases
- Page-local prefetch
- Page runtime leases

Frontend Runtime 作为上游补齐：

- 为什么这些契约存在。
- 跨端与 Applet 容器的统一生命周期语言。
- click frame、hidden alive tree、section lazy、applet container、profiler 的架构要求。

Required updates:

- `runtime-projections.md` 应引用 `architecture/frontend-runtime/`。
- `PageDescriptor` 后续可扩展 `budget` 或通过 registry 关联 budget。
- `PageHost` 应输出 dev-only route-to-visible 和 mount cost。

## 4. 与 Applet Runtime 的关系

Applet Runtime 负责 applet manifest、SDK、service binding、Lynx bridge 和 applet-local product logic。

Frontend Runtime 负责 host container：

- embedded mode
- immersive container fullscreen
- standalone product window
- floating controls
- runtime page lease
- debug/error visibility
- host shell recovery

Required updates:

- `AppletRuntimePage` 应逐步瘦身为 PageBoundary。
- `AppletContainerShell` 应成为 applet 容器能力 owner。
- Applet registry row 需要记录 `embedded / immersive / standalone` 三种模式 evidence。

## 5. 与 Mobile Shell 的关系

Mobile Shell refines this cross-client architecture without creating a second
scheduler or admission model:

- `MobilePageDescriptor` is the Mobile platform form of `RuntimeSurface`; its
  lifetime values use the shared alive taxonomy.
- Mobile `RuntimeDescriptor.dependsOn` adds hard readiness order;
  `RuntimeDescriptor.uses` declares degradable capabilities. This is a
  platform-specific extension of `RuntimeProjection`, not a competing runtime
  abstraction.
- `commandRuntime` implements `InteractionAdmission` for Mobile writes. The
  frontend contract still owns work class, cancellation, idempotency,
  backpressure, QoS, and evidence semantics.
- The Rust encrypted ledger is Mobile persistence infrastructure behind
  `commandRuntime`; it does not create a second business retry policy.
- Mobile runtime bootstrap uses the existing 5-second network budget. OAuth
  user waiting is governed by the Station attempt expiry and is not counted as
  runtime bootstrap.
- Mobile event control/data queues implement the same bounded admission and
  payload-class separation required by D-16.

The canonical Mobile refinement lives in `docs/architecture/mobile/`. Changes
to shared admission semantics must update this architecture first; Mobile may
only specialize storage, host events, and platform lifecycle.

## 6. 与现有卡顿实现的关系

当前实现只能按证据声明其局部作用，不视为最终架构闭环：

| 当前实现 | 架构位置 | 当前可声明范围 | 不可声明范围 |
|----------|----------|----------------|----------------|
| 登录后 deferred runtime projections | Scheduler / RuntimeProjection | 部分启动工作移出 visible path | packaged native 登录不卡 |
| `AppSideNav` 收窄 store selector | StoreSubscription | 减少特定订阅 fanout | 全局输入/导航不卡 |
| Settings section memo + delayed active content | SectionHost | 降低特定 section 重渲染 | native/web 等价 |
| InvokeThrottler | Interaction boundary | 记录/调度部分 invoke | IPC 是已确认唯一根因 |
| Applet standalone/fullscreen UI | AppletContainerShell | 容器交互语义 | native runtime 性能闭环 |

## 7. Native evidence ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|-------|-------|----------|------------|---------------|
| Desktop Native 输入和标签切换曾明显慢于历史非 Native baseline | `verified_fact` (user observation) | 多轮用户验收反馈 | medium | Native interaction-linked trace |
| 仓库存在大量同步 Tauri command wrapper | `verified_fact` | 2026-07-11 repository inventory: 420 command attributes, 411 sync | high | runtime thread attribution |
| 同步 command 运行在 tokio worker | rejected prior claim | Tauri 2.5.5 macro `body_blocking` 直接调用 command function | high | 实际 host thread name |
| `tauri-webview-dev` runtime cell 已证明输入/导航性能 | rejected prior claim | matrix cell is `diagnostic incomplete`; Playwright artifact only proves one overlay interaction | high | input/nav native samples |
| Station 中存在标记为 `tauri-webview-dev` 的性能 rollup | `verified_fact` | Station mirror report | high | target interaction raw events are 0 |
| WKWebView IPC 是唯一根因 | `hypothesis` | native/browser boundary difference only | low | interaction-linked bridge/thread trace |
| WebSocket + 16 threads 是终态最优解 | `proposal` withdrawn pending evidence | no native comparative experiment | low | evidence-backed ADR |

Evidence status:

- D-18 retires the non-Native Desktop baseline. Historical diagnostic rows
  cannot enter current proof.
- `DESIGN_EVIDENCE_BLOCKED` for native transport topology.
- Existing frontend runtime ownership, visible-lane, lifecycle, budget, and
  evidence contracts remain active.
- A transport or execution-pool ADR may be proposed only after raw evidence
  links input/paint, React/store, bridge/handler/event, and native thread samples.

## 8. Target integration conditions

The target architecture requires these relationships, independent of delivery
order:

- `NavigationShell`, login/PIN, Settings tabs, overlays, and text inputs emit a
  common interaction boundary before visible state changes.
- `InteractionAdmission` owns bounded queues, supersession, cancellation,
  idempotency class, overload, and payload class across all frontend callers.
- `FrontendRuntimeProfiler` correlates visible paint, React commit, store update,
  hidden render, bridge, handler, event, and native process evidence.
- `desktop_api` and any future bridge implement the same admission/evidence
  contract; transport modules do not own business retry or page freshness.
- RuntimeProjection remains the freshness owner after any bridge change.
- Large binary/stream work has independent flow control from visible
  control-plane work.
- The native runtime cell is fail-closed until dev and packaged cells produce
  interaction-linked evidence.

No compatibility or cutover strategy is defined here. Those choices belong to
an execution plan generated after D-15/D-16 and the final transport ADR are
accepted.

## 9. 验收映射

| 验收项 | 证据 |
|--------|------|
| 主导航切换不卡 | dev-native/packaged-native route-to-visible P95/P99，long task < budget |
| Settings tabs 不粘滞 | interaction-linked SectionHost、React commit、store fanout、bridge/handler evidence |
| 任何文本/PIN 输入不卡 | input-to-paint P95 ≤50ms，并关联 native thread/bridge evidence |
| 登录背景动画不停止 | login input/paint + runtime bootstrap + compositor/native evidence |
| 用户狂点不积压 | bounded admission、latest-wins/cancel/reject evidence；无无界 queue |
| 断线不重复副作用 | non-idempotent write unknown-outcome/idempotency evidence |
| 大载荷不拖慢控制面 | concurrent binary/stream 下 control-plane P95 仍达预算 |
| Applet 像小程序容器 | embedded/immersive/standalone screenshots + lifecycle lease logs |
| 架构不是补丁 | docs 真源、registry、profiler、CI gate 都闭环 |

# Frontend Runtime Architecture — 架构设计

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-07-02 | **Updated**: 2026-07-11
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/src/kernel/`, `apps/desktop/src/runtimes/`, `docs/client/common/ui-identity/`

---

## 1. 核心原则

1. **UI 是运行时，不是页面集合** — Peers Touch 客户端由长期运行的 shell、页面实例、runtime projections、嵌入式容器和 overlay 组成，必须由内核统一调度。
2. **点击帧优先** — 用户点击主导航、Settings tab、登录/PIN、打开 applet 时，第一帧只允许更新可见状态和轻量反馈；数据、bundle、schema、projection、heavy mount 必须后移。
3. **生命周期声明化** — page、section、overlay、applet instance 都必须声明 preload、keepAlive、cache、lease、budget 和 owner。
4. **数据 freshness 属于 runtime** — 业务投影由 runtime/store 负责事件消费和 reconciliation，页面是纯 renderer，不能靠 mount effect 成为 freshness 真源。
5. **隐藏树必须可治理** — alive tree 可以保留局部状态，但必须有 store selector 边界、context 稳定性、render budget 和 long-task 证据。
6. **容器是一级运行单元** — Applet/Lynx 不是普通页面内容，而是嵌入式 app runtime；宿主拥有 shell、全屏、独立窗口、调试、lease 和恢复。
7. **证据先于拓扑** — 历史 browser/native 差异只能作为诊断背景；当前结论必须来自同账户、同数据、同 warmup、同交互的 native trace，不能将 IPC、线程池、WebSocket、HTTP 或 React/store 任一因素直接写成唯一根因。
8. **交互工作必须可治理** — 点击、输入、导航和 overlay 后触发的工作必须具备有界准入、优先级、取消/合并、公平性和明确失败语义；无界队列或自动重放不得被称为背压。

## 2. 系统架构

```text
Frontend Runtime Kernel
  |
  +-- AppShell
  |     +-- boot state / identity gate / global providers
  |     +-- NavigationShell
  |     +-- OverlayHost
  |
  +-- Scheduler
  |     +-- click-frame lane
  |     +-- first-paint lane
  |     +-- idle-prewarm lane
  |     +-- background-reconcile lane
  |     +-- teardown / eviction lane
  |
  +-- PageHost
  |     +-- PageDescriptor registry
  |     +-- PageFrame visibility
  |     +-- keepAlive forever / LRU / none
  |     +-- page runtime leases
  |
  +-- SectionHost
  |     +-- selected-only section
  |     +-- lazy schema mount
  |     +-- hidden render guard
  |     +-- section-local prefetch
  |
  +-- RuntimeProjection
  |     +-- install / bootstrap / reconcile / teardown
  |     +-- event consumption
  |     +-- periodic repair
  |     +-- store projection
  |
  +-- AppletContainerShell
  |     +-- embedded mode
  |     +-- immersive container fullscreen
  |     +-- standalone product window
  |     +-- floating controls
  |     +-- Lynx host bridge
  |
  +-- Profiler
        +-- route-to-visible
        +-- mount cost
        +-- hidden render count
        +-- long task attribution
        +-- runtime bootstrap timing
        +-- native interaction cohort
        +-- bridge / handler / event attribution
```

### 2.1 跨端映射

| 架构域 | Desktop | Mobile | Applet/Lynx |
|--------|---------|--------|-------------|
| AppShell | Tauri desktop shell + `GlobalLayout` | native/mobile shell | applet host shell |
| PageHost | `kernel/PageHost.tsx` keep-alive registry | active-only tab host | applet runtime page host |
| Scheduler | `boot.ts`, `requestIdleCallback`, PageHost prewarm | navigation/tab scheduler | host controls + Lynx lifecycle |
| RuntimeProjection | `runtimes/*Runtime.ts` + Zustand stores | feature runtimes + stores | applet manifest/session/runtime projection |
| SectionHost | Settings/provider/logs lazy sections | active tab sections | applet shell panels/debug |
| AppletContainer | Desktop embedded/standalone window | mobile mini-app shell future | Lynx view + bridge |
| Profiler | dev runtime instrumentation | mobile perf hooks future | lifecycle/debug events |

### 2.2 Desktop native responsiveness boundary

```text
User Input / Navigation Intent
  |
  +-- Visible Commit Lane
  |     +-- route / active state / caret / pressed feedback
  |     +-- must reach paint without waiting for bridge or business I/O
  |
  +-- Interaction Work Admission
        +-- interactive latest-wins work
        +-- cancellable prefetch / reconciliation
        +-- bounded background maintenance
        |
        +-- Device Bridge Boundary
        |     +-- request / response / event / stream attribution
        |     +-- transport selected only by accepted evidence-backed ADR
        |
        +-- RuntimeProjection / local Rust / Station

Native Evidence Correlator
  +-- input timestamp / visible paint
  +-- React commit / store update / hidden render
  +-- bridge request / handler execution / event delivery
  +-- WebView main-thread long task / native process sample
```

The architecture owns the responsiveness outcome and work-admission semantics.
It does not preselect a device-bridge transport. Tauri invoke, localhost HTTP,
WebSocket, native channel, thread isolation, or a combination remain platform
implementation proposals until the native evidence gate can distinguish their
cost under the same workload.

## 3. 核心接口

### 3.1 Runtime surface contract

```ts
interface FrontendRuntimeSurface {
  id: string;
  owner: 'PageHost' | 'SectionHost' | 'OverlayHost' | 'AppletContainerShell';
  preload: 'eager' | 'idle' | 'on-visit' | 'intent';
  keepAlive: 'forever' | 'none' | { lru: number };
  runtimeOwners: readonly string[];
  budget: RuntimeBudget;
}

interface RuntimeBudget {
  clickFrameMs: number;
  mountMs: number;
  hiddenRenderPerMinute: number;
  longTaskMs: number;
  memoryPolicy: 'forever' | 'selected-only' | 'lru' | 'virtual-window' | 'none';
}
```

### 3.2 Scheduler contract

```ts
interface FrontendScheduler {
  visible(action: () => void): void;
  afterFirstPaint(action: () => void): () => void;
  idleChunk(label: string, action: () => void | Promise<void>, timeoutMs?: number): () => void;
  background(label: string, action: () => void | Promise<void>): void;
  teardown(label: string, action: () => void | Promise<void>): void;
}
```

Rules:

- `visible` 只能做 route、active state、loading/preparing state。
- `idleChunk` 每次只允许处理一个 heavy page/section/runtime。
- `background` 不得阻塞 route-to-visible。
- `teardown` 可滞后，但必须绑定 LRU、explicit close 或 session edge。

### 3.3 SectionHost contract

```ts
interface SectionDescriptor {
  id: string;
  parentPage: string;
  mount: 'selected-only' | 'first-visit-cache' | 'intent';
  cache: 'none' | 'selected-only' | { lru: number };
  prefetch?: 'idle' | 'intent' | 'never';
  runtimeOwners: readonly string[];
  budget: RuntimeBudget;
}
```

Rules:

- Settings shell 可以 alive，但 provider editor、model discovery、logs、statistics、advanced panels 必须是 section-level lifecycle。
- Hidden section 不得执行重 schema render、模型发现、全量列表 map 或日志面板更新。
- Section prefetch 只允许缓存 one-shot 小数据；长期 freshness 必须归 runtime。

### 3.4 AppletContainerShell contract

```ts
interface AppletContainerMode {
  mode: 'embedded' | 'immersive' | 'standalone';
  controls: {
    close: boolean;
    hide: boolean;
    exitFullscreen: boolean;
    debug?: boolean;
  };
  lease: 'active-page' | 'standalone-window' | 'lru-cache';
}
```

Rules:

- Embedded mode 保留 Desktop shell 和 PageHeader，适合 applet 管理上下文。
- Immersive mode 在当前容器内全屏，必须保留浮动退出/隐藏/关闭控制。
- Standalone mode 是独立产品窗口，不能显示 Desktop 全局侧栏。
- Applet content 永远 applet-local；host 只拥有 shell、trust、preparing、failure、debug、lease。

### 3.5 Interaction work admission contract

```ts
interface InteractionWork {
  id: string;
  interactionId: string;
  owner: string;
  class: 'visible' | 'interactive-read' | 'interactive-write' | 'background' | 'stream';
  supersessionKey?: string;
  idempotency: 'read' | 'idempotent-write' | 'non-idempotent-write';
  payloadClass: 'control' | 'stream' | 'large-binary';
  deadlineMs: number;
}

interface InteractionAdmission {
  submit<T>(work: InteractionWork, run: (signal: AbortSignal) => Promise<T>): Promise<T>;
  cancel(workId: string, reason: 'superseded' | 'route-change' | 'timeout' | 'shutdown'): void;
  snapshot(): {
    admitted: number;
    queued: number;
    rejected: number;
    byClass: Record<InteractionWork['class'], number>;
  };
}
```

Rules:

- `visible` feedback never waits for business bridge or network completion.
- Search, tab refresh, and replaceable reads use `supersessionKey` and latest-wins semantics.
- Non-idempotent writes are never automatically replayed after disconnect or timeout.
- Queue and inflight limits are bounded per runtime, not only per component or window.
- Large binary/stream traffic cannot share an unbounded FIFO with visible control work.

### 3.6 Native evidence contract

```ts
interface NativeInteractionEvidence {
  interactionId: string;
  runtime: 'tauri-webview-dev' | 'tauri-webview-packaged';
  scenario: 'text-input' | 'primary-nav' | 'secondary-tab' | 'overlay';
  inputAt: number;
  visibleAt?: number;
  settledAt?: number;
  reactCommitMs?: number;
  storeFanout?: number | 'unknown';
  longTasks: readonly number[];
  bridgeCalls: readonly {
    command: string;
    queuedMs?: number;
    handlerMs?: number;
    roundTripMs: number;
  }[];
  cohort: {
    profile: string;
    account: string;
    dataRevision: string;
    warmup: boolean;
  };
}
```

Historical browser samples are non-authoritative diagnostics. Runtime labels
without interaction-linked native raw events are metadata, not proof of a
native root cause.

## 4. 组件关系

### 4.1 NavigationShell -> PageHost

NavigationShell 只更新 route/active page，不等待数据。PageHost 根据 descriptor 决定当前页面是否已挂载；未挂载时在下一帧或 idle slot 挂载，而不是在点击 handler 内同步 materialize 重页面。

### 4.2 PageHost -> RuntimeProjection

PageHost 不直接加载业务数据。它只发 page runtime lease：

- `activate`：当前页面需要页面级 runtime 资源。
- `prewarm`：idle 预热页面需要可取消资源。
- `explicit-close`：用户主动关闭动态实例。
- `evict`：LRU 淘汰。
- `unmount`：非 alive 页面离开。

RuntimeProjection 决定如何 load/unload/reconcile。

### 4.3 RuntimeProjection -> StoreSubscription

RuntimeProjection 写入 store；页面/section 通过精确 selector 读取。长驻 shell、侧栏、隐藏页面禁止整 store 订阅。

### 4.4 SectionHost -> FeatureComponent

SectionHost 控制 section 是否 mounted、hidden、cached 或 evicted。FeatureComponent 只渲染任务内容，不拥有跨 section 数据 freshness。

### 4.5 AppletContainerShell -> LynxHost

AppletContainerShell 管理容器模式、浮动控制、debug、window 形态和 page runtime lease。LynxHost 只负责渲染 applet view 和 bridge invocation。

### 4.6 Interaction Boundary -> Device Bridge

The interaction boundary admits work by semantic class and remains independent
of bridge transport. The device bridge reports queue, handler, round-trip,
event, stream, cancellation, and overload evidence back to the profiler. It
must not own page freshness, route state, or retry policy for non-idempotent
business writes.

## 5. 禁止关系

| # | 禁止关系 | 原因 | 决策来源 |
|---|----------|------|----------|
| F-1 | Page 在 click-frame 内发起普通 invoke | IPC / Rust 侧处理可能阻塞主线程，破坏点击帧优先原则 | D-10, D-14 |
| F-2 | Page 通过 mount-time fetch 成为长期 freshness 真源 | 长期业务 freshness 属于 RuntimeProjection，页面只能渲染或做 one-shot prefetch | D-03 |
| F-3 | Hidden section/tree 在 active switch frame 内同步 render | 隐藏树 render 会抢占可见内容上屏预算 | D-04, D-10 |
| F-4 | Runtime bootstrap 同步阻塞 boot pipeline | Runtime bootstrap 必须异步化，超时进入降级模式，不能阻塞 shell first paint | D-09 |
| F-5 | Store dispatch 触发超过 3 个组件重渲染并进入长期 blocking gate | Store fanout 必须通过 selector / batching 治理；该阈值在 D-08/D-12 accepted 前可先 warn-only | D-08, D-12 |
| F-6 | 客户端本地聚合替代 Station mirror 验收/开发证据 | 验收/开发证据需要原始事件支持跨 runtime 归因；生产遥测策略另行 ADR | D-06, D-13 |
| F-7 | 用历史非 Native baseline 与 Native 体感差异直接宣布某个 bridge 或线程模型是根因 | 历史差异不能替代 Native interaction-linked trace | D-15, D-18 |
| F-11 | 为 Desktop 保留 browser launch、transport branch 或 proof matrix | Browser 不覆盖 native window/input/lifecycle，且会形成第二套产品合同 | D-18 |
| F-8 | 无界 pending/inflight/worker queue 被描述为背压 | 狂点、慢依赖和大载荷会把卡顿从 bridge 转移到队列 | D-16 |
| F-9 | 断线或超时后自动重放非幂等写 | 响应丢失时可能重复发消息、创建任务或提交操作 | D-16 |
| F-10 | 大二进制/stream 与可见控制工作共享无优先级 FIFO | 大帧或长流会造成 head-of-line blocking，破坏输入和导航预算 | D-16 |

## 6. 端点 / API

本架构不新增 Station API。它要求客户端内部新增或标准化以下内核能力：

- `PageDescriptor` 扩展预算与 section registry 引用。
- `SectionDescriptor` / `SectionHost` 用于 Settings、provider、logs、diagnostics。
- `FrontendRuntimeProfiler` 采集 route-to-visible、mount cost、hidden render 和 long task。
- `NativeEvidenceCorrelator` 以 interactionId 关联 input/paint、React/store、bridge、handler、event 和 native process evidence。
- `InteractionAdmission` 提供有界准入、latest-wins、取消、优先级、幂等和 overload 语义；具体 transport 不在证据门前预选。
- `AppletContainerShell` 封装 embedded、immersive、standalone 三种模式。
- registry 文档必须登记 surface owner、alive category、budget、evidence 和 revisit condition。

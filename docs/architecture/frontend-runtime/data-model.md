# Frontend Runtime Architecture — 数据模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-07-02 | **Updated**: 2026-07-11
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/src/kernel/`, `docs/client/common/ui-identity/`

---

## 1. Runtime Surface

`RuntimeSurface` 是所有可见/可隐藏前端树的统一登记对象。它不是必须一比一落成 TypeScript 类型，但 registry、descriptor 和 profiler 都应能映射到它。

```ts
type SurfaceKind =
  | 'primary-page'
  | 'dynamic-page'
  | 'settings-section'
  | 'provider-editor'
  | 'overlay'
  | 'large-content'
  | 'applet-container';

type OwnerLayer =
  | 'AppShell'
  | 'NavigationShell'
  | 'PageHost'
  | 'PageBoundary'
  | 'SectionHost'
  | 'OverlayHost'
  | 'AppletContainerShell'
  | 'RuntimeProjection';

interface RuntimeSurface {
  id: string;
  kind: SurfaceKind;
  ownerLayer: OwnerLayer;
  platform: 'desktop' | 'mobile' | 'web' | 'applet' | 'cross-client';
  lifecycle: SurfaceLifecycle;
  runtimeOwners: readonly string[];
  budget: SurfaceBudget;
  evidence: SurfaceEvidence;
}
```

## 2. Surface Lifecycle

```ts
interface SurfaceLifecycle {
  preload: 'eager' | 'idle' | 'on-visit' | 'intent';
  keepAlive: 'forever' | 'none' | { lru: number };
  cachePolicy:
    | 'forever'
    | 'selected-only'
    | 'none'
    | 'virtual-window'
    | { lru: number };
  mountTrigger:
    | 'ready-shell'
    | 'first-idle'
    | 'route-active'
    | 'section-selected'
    | 'explicit-user-intent'
    | 'standalone-window';
  releaseTrigger:
    | 'never'
    | 'inactive'
    | 'explicit-close'
    | 'lru-evict'
    | 'session-end'
    | 'window-close';
}
```

Rules:

- `preload: eager` 只允许 landing/critical surface。
- `preload: idle` 必须分片，不得同一 idle callback 挂多个 heavy surface。
- `keepAlive: forever` 必须有 hidden render guard。
- `keepAlive: { lru }` 必须有 release trigger 和 memory bound。
- `mountTrigger: explicit-user-intent` 不允许被 idle prewarm 偷偷触发。

## 3. Surface Budget

```ts
interface SurfaceBudget {
  clickFrameMs: number;
  routeToVisibleMs: number;
  mountTaskMs: number;
  hiddenRenderPerMinute: number;
  longTaskMs: number;
  memoryPolicy: 'forever' | 'selected-only' | 'lru' | 'virtual-window' | 'none';
}
```

Default budget:

| Surface | clickFrameMs | routeToVisibleMs | mountTaskMs | hiddenRenderPerMinute | longTaskMs |
|---------|--------------|------------------|-------------|-----------------------|------------|
| Primary page return | 16 | 50 | 16 | 0–2 | 50 |
| Primary page first visit | 16 | 120 | 50 | 0–2 | 50 |
| Settings section switch | 16 | 80 | 50 | 0–1 | 50 |
| Provider editor open | 16 | 120 | 50 | 0 | 50 |
| Applet embedded open | 16 | 200 | 50 | 0 | 50 |
| Applet standalone open | 16 | 300 | 50 | 0 | 50 |
| Large list visible update | 16 | 80 | 16 | 0 | 50 |

Notes:

- `clickFrameMs` 只计算可见状态更新，不包括后台数据。
- `routeToVisibleMs` 是用户看到目标页面/准备态的时间。
- `mountTaskMs` 是单个 synchronous mount/render task 预算。
- 超过预算不是自动失败，但必须有 owner、原因和 follow-up。

## 4. Surface Evidence

```ts
interface SurfaceEvidence {
  status: 'proven' | 'unproven' | 'degraded' | 'needs-audit';
  checkedAt?: string;
  method?: 'static' | 'unit-test' | 'browser-sampling' | 'e2e' | 'manual';
  routeToVisibleMs?: number;
  longTasks?: Array<{ durationMs: number; owner?: string }>;
  hiddenRenders?: Array<{ surfaceId: string; count: number }>;
  notes?: string;
}
```

Rules:

- Registry 中标 `alive` 但没有 evidence 时，必须写 `unproven` 或 `needs audit`。
- 性能修复 PR 不能只写“体感变快”，必须记录至少一种 evidence。
- Browser proof 可用 dev profiler、integrated browser、Chrome Performance 或 E2E telemetry。

## 5. Runtime Event

```ts
type FrontendRuntimeEvent =
  | { type: 'route.requested'; pageId: string; at: number }
  | { type: 'route.visible'; pageId: string; at: number }
  | { type: 'surface.mount.start'; surfaceId: string; at: number }
  | { type: 'surface.mount.end'; surfaceId: string; at: number }
  | { type: 'surface.hidden.render'; surfaceId: string; at: number; reason?: string }
  | { type: 'runtime.bootstrap.start'; runtimeId: string; at: number }
  | { type: 'runtime.bootstrap.end'; runtimeId: string; at: number }
  | { type: 'longtask.detected'; durationMs: number; owner?: string; at: number };
```

These events are dev-runtime evidence, not product telemetry by default. Production telemetry requires a separate privacy and sampling decision.

## 6. Interaction Work

`InteractionWork` 是 UI intent 之后进入 runtime/bridge/business 层的最小可治理工作。
它描述语义，不绑定 Tauri invoke、HTTP、WebSocket 或其他 transport。

```ts
type InteractionWorkClass =
  | 'visible'
  | 'interactive-read'
  | 'interactive-write'
  | 'background'
  | 'stream';

interface InteractionWork {
  id: string;
  interactionId: string;
  owner: string;
  workClass: InteractionWorkClass;
  supersessionKey?: string;
  idempotency: 'read' | 'idempotent-write' | 'non-idempotent-write';
  payloadClass: 'control' | 'stream' | 'large-binary';
  deadlineMs: number;
  createdAt: number;
}
```

Rules:

- `visible` work is local and synchronous-light; it cannot wait for business I/O.
- `interactive-read` may use latest-wins and cancellation.
- `interactive-write` must declare idempotency and may not be silently replayed.
- `background` uses bounded admission and cannot preempt visible work.
- `stream` and `large-binary` require independent flow control from control-plane work.

## 7. Work Admission State

```ts
type WorkState =
  | 'created'
  | 'queued'
  | 'admitted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rejected'
  | 'timed-out'
  | 'unknown-outcome';

interface WorkTransition {
  workId: string;
  interactionId: string;
  from: WorkState;
  to: WorkState;
  at: number;
  reason?: string;
}
```

`unknown-outcome` is required when a non-idempotent write may have executed but
its response was lost. It must not be converted into an automatic replay.

Admission bounds are runtime-wide. Per-component or per-window limits alone do
not prove global backpressure.

## 8. Native Evidence Cohort

```ts
interface NativeEvidenceCohort {
  runtime: 'tauri-webview-dev' | 'tauri-webview-packaged';
  profile: string;
  account: string;
  dataRevision: string;
  scenario: 'text-input' | 'primary-nav' | 'secondary-tab' | 'overlay';
  warmup: boolean;
  buildRevision: string;
}

interface NativeInteractionEvidence {
  cohort: NativeEvidenceCohort;
  interactionId: string;
  inputAt: number;
  visibleAt?: number;
  settledAt?: number;
  reactCommitMs?: number;
  storeFanout?: number | 'unknown';
  longTasks: Array<{ durationMs: number; owner?: string }>;
  bridgeCalls: Array<{
    command: string;
    payloadClass: InteractionWork['payloadClass'];
    queuedMs?: number;
    handlerMs?: number;
    roundTripMs: number;
    outcome: 'success' | 'failure' | 'cancelled' | 'timeout' | 'unknown';
  }>;
  nativeSamples?: Array<{
    process: 'webview' | 'desktop-rust';
    thread?: string;
    blockedMs?: number;
    stackCategory?: string;
  }>;
}
```

Comparison rules:

- Cohorts are comparable only when profile, account, data revision, scenario,
  warmup, and build revision match.
- A runtime label without interaction-linked raw events is not root-cause evidence.
- Rollups may summarize accepted raw evidence but cannot replace it.
- Packaged native evidence is mandatory for claims about the shipped Desktop app.

## 9. Native Responsiveness Gates

| Gate | Target |
|------|--------|
| Text input intent-to-paint | P95 ≤ 50ms; P99 and MAX reported |
| Primary navigation intent-to-visible | P95 ≤ 100ms |
| Secondary tab intent-to-visible | P95 ≤ 80ms |
| Interaction long task | No unwaived task > 50ms |
| Work admission | Runtime-wide queues bounded; reject/cancel/supersede evidence present |
| Slow dependency | Latest visible interaction is not queued behind stale replaceable work |
| Disconnect | Non-idempotent write never auto-replayed; unknown outcome surfaced |
| Large payload | Control-plane P95 remains within its budget during concurrent stream/binary load |

Each runtime/scenario cell requires at least 30 post-warmup samples for P95.
Missing native evidence fails closed as `UNPROVEN`; browser evidence is not a substitute.

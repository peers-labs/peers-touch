# Frontend Runtime Architecture — 数据模型

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-02 | **Updated**: 2026-07-02
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

# Desktop Global Lag — Phase 1 Systematic Optimization

> **Status**: superseded
> **Version**: v1.3
> **Created**: 2026-07-10 | **Updated**: 2026-07-20
> **Owner**: @printfcoder
> **Module**: `apps/desktop/src/kernel/`, `tooling/scripts/`
> **Depends on**: Phase 0 evidence infrastructure (6/6 PROVEN, tauri-webview cell closed)
> **Architecture source**: `docs/architecture/platform/client/frontend-runtime/design.md`
> **Based on decisions**: D-02, D-03, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14
> **Language note**: English (consistent with sibling execution-plans in this directory)
> **Superseded by**: `20260713-desktop-native-evidence-matrix-plan.md`; this plan's
> Phase 0 premise and runtime inventory were disproven. A new optimization plan
> must be generated only after P0c3-R9 confirms the root cause and D-15/D-16 are accepted.

---

## 1. Goal

Phase 0 delivered the measurement infrastructure: 6 sampler families PROVEN, SectionHost framework fix (260ms → 1.7ms), tauri-plugin-playwright integrated. The system can now **prove** whether interactions meet budget.

Phase 1 uses these measurements to systematically eliminate remaining lag sources, landing the Scheduler, PageHost LRU, InvokeThrottler, and StoreFanoutGuard architecture components defined in `design.md` but not yet implemented.

**Goal**: All 6 performance budget invariants pass under sampler gate with real user interactions across both `prod-preview` and `tauri-webview` runtime cells.

---

## 2. Deliverables

### In scope

| Domain | Deliverable | Decision |
|--------|-------------|----------|
| FrontendScheduler | `apps/desktop/src/kernel/scheduler.ts` — 5-lane scheduler kernel module | design.md §3.2 |
| PageHost LRU | `apps/desktop/src/kernel/PageHost.tsx` — max 5 hidden pages, LRU eviction | D-07 |
| InvokeThrottler | `apps/desktop/src/kernel/invokeThrottler.ts` — click-frame invoke deferral | D-10 (INV-6) |
| StoreFanoutGuard | `apps/desktop/src/kernel/storeFanoutGuard.ts` — batch dispatch, selector subscriptions, fanout ≤3 | D-08, D-12 |
| RuntimeProjection bootstrap | `apps/desktop/src/kernel/boot.ts` — async bootstrap with 5s timeout, degraded mode | D-03, D-09 |
| Red-line CI gate | `tooling/scripts/desktop-performance-sampler-gate.py` + CI workflow — P95-based fail-closed PR check | D-11, D-13 |
| SectionHost boundary closure | Phase 1c validates hidden render guard through PageHost + existing Settings section paths; full `SectionHost.tsx` module remains a follow-up unless hidden render evidence cannot be closed without it | D-04, D-10 |

### Non-scope

- New product features
- Station / Model layer changes (D-13: Station mirror remains the acceptance/dev evidence truth source; no local aggregation replacing it)
- E2EE crypto performance (separate domain)
- Applet container runtime implementation (separate architecture, see `docs/architecture/platform/applet-runtime/`). If current `AppletRuntimePage` remains under PageHost during Phase 1, PageHost LRU may evict only the page boundary; it must not release standalone applet windows or AppletContainerShell-owned leases.
- Production telemetry privacy/sampling (needs separate ADR)

---

## 3. Architecture Contracts

This section reproduces contracts from upstream sources. **If any contract below conflicts with `design.md`, `design.md` wins.**

### 3.1 Performance Budget Invariants

Budgets derive from Phase 0 telemetry evidence and the existing `data-model.md` surface budget. See D-10 for rationale and terminology:

- `clickFrameMs` remains the `data-model.md` synchronous frame budget (16ms).
- `click-to-first-feedback ≤ 50ms` is a user-perceived feedback budget, not a replacement for `clickFrameMs`.
- `click-to-visible` is a route/surface visibility budget. Phase 1 red-line uses a stricter primary navigation target than the generic `data-model.md` first-visit default; D-10 records this as a Phase 1 gate value.

```
INV-1: click-to-first-feedback ≤ 50ms
INV-2: click-to-visible ≤ 100ms (primary nav), ≤ 80ms (secondary tab)
INV-3: contextmenu-to-visible ≤ 50ms
INV-4: No JS long task > 50ms during interaction phase
INV-5: No hidden-tree render during active switch frame
INV-6: No invoke in click-frame (must defer to afterFirstPaint lane)
```

### 3.2 Scheduler Lane Contract

Exact interface from [design.md §3.2](../design.md#L107-L115):

```typescript
interface FrontendScheduler {
  visible(action: () => void): void;
  afterFirstPaint(action: () => void): () => void;
  idleChunk(label: string, action: () => void | Promise<void>, timeoutMs?: number): () => void;
  background(label: string, action: () => void | Promise<void>): void;
  teardown(label: string, action: () => void | Promise<void>): void;
}
```

Rules (from design.md):

- `visible` may only perform route, active state, and lightweight feedback updates.
- `afterFirstPaint` returns a cancellation function for callers that need to abort deferred work.
- `idleChunk` processes at most one heavy page/section/runtime per invocation; `label` is required for telemetry attribution.
- `background` must not block route-to-visible.
- `teardown` may be delayed but must be bound to LRU eviction, explicit close, or session edge.

### 3.3 Forbidden Relationships

| # | Forbidden | Reason | Decision |
|---|-----------|--------|----------|
| F-1 | Page invokes in click-frame | Blocks main thread → violates INV-1 | D-10 (INV-6) |
| F-2 | Page mount-time fetch | Freshness owned by RuntimeProjection, not Page (D-03) | D-03 |
| F-3 | Hidden section re-render during active switch | Violates INV-5 | D-10 (INV-5) |
| F-4 | Runtime bootstrap synchronously blocking boot pipeline | Must be async with timeout → degraded mode | D-09 |
| F-5 | Store dispatch triggering >3 component re-renders | Fanout must be bounded via selectors and batching | D-08, D-12 |
| F-6 | Local aggregation replacing Station mirror evidence | Station mirror is the acceptance/dev evidence truth source | D-13 |

### 3.4 Security & Logging Constraints

Per [first-principles.md](../../../../../global/first-principles.md):

- **No debug logs**: Scheduler, InvokeThrottler, and kernel modules MUST NOT use `console.log`, `print`, or equivalent in production paths. Use domain-specific loggers only.
- **No secrets in telemetry**: Telemetry events must not contain tokens, passwords, secret keys, or PII. Error telemetry includes context + error code but never credential material.
- **Auth path bypass**: InvokeThrottler MUST provide a `visible`-lane bypass only for a static allowlist of authentication/session-critical operations (login, PIN, token refresh). Every bypass MUST emit `bypassReason` and `securityClass` telemetry and be checked by CI so feature code cannot self-declare a slow invoke as security-critical (D-14, Risk R-3).
- **Fail-closed**: Red-line CI gate blocks merge on failure; a failing gate must not be silently bypassed.

---

## 4. Verification Standard

### Phase-by-phase acceptance

| Phase | Target | Acceptance criteria | Evidence |
|-------|--------|---------------------|----------|
| **1a: FrontendScheduler** | `apps/desktop/src/kernel/scheduler.ts` | `boot.ts` uses scheduler for runtime install/bootstrap/prewarm; no direct `setTimeout`/`requestIdleCallback` in kernel code; all 5 lanes implemented per §3.2 interface | longtask events drop to 0 during primary nav switch; scheduler lane attribution visible in telemetry |
| **1b: InvokeThrottler** | `apps/desktop/src/kernel/invokeThrottler.ts` | All `invoke()` calls routed through throttler; click-frame invokes deferred to `afterFirstPaint`; auth/session ops use static allowlist bypass only | sampler gate `invoke` family shows 0 events with `phase: 'interaction'` + `durationMs > 16`; invoke.started during interaction has `deferred: true` or audited `bypassReason` tag |
| **1c: PageHost LRU + hidden render guard** | `apps/desktop/src/kernel/PageHost.tsx` + current Settings section paths | Max 5 hidden pages retained (D-07); LRU eviction on overflow; hidden-tree render budget enforced; SectionHost hidden render guard either closed through current paths or promoted to explicit Phase 1c-b implementation | PageHost emits `page.evict` telemetry; alive-page-count never exceeds 6 (1 active + 5 hidden); no longtask from hidden tree; hidden section render count meets INV-5 |
| **1d: StoreFanoutGuard** | `apps/desktop/src/kernel/storeFanoutGuard.ts` | Batch dispatch notifications; selector-based subscriptions; fanout ≤3 per dispatch (D-08, D-12). Initial rollout is warn-only until Phase 1d collects enough baseline telemetry, then CI blocking is enabled. | `store.update` events show `fanoutCount ≤ 3`; react.commit events during store.update drop by >50% |
| **1e: RuntimeProjection Bootstrap Guard** | `apps/desktop/src/kernel/boot.ts` | Runtime bootstrap wrapped in 5s timeout (D-09); failure → degraded mode, not blocked boot | `boot.phase` events show `runtime:critical` ≤ 2s total; no longtask during boot; boot-to-firstPaint ≤ 1.5s |
| **1f: Red-Line CI Gate** | `tooling/scripts/desktop-performance-sampler-gate.py` + CI config | Sampler gate runs on every PR touching `apps/desktop/src/`; P95-based thresholds (D-11); fail-closed blocks merge | CI job log shows `status: pass` or `status: fail` with specific family failure; PR with intentional violation blocked; clean PR passes |

### Final Phase 1 acceptance

```bash
make acceptance PLAN=tooling/acceptance/plans/desktop-performance-redline.json
# Expected: all gates pass for both prod-preview and tauri-webview, status: PROVEN
```

Each phase verified by four layers:

1. **Unit test** — kernel module behavior correct, including cancellation functions and edge cases
2. **Telemetry evidence** — sampler family events meet budget with proper lane attribution
3. **Sampler gate** — `--required-runtime prod-preview` + `--required-runtime tauri-webview` both PROVEN
4. **Red-line report** — all 6 invariants (INV-1~INV-6) pass at P95

---

## 5. Dependencies

### Dependency DAG

```
Phase 1a (Scheduler) ─────────┬──── Phase 1b (InvokeThrottler)
                              ├──── Phase 1c (PageHost LRU)
                              └──── Phase 1e (RuntimeProjection Guard)

Phase 1d (StoreFanoutGuard) ──── implementation can run in parallel;
                                  final gate depends on 1a telemetry schema

Phase 1f (Red-Line CI Gate) ──── depends on all 1a-1e complete
```

### Dependency details

| Phase | Depends on | Rationale |
|-------|-----------|-----------|
| 1a | None (foundational) | Scheduler is the scheduling primitive all other phases use |
| 1b | 1a | InvokeThrottler defers work to scheduler lanes |
| 1c | 1a | LRU eviction uses teardown lane |
| 1d | Implementation: none. Final acceptance: 1a telemetry schema and gate integration | Store batching is independent of scheduler code, but its red-line evidence must use the same telemetry attribution model |
| 1e | 1a | Bootstrap guard uses background lane for deferred runtime init |
| 1f | 1a-1e | Gate requires all components implemented and producing telemetry |

---

## 6. Risks & Mitigations

| ID | Risk | Mitigation |
|----|------|------------|
| R-1 | Scheduler introduces new scheduling bugs (e.g., cancelled afterFirstPaint tasks still running) | Each lane has unit tests covering cancellation + profiler evidence; cancellation function from `afterFirstPaint` must reliably abort |
| R-2 | PageHost LRU evicts a page the user returns to → perceived cold mount | Keep 5 most recent (D-07); cold mount target <100ms via prewarm in idleChunk; evicted page shows skeleton/progress |
| R-3 | InvokeThrottler delays time-sensitive operations (auth, token refresh) | `visible` lane bypass for security-critical paths (see §3.4); explicit allowlist of operations that bypass deferral |
| R-4 | StoreFanoutGuard breaks existing UI freshness (components not updating) | Migrate component by component behind feature flag; verify with react.commit evidence and visual E2E |
| R-5 | Red-line gate flaky in CI due to timing variance | Use P95 threshold not MAX (D-11); exclude warmup events; require minimum sample count (N≥30) before pass/fail |
| R-6 | 5s bootstrap timeout kills legitimate slow runtime on cold start | Timeout triggers degraded mode (UI shows "partial functionality available") not hard failure; runtime can continue loading in background |
| R-7 | React 18 concurrent rendering interrupts or replays scheduled work | Scheduler unit tests must cover cancellation/idempotency; scheduled tasks must be idempotent or cancellation-safe |
| R-8 | PageHost LRU conflicts with applet runtime leases | Phase 1 may evict only PageHost-owned page boundaries; standalone applet windows and AppletContainerShell leases remain outside this plan |
| R-9 | StoreFanoutGuard migration touches many Zustand subscriptions at once | Start with warn-only telemetry, migrate by store/domain behind feature flags, and enable blocking after baseline is stable |
| R-10 | macOS CI runner noise makes P95 unstable | Require N≥30 samples, exclude warmup, pin runner profile where possible, and allow rerun-on-infra-noise only with preserved failed report |

---

## 7. Decision Maturity Gate

| Decision | Required before |
|----------|-----------------|
| D-07 | Phase 1c blocking LRU gate |
| D-08 / D-12 | Phase 1d blocking fanout gate; warn-only can start while proposed |
| D-10 | Any red-line budget assertion |
| D-11 | Phase 1f CI gate |
| D-13 | Station mirror evidence gate; production telemetry remains out of scope |
| D-14 | Phase 1b auth/session bypass implementation |

---

## 8. Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1a — Scheduler | ⬜ pending | — | |
| Phase 1b — InvokeThrottler | ⬜ pending | — | |
| Phase 1c — PageHost LRU | ⬜ pending | — | |
| Phase 1d — StoreFanoutGuard | ⬜ pending | — | |
| Phase 1e — RuntimeProjection Guard | ⬜ pending | — | |
| Phase 1f — Red-Line CI Gate | ⬜ pending | — | |

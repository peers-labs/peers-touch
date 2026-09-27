---
name: pt-desktop-runtime-projections
description: >
  Use when working under apps/desktop/src/{kernel,runtimes,services,store,pages,components}.
  Enforces the Page / Runtime / Boot kernel contracts, projection ownership, and
  startup pipeline rules for the Desktop client. Single source of truth:
  docs/client/desktop/runtime-projections.md.
---

# Desktop Runtime Projections

Before fixing stale Desktop UI state or adding a new page, read [`docs/client/desktop/runtime-projections.md`](../../../docs/client/desktop/runtime-projections.md). This skill is the operational checklist; the doc is the contract.

Applies to changes under:

- `apps/desktop/src/kernel/`
- `apps/desktop/src/runtimes/`
- `apps/desktop/src/services/`
- `apps/desktop/src/store/`
- `apps/desktop/src/pages/`
- `apps/desktop/src/components/`

## Runtime ownership

Runtime-backed state must be owned by the runtime/store, not by incidental page lifecycle:

- `socialRealtime` (wrapped by `runtimes/socialRuntime.ts`) owns friendship,
  contact, profile, presence, and Social notification freshness.
- `apps/desktop/src/messaging/runtime.ts` owns session-scoped Chat command
  admission, projection invalidation, reconciliation, and actor/Station/device
  scope reset; `runtimes/messagingRuntime.ts` is only its Kernel adapter.
- `runtimes/searchRuntime.ts` owns the search source list (app-scope).
- `runtimes/settingsRuntime.ts` owns the active-account snapshot and agents list.
- `notification` store owns notification list and counters.
- `navigationBadges` owns cross-surface badge projection.
- Components render state and dispatch user actions; they are not the primary sync mechanism.

Every business projection needs:

1. An event or notification consumption path for immediate updates.
2. A periodic reconciliation path for dropped events, reconnects, hidden windows, and process pauses.

Do not fix issues only by adding `useEffect(...load...)` to a page, tab, or modal. A component load is only a fallback after the owning runtime has a real consumer and reconciliation path.

## New runtime checklist

When adding new long-lived projection state:

- Implement a `RuntimeDescriptor` in `apps/desktop/src/runtimes/<id>Runtime.ts`.
- Register it in `services/appRuntime.ts → registerKernelRuntimes`.
- Both `install/teardown` MUST be idempotent. `bootstrap` MUST short-circuit on actor re-bootstrap.
- Add a periodic `reconcile` if the projection can drift (missed SSE events, hidden window, process pause).
- Session-scoped runtimes MUST reject stale asynchronous completions and clear
  the prior identity projection before activating a new actor, Station, or
  device scope.
- Cross-process invalidation payloads MUST decode from the canonical Proto
  contract. Duplicate/stale cursors are no-ops; gaps and unknown kinds require
  full reconciliation rather than inferred local truth.

## New page checklist

When adding a new page that should keep state across tab switches or that has a heavy initial mount:

- Implement a `PageDescriptor` in `apps/desktop/src/pages/<Name>.descriptor.tsx`.
- Register it in `pages/registry.ts → registerKernelPages`.
- Pages MUST be pure renderers. Mount-time `useEffect` is reserved for view-bound side-effects (focus, scroll restore, transient subscriptions). Mount-time API calls are forbidden — own the data in a Runtime or use `kernel/usePrefetch` for one-shot section data.
- Choose `preload: 'idle'` + `keepAlive: 'forever'` for high-frequency surfaces; `'eager' + 'forever'` only for the landing page; `'on-visit'` only for rare, lightweight pages.

Adding a new page to the legacy `PageRouter` (instead of as a `PageDescriptor`) requires an explicit reason in the PR description.

## Boot pipeline

Boot phases are observable through `kernel/boot.ts → markPhaseStart/End`. Do not silently re-do work other phases own:

- `runtime:critical` covers `installAppRuntime`. Do not bootstrap critical runtimes from page lifecycle.
- `runtime:idle` and `pages:prewarm` happen during the first idle window. Pre-warm hacks inside individual pages are forbidden — push them to the kernel.
- `firstPaint` is owned by `<ReadyView />`; do not move it.

If an issue can only be reproduced on the *first* click of a tab, the fix usually belongs in (a) the page descriptor (preload/keepAlive), (b) the owning runtime's bootstrap, or (c) `kernel/usePrefetch` — not in a new mount-time effect.

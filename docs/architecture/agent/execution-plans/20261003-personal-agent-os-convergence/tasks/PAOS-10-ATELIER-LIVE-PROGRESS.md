# PAOS-10-ATELIER-LIVE-PROGRESS - Canonical Atelier stream

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-10-ATELIER-LIVE-PROGRESS",
  "workstreamId": "PAOS-ATELIER",
  "title": "Replace the Atelier mock entrypoint with live Goal projection",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-atelier-live-progress",
  "journeyId": "PAOS-J02-EVENTS",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop/src-tauri/src/application/applets/mod.rs","apps/applets/atelier/frontend/src/index.tsx","apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx","apps/applets/atelier/frontend/src/application/useAtelierController.ts","apps/applets/atelier/frontend/src/application/projectionReducer.ts","apps/applets/atelier/frontend/src/application/projectionReducer.test.ts","apps/applets/atelier/frontend/src/application/eventStreamEventGuard.test.ts","apps/applets/atelier/frontend/src/infrastructure/capability/atelierClient.ts","apps/applets/atelier/frontend/src/infrastructure/capability/atelierClient.test.ts"],
  "readSet": ["apps/station/app/subserver/events","apps/station/app/subserver/agent/service/atelier_projection.go","apps/applets/atelier/contracts/atelier-projection.contract.json"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"atelier-live-ui","command":"pnpm --filter @peers-touch/atelier-official-applet exec vitest run","verificationClass":"UX_REVIEW"},
    {"id":"atelier-live-functional","command":"PEERS_ATELIER_PRODUCT_WINDOW_E2E_READ_ONLY=1 pnpm run applet:atelier-product-window-gate","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["The shipped Atelier page calls useAtelierController and contains no MOCK state","A Goal event received through canonical SSE updates the visible task","Duplicate events apply once and cursor gaps enter reconciliation","The real product-window check observes the Goal action and Station-backed revision"],
  "failureBehavior": ["Host mode never falls back to mock seed data","Malformed events cannot advance the projection cursor"],
  "updatedAt": "2026-10-05T04:43:00Z",
  "durableEvidence": [
    {
      "verificationClass": "UX_REVIEW",
      "result": "PASS",
      "ref": "vitest:atelier-official-applet;tests:97/97;desktop-applet-tests:38/38;desktop-check:pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "tooling/acceptance/evidence/applets/official-applet/atelier-product-window-gate.json;sha256:b0f5857b405c48c904982ac74fe6ef1d49a8ac7368304e91e1b7fada7e8f8ded;mode:read-only-canonical-projection"
    }
  ]
}
```

## Four-Hour Delivery

- User action: open Atelier while the Goal advances in Home.
- Visible result: the same Goal revision updates in the official applet.
- Station readback: event id, sequence, Goal id, and snapshot revision agree.
- Lane: Atelier; the private-stream hard cut follows as a separate slice.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Functional slice complete.

- The shipped Atelier page reads the Station snapshot and contains no mock
  runtime state.
- Canonical `/events/stream` invalidation seq `4` triggered one authoritative
  snapshot reconciliation and rendered block `atelier-real-product-event-4`.
- The product window reported `replayLabel=4/4 · seq 4`, `viewStatus=ready`,
  and a clean `atelier.projection.unsubscribe` on close.
- Create-from-goal remains intentionally excluded here because its canonical
  TaskRun writer cutover is owned by `PAOS-13B`.
- Final suite-lifecycle Acceptance remains owned by `PAOS-30`.

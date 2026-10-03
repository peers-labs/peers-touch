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
    {"id":"atelier-live-functional","command":"pnpm run applet:atelier-product-window-gate","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["The shipped Atelier page calls useAtelierController and contains no MOCK state","A Goal event received through canonical SSE updates the visible task","Duplicate events apply once and cursor gaps enter reconciliation","The real product-window check observes the Goal action and Station-backed revision"],
  "failureBehavior": ["Host mode never falls back to mock seed data","Malformed events cannot advance the projection cursor"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: open Atelier while the Goal advances in Home.
- Visible result: the same Goal revision updates in the official applet.
- Station readback: event id, sequence, Goal id, and snapshot revision agree.
- Lane: Atelier; the private-stream hard cut follows as a separate slice.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

The controller exists, but the shipped `AtelierAppletPage` still renders hardcoded mock data.

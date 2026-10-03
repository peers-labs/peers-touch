# PAOS-27-ATELIER-STATE-MATRIX - Complete workbench states

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-27-ATELIER-STATE-MATRIX",
  "workstreamId": "PAOS-ATELIER",
  "title": "Complete Atelier recovery, localization, and accessibility states",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-atelier-state-matrix",
  "journeyId": "PAOS-J02,PAOS-J03,PAOS-J04",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/applets/atelier/frontend/package.json","apps/applets/atelier/frontend/src/application/pageComposition.ts","apps/applets/atelier/frontend/src/application/officialRecoveryView.ts","apps/applets/atelier/frontend/src/application/viewStatus.ts","apps/applets/atelier/frontend/src/application/atelierViewState.test.ts","apps/applets/atelier/frontend/src/application/controllerTransitions.test.ts","apps/applets/atelier/frontend/src/infrastructure/i18n/messages.ts","apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx","apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.css","apps/applets/atelier/frontend/locales/en.json","apps/applets/atelier/frontend/locales/zh-CN.json","tooling/scripts/atelier-official-frontend-gate.mjs","tooling/scripts/applet-atelier-product-window-gate.mjs","tooling/scripts/applet-atelier-product-window-failure-matrix-gate.mjs"],
  "readSet": ["docs/client/common/ui-identity/interaction.md","docs/client/common/ui-identity/accessibility.md","docs/client/common/ui-identity/modules/agent/README.md"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"atelier-state-matrix-ui","command":"pnpm --filter @peers-touch/atelier-official-applet exec vitest run src/application/atelierViewState.test.ts src/application/controllerTransitions.test.ts && pnpm run atelier:official-frontend-gate","verificationClass":"UX_REVIEW"},
    {"id":"atelier-state-matrix-functional","command":"pnpm run applet:atelier-product-window-gate && pnpm run applet:atelier-product-window-failure-matrix-gate && pnpm run atelier:projection-contract-gate","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Atelier renders loading, empty, error, reconnecting, resync, stale, conflict, unauthorized, budget-exhausted, ACCEPTED, PARTIAL, FAILED, and CANCELLED states","Retry, create, and terminal actions are mutually exclusive and policy-correct","English and Simplified Chinese expansion fit wide and narrow layouts","Keyboard focus, labels, contrast, and reduced motion pass"],
  "failureBehavior": ["Unauthorized is not retryable","Recovery states never masquerade as empty or accepted"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: traverse the workbench by keyboard under each injected state.
- Visible result: one coherent localized state with the correct action and focus.
- Station readback: recovery states reconcile to authoritative projection or remain blocked.
- Lane: Atelier final UI pass.
- Scope guard: reuse existing view-state helpers and product-window harness;
  add only missing state rows and localized action oracles, with no Desktop
  shell change, business command, or projection field.

## Current Snapshot

State helpers exist, but the shipped mock page does not consume them and hardcodes copy.

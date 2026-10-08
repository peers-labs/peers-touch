# PAOS-23-ATELIER-GOAL-GRAPH - Inspectable workbench

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-23-ATELIER-GOAL-GRAPH",
  "workstreamId": "PAOS-ATELIER",
  "title": "Inspect the Goal contract and live Task graph in Atelier",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-atelier-goal-graph",
  "journeyId": "PAOS-J02",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/atelier_projection.go","apps/station/app/subserver/agent/service/atelier_projection_test.go","apps/applets/atelier/contracts/atelier-projection.contract.json","apps/applets/atelier/frontend/src/domain/projection.contract.generated.ts","apps/applets/atelier/frontend/src/domain/projection.ts","apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx","apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.css","packages/prototypes/desktop/applets/atelier/src/Page.tsx","packages/prototypes/desktop/applets/atelier/src/theme.ts","packages/prototypes/desktop/applets/atelier/src/prototypeRightRailProjection.ts","packages/prototypes/desktop/applets/atelier/src/prototypeRightRailProjection.test.ts","docs/architecture/atelier/execution-plans/functional-modules.md","docs/architecture/atelier/prototype/README.md","tooling/scripts/atelier-official-frontend-gate.mjs","tooling/acceptance/gates/agent/personal_goal_slices/paos_23_atelier_goal_graph.py"],
  "readSet": ["docs/client/common/ui-identity/modules/agent/README.md","apps/applets/atelier/frontend/src/application/useAtelierController.ts"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_23_atelier_goal_graph.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"atelier-goal-graph-ui","command":"pnpm --filter @peers-touch/atelier-official-applet exec vitest run && pnpm run atelier:official-frontend-gate","verificationClass":"UX_REVIEW"},
    {"id":"atelier-goal-graph-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*Atelier.*(Goal|TaskGraph)' -count=1","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Atelier shows Goal contract, revision, graph roots, edges, nodes, attempts, and budget","Wide Desktop uses the active continuous three-rail contract; narrow containers preserve one dominant rail","Task selection shows why the node is ready, blocked, running, or terminal","Atelier remains a read/write projection and cannot schedule nodes"],
  "failureBehavior": ["Do not preserve the stale single-column-only Gate on wide Desktop","Do not expose a generic manual workflow editor"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: open a Goal in Atelier and select a graph node.
- Visible result: responsive task, work, and context rails show the canonical graph.
- Station readback: selected node and graph revision match the projection.
- Lane: Atelier; also reconciles stale draft docs/Gates to the active UI Identity.
- Scope guard: reuse the existing Goal/TaskGraph projection fields and
  controller; this slice changes layout and rendering only, with no graph
  mutation, scheduler, or new applet capability.

## Current Snapshot

Atelier has graph projection helpers, but the shipped page is mock and its draft layout rules conflict with the active Agent UI contract.

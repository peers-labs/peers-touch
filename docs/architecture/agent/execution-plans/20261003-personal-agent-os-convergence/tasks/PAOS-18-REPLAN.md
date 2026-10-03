# PAOS-18-REPLAN - Bounded graph repair

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-18-REPLAN",
  "workstreamId": "PAOS-AUTONOMY",
  "title": "Approve a replan while preserving accepted work",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-replan",
  "journeyId": "PAOS-J03",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_replan_service.go","apps/station/app/subserver/agent/service/goal_replan_service_test.go","apps/station/app/subserver/agent/service/goal_coordinator.go","apps/station/app/subserver/agent/infrastructure/persistence/goal_graph_revision.go","apps/applets/atelier/frontend/src/application/decisionActionGuards.ts","apps/applets/atelier/frontend/src/presentation/components/GoalReplanDiff.tsx","apps/applets/atelier/frontend/src/presentation/components/GoalReplanDiff.test.tsx","tooling/acceptance/gates/agent/personal_goal_slices/paos_18_replan.py"],
  "readSet": ["apps/station/app/subserver/agent/service/goal_decision_service.go","apps/applets/atelier/frontend/src/application/useAtelierController.ts"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_18_replan.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"goal-replan-ui","command":"pnpm --filter @peers-touch/atelier-official-applet exec vitest run src/application/decisionActionGuards.test.ts src/presentation/components/GoalReplanDiff.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"goal-replan-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*Goal.*(Replan|AcceptedAnchor)' -count=1","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Atelier shows retained, reset, and added nodes before approval","Approved replan creates one new graph revision","Accepted nodes and evidence remain anchored","Rejected or stale approval changes no work"],
  "failureBehavior": ["Do not reset accepted nodes","Do not apply an applet-authored graph as authority"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: inspect and approve a proposed graph patch.
- Visible result: `REPLANNING` followed by a graph with retained/reset/added markers.
- Station readback: one new graph revision preserves accepted anchors.
- Lane: Atelier decision path; serial after Needs You.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Existing supervisor replan uses task metadata and is not tied to a Goal graph revision.

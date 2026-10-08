# PAOS-17-NEEDS-YOU - Actionable intervention

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-17-NEEDS-YOU",
  "workstreamId": "PAOS-AUTONOMY",
  "title": "Present and resolve one typed Needs You decision",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-needs-you",
  "journeyId": "PAOS-J03",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_decision_service.go","apps/station/app/subserver/agent/service/goal_decision_service_test.go","apps/station/app/subserver/agent/infrastructure/persistence/goal_decision.go","apps/station/app/subserver/agent/service/home_projection_service.go","apps/desktop/src/components/home/GoalNeedsYouPanel.tsx","apps/desktop/src/components/home/GoalNeedsYouPanel.test.tsx","apps/desktop/src/store/goalDecisions.ts","packages/locales/en/agent.json","packages/locales/zh-CN/agent.json","tooling/acceptance/gates/agent/personal_goal_slices/paos_17_needs_you.py"],
  "readSet": ["apps/station/app/subserver/agent/infrastructure/persistence/interrupt_request.go","model/domain/agent/goal.proto"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_17_needs_you.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"needs-you-ui","command":"pnpm --dir apps/desktop exec vitest run src/components/home/GoalNeedsYouPanel.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"needs-you-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*Goal.*Decision' -count=1","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Needs You shows reason, evidence, spent cost, consequence, recommendation, and allowed choices","Selecting a choice uses expected revision and one idempotency key","Loading and disabled state belong to the selected decision","Station-selected outcome is rendered exactly once"],
  "failureBehavior": ["A conflict preserves the decision and offers authoritative reload","Policy hard deny never exposes an invalid continue action"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: open Needs You and choose one allowed action.
- Visible result: local pending feedback followed by Station-confirmed resolution.
- Station readback: decision id, revision, evidence, and outcome agree.
- Lane: Home decision UI; isolated from cancellation and Atelier graph files.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Home lists generic Needs You items but does not render the decision contract.

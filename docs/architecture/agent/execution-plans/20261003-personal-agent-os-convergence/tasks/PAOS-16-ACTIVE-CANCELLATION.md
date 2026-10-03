# PAOS-16-ACTIVE-CANCELLATION - Stop running work

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-16-ACTIVE-CANCELLATION",
  "workstreamId": "PAOS-AUTONOMY",
  "title": "Cancel a running Goal without late-result resurrection",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-active-cancellation",
  "journeyId": "PAOS-J02",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_cancellation_service.go","apps/station/app/subserver/agent/service/goal_cancellation_service_test.go","apps/station/app/subserver/agent/service/goal_coordinator.go","apps/desktop/src/components/home/GoalActiveCancelControl.tsx","apps/desktop/src/components/home/GoalActiveCancelControl.test.tsx","apps/desktop/src/services/goal-service.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_16_active_cancellation.py"],
  "readSet": ["apps/station/app/subserver/agent/service/goal_direct_model_executor.go","apps/desktop/src/store/goalExecution.ts"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_16_active_cancellation.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"active-cancel-ui","command":"pnpm --dir apps/desktop exec vitest run src/components/home/GoalActiveCancelControl.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"active-cancel-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*Goal.*(Cancel|LateResult)' -count=1","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["User sees cancelling before Station confirms CANCELLED","Cancellation intent persists before executor signaling","Late executor results cannot reopen or accept the Goal","Refresh preserves the terminal cancellation and reusable evidence"],
  "failureBehavior": ["A failed signal does not erase durable cancellation intent","Do not hide artifacts already committed before cancellation"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: cancel a running Goal.
- Visible result: `CANCELLING` then Station-confirmed `CANCELLED`.
- Station readback: cancellation revision remains terminal after a late result.
- Lane: Home; may run beside Needs You and Atelier graph work with isolated files.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Existing cancellation is task-specific and not anchored to Goal revision.

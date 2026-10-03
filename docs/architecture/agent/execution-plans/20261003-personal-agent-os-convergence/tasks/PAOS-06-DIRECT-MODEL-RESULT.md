# PAOS-06-DIRECT-MODEL-RESULT - First visible result

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-06-DIRECT-MODEL-RESULT",
  "workstreamId": "PAOS-RUNTIME",
  "title": "Complete one TaskRun through Direct Model",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-direct-model-result",
  "journeyId": "PAOS-J02-RUNTIME",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_direct_model_executor.go","apps/station/app/subserver/agent/service/goal_direct_model_executor_test.go","apps/station/app/subserver/agent/service/orchestration_service.go","apps/station/app/subserver/agent/infrastructure/persistence/direct_run.go","apps/station/app/subserver/agent/service/goal_result_projection.go","apps/desktop/src/components/home/GoalResultSummary.tsx","apps/desktop/src/components/home/GoalResultSummary.test.tsx","apps/desktop/src/store/goalExecution.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_06_direct_model_result.py"],
  "readSet": ["apps/station/app/subserver/agent/service/turn_service.go","apps/station/app/subserver/agent/service/runtime_admission_service.go"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_06_direct_model_result.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"direct-goal-result-source","command":"git diff --check -- apps/station/app/subserver/agent apps/desktop/src","verificationClass":"SOURCE_CHECK"},
    {"id":"direct-goal-result-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*GoalDirectModel' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/components/home/GoalResultSummary.test.tsx","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Direct Model executes through the TaskRun attempt","Home shows running then succeeded or failed with result summary","At least one durable artifact or failure artifact is linked","The executor cannot set Goal terminal state"],
  "failureBehavior": ["Provider failure remains a TaskRun failure with evidence","Do not bypass budget, policy, trace, or acceptance"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: start a simple Goal using Direct Model.
- Visible result: running state followed by a result or evidence-backed failure.
- Station readback: TaskRun, step, usage, and artifact agree with the UI.
- Lane: runtime adapter; may run beside the outbox and migration slices after `PAOS-05`.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

DirectRun exists but is not yet attached to a first-class Goal lifecycle.

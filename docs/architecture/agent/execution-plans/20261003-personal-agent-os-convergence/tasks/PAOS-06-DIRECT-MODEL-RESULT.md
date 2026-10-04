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
  "updatedAt": "2026-10-04T15:53:25Z",
  "durableEvidence": [
    {
      "kind": "development-native-journey",
      "status": "passed",
      "sourceCommit": "3860a4fca4fea75b0036d4efd9cde9c74f2684ae",
      "artifact": "~/.peers-touch/dev/workspaces/872e6a11e6df33b5/workflow/personal-agent-os-convergence-20261003/artifacts/20261004T155222849819Z/paos-06-direct-model-result/capture.json",
      "manifestDigest": "90fb3f2914020fa36db18a860c31e3a0fd0a4ddbb52c00f4032c067749307434"
    }
  ]
}
```

## Four-Hour Delivery

- User action: start a simple Goal using Direct Model.
- Visible result: running state followed by a result or evidence-backed failure.
- Station readback: TaskRun, step, usage, and artifact agree with the UI.
- Lane: runtime adapter; may run beside the outbox and migration slices after `PAOS-05`.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Completed on source commit `3860a4fca4fea75b0036d4efd9cde9c74f2684ae`.

- Goal Start atomically creates the canonical TaskRun attempt and its
  Station-owned DirectRun binding without writing AgentTask or CollaborationTask.
- The Direct Model adapter records ordered Task events, usage, gate evidence,
  and a durable result or failure artifact.
- Home reconstructs running and terminal Goal execution state after refresh and
  shows the Station-authored result summary.
- The executor updates TaskRun, ExecutionStep, and AgentGoalNode only; the Goal
  remains RUNNING for independent acceptance.
- Profile `two` native Tauri proof passed with a successful result, 769 tokens,
  exact source/runtime identity, and clean resource teardown.

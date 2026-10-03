# PAOS-05-FIRST-TASKRUN - First executable node

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-05-FIRST-TASKRUN",
  "workstreamId": "PAOS-CORE",
  "title": "Create and display the first canonical TaskRun",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-first-taskrun",
  "journeyId": "PAOS-J02",
  "runtimeClass": "native-desktop",
  "writeSet": ["model/domain/agent/orchestration.proto","apps/station/app/subserver/agent/model/orchestration.pb.go","apps/desktop/src/gen/proto/domain/agent/orchestration_pb.ts","apps/station/app/subserver/agent/service/goal_execution_service.go","apps/station/app/subserver/agent/service/goal_execution_service_test.go","apps/station/app/subserver/agent/infrastructure/persistence/task_run.go","apps/station/app/subserver/agent/service/home_projection_service.go","apps/desktop/src/components/home/GoalRunSummary.tsx","apps/desktop/src/components/home/GoalRunSummary.test.tsx","apps/desktop/src/store/goalExecution.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_05_first_taskrun.py"],
  "readSet": ["apps/station/app/subserver/agent/infrastructure/persistence/execution_step.go","apps/desktop/src/pages/HomePage.tsx"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1200,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_05_first_taskrun.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"first-taskrun-source","command":"bash model/build.sh && git diff --check -- model/domain/agent apps/station/app/subserver/agent apps/desktop/src","verificationClass":"SOURCE_CHECK"},
    {"id":"first-taskrun-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*Goal.*TaskRun' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/components/home/GoalRunSummary.test.tsx","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Starting a Goal creates one GoalNode, TaskRun, ExecutionStep, and attempt identity","Home shows that TaskRun as pending or running","Selecting the row reads its canonical Station identifiers","No AgentTask or CollaborationTask is created for this new Goal"],
  "failureBehavior": ["A failed TaskRun allocation leaves the Goal non-running","Do not synthesize progress from elapsed time or local state"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: start a Goal and open its first work item.
- Visible result: one canonical TaskRun with status and attempt identity.
- Station readback: Goal, node, TaskRun, and step identities agree.
- Lane: Station integration; may run beside `PAOS-04`.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

TaskRun exists, but Goal admission does not yet allocate it as the visible unit of work.

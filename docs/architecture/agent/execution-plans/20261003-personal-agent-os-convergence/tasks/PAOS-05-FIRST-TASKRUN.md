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
  "updatedAt": "2026-10-04T19:10:00Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:d0eee05ca9e3e25fd8f501d27054c8cbacdd3060;model-build:pass;agent-go-tests:pass;desktop-check-vitest-eslint:pass;personal-goal-source-gate:pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "development://personal-agent-os-convergence-20261003/artifacts/20261004T150950278013Z/paos-05-first-taskrun/capture.json;manifest-sha256:2d527f6cf860a7d85e617eaaf8f1dfb4773ee743ec7b53c7b48384cee87585c3"
    }
  ]
}
```

## Four-Hour Delivery

- User action: start a Goal and open its first work item.
- Visible result: one canonical TaskRun with status and attempt identity.
- Station readback: Goal, node, TaskRun, and step identities agree.
- Lane: Station integration; may run beside `PAOS-04`.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Functional slice complete.

- Goal Start atomically creates one canonical GoalNode, TaskRun,
  ExecutionStep, and attempt.
- Home exposes the Station-authored identities and does not create AgentTask or
  CollaborationTask for the new Goal.
- Source and Profile `two` Native evidence are recorded above.
- Final suite-lifecycle Acceptance remains owned by `PAOS-30`.

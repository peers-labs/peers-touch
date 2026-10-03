# PAOS-13-TASK-WRITER-CUTOVER - Home and Chat work writes

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-13-TASK-WRITER-CUTOVER",
  "workstreamId": "PAOS-MIGRATION",
  "title": "Route Home and Chat work commands to TaskRun",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-home-chat-writer-cutover",
  "journeyId": "PAOS-J02-CUTOVER",
  "runtimeClass": "native-desktop",
  "writeSet": ["model/domain/agent/orchestration.proto","apps/station/app/subserver/agent/model/orchestration.pb.go","apps/desktop/src/gen/proto/domain/agent/orchestration_pb.ts","apps/station/app/subserver/agent/service/home_command_service.go","apps/station/app/subserver/agent/service/home_command_service_test.go","apps/station/app/subserver/agent/service/chat_task_service.go","apps/station/app/subserver/agent/service/chat_task_recovery_test.go","apps/station/app/subserver/agent/handler/agent_task_handler.go","apps/desktop/src/acceptance/agent/taskRunCutover.test.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_13_task_writer_cutover.py"],
  "readSet": ["apps/station/app/subserver/agent/infrastructure/persistence/agent_task.go","apps/station/app/subserver/agent/infrastructure/persistence/orchestration.go"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_13_task_writer_cutover.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"task-writer-cutover-source","command":"bash model/build.sh && git diff --check -- model/domain/agent apps/station/app/subserver/agent tooling/acceptance","verificationClass":"SOURCE_CHECK"},
    {"id":"task-writer-cutover-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*(Home|Chat).*TaskRun' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/acceptance/agent/taskRunCutover.test.ts","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Home task and Chat promotion create only TaskRun execution state","Each command returns the canonical TaskRun identity","No new AgentTask execution row is written","Existing migrated work remains visible"],
  "failureBehavior": ["Legacy data remains readable until reader cutover and recovery pass","Missing migration identity fails closed"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: create work from Home and promote one Chat.
- Visible result: both Desktop paths open one canonical TaskRun.
- Station readback: no legacy execution row was added.
- Lane: Station integration; serialized shared writer cutover.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Three public creation paths still write different task authorities.

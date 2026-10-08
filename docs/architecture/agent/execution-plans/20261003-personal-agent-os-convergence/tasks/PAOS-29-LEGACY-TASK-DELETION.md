# PAOS-29-LEGACY-TASK-DELETION - Single task authority

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-29-LEGACY-TASK-DELETION",
  "workstreamId": "PAOS-MIGRATION",
  "title": "Delete legacy task authorities after visible recovery proof",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-legacy-task-deletion",
  "journeyId": "PAOS-J02-HARD-CUT",
  "runtimeClass": "native-desktop",
  "writeSet": ["model/domain/agent/task.proto","model/domain/agent/orchestration.proto","apps/station/app/subserver/agent/model/task.pb.go","apps/station/app/subserver/agent/model/orchestration.pb.go","apps/desktop/src/gen/proto/domain/agent/task_pb.ts","apps/desktop/src/gen/proto/domain/agent/orchestration_pb.ts","apps/mobile/src/gen/proto/domain/agent/task_pb.ts","apps/mobile/src/gen/proto/domain/agent/orchestration_pb.ts","apps/station/app/subserver/agent/domain/event.go","apps/station/app/subserver/agent/infrastructure/persistence/agent_task.go","apps/station/app/subserver/agent/infrastructure/persistence/orchestration.go","apps/station/app/subserver/agent/infrastructure/persistence/models.go","apps/station/app/subserver/agent/infrastructure/persistence/migrations.go","apps/station/app/subserver/agent/service/agent_task_service.go","apps/station/app/subserver/agent/service/acceptance_predicate_evaluator.go","apps/station/app/subserver/agent/service/atelier_projection.go","apps/station/app/subserver/agent/service/atelier_projection_test.go","apps/station/app/subserver/agent/service/canvas_readiness_guard_test.go","apps/station/app/subserver/agent/service/chat_task_service.go","apps/station/app/subserver/agent/service/chat_task_recovery_test.go","apps/station/app/subserver/agent/service/engine_policy.go","apps/station/app/subserver/agent/service/gate_runner.go","apps/station/app/subserver/agent/service/gate_runner_test.go","apps/station/app/subserver/agent/service/home_command_service.go","apps/station/app/subserver/agent/service/home_command_service_test.go","apps/station/app/subserver/agent/service/home_projection_service.go","apps/station/app/subserver/agent/service/home_projection_service_test.go","apps/station/app/subserver/agent/service/orchestration_service.go","apps/station/app/subserver/agent/service/orchestration_service_test.go","apps/station/app/subserver/agent/service/project_state_machine.go","apps/station/app/subserver/agent/service/tool_dispatch_service_test.go","apps/station/app/subserver/agent/service/turn_event_test.go","apps/station/app/subserver/agent/handler/agent_task_handler.go","apps/station/app/subserver/agent/handler/orchestration_handler.go","apps/station/app/subserver/agent/agent.go","apps/station/app/subserver/official_applets/atelier_gate_server/main.go","apps/desktop/src-tauri/src/application/agent_turn/mod.rs","apps/desktop/src-tauri/src/contracts.rs","apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","apps/desktop/src-tauri/src/interface/tauri_commands/agent_turn.rs","apps/desktop/src/pages/AgentCanvasPage.tsx","apps/desktop/src/pages/TasksPage.tsx","apps/desktop/src/services/desktop_api.ts","apps/desktop/src/store/tasks.ts","tooling/acceptance/features/agent-task-management.yaml","tooling/acceptance/fixtures/agent_d11_entrypoints.yaml","tooling/scripts/atelier-projection-contract-gate.mjs","tooling/acceptance/gates/agent/personal_task_authority_hard_cut.py","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml","tooling/acceptance/gates/agent/personal_goal_slices/paos_29_legacy_task_deletion.py"],
  "readSet": ["apps/station/app/subserver/agent/infrastructure/persistence/agent_task_migration.go","apps/station/app/subserver/agent/infrastructure/persistence/collaboration_task_migration.go","apps/desktop/src","apps/applets/atelier/frontend/src"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":240},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_29_legacy_task_deletion.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"legacy-task-zero-reference","command":"bash model/build.sh && bash tooling/scripts/proto-gen-mobile.sh web && ! rg -n '\\b(AgentTask|CollaborationTask)\\b|CreateAgentTask|CreateCollaborationTask|AgentTaskStatus|CollaborationTaskStatus|agent_tasks|agent_collaboration_tasks|projectStateMachineMetaBool|atelierGoalOwnerSignoffComplete|goal_owner_signoff.*meta' apps tooling packages model --glob '!**/migrations/**' --glob '!**/target/**' --glob '!**/node_modules/**' --glob '!**/agent_task_migration*' --glob '!**/collaboration_task_migration*'","verificationClass":"SOURCE_CHECK"},
    {"id":"legacy-task-deletion-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*(TaskRun|MigrationReadback|LegacyAuthority)' -count=1 && cd ../.. && pnpm --dir apps/desktop check","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"legacy-task-deletion-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-task-authority-hard-cut","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Home and Atelier still open migrated and new work after legacy code removal","AgentTask and CollaborationTask CRUD, statuses, metadata lifecycle, schedulers, and compatibility reads have zero live references","TaskRun and other canonical orchestration contracts remain in orchestration.proto","Migration history remains sufficient for canonical readback and the hard-cut Gate is exact-source"],
  "failureBehavior": ["Do not activate while the residual inventory exceeds eight production files or six test files; split predecessor cleanup Tasks first","Do not delete TaskRun, ExecutionStep, evidence, lease, or checkpoint contracts with legacy definitions","Do not delete before migration and restart evidence pass; rollback uses source/deployment rollback, not restored dual writes"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: reopen old and new work after the hard cut.
- Visible result: no missing or duplicate Goal/TaskRun appears.
- Station readback: all work resolves through canonical tables and APIs.
- Lane: Station integration; destructive source cutover is serialized.
- Scope guard: predecessors migrate all runtime/test references; this slice
  removes at most eight production and six test residual files, otherwise it
  must split before activation.

## Current Snapshot

Legacy task types still own handlers, recovery, metadata, and projections.

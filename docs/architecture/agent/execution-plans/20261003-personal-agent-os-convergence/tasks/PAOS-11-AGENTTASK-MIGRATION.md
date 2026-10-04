# PAOS-11-AGENTTASK-MIGRATION - Home legacy readback

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-11-AGENTTASK-MIGRATION",
  "workstreamId": "PAOS-MIGRATION",
  "title": "Reopen legacy AgentTask work through Goal and TaskRun identities",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-agenttask-migration",
  "journeyId": "PAOS-J02-MIGRATION",
  "runtimeClass": "native-desktop",
  "writeSet": ["model/domain/agent/home.proto","apps/station/app/subserver/agent/model/home.pb.go","apps/desktop/src/gen/proto/domain/agent/home_pb.ts","apps/mobile/src/gen/proto/domain/agent/home_pb.ts","apps/mobile/src/gen/proto/domain/agent/orchestration_pb.ts","apps/station/app/subserver/agent/agent.go","apps/station/app/subserver/agent/infrastructure/persistence/models.go","apps/station/app/subserver/agent/infrastructure/persistence/migrations/020_agent_task_goal_map.sql","apps/station/app/subserver/agent/infrastructure/persistence/agent_task_migration.go","apps/station/app/subserver/agent/infrastructure/persistence/agent_task_migration_test.go","apps/station/app/subserver/agent/service/agent_task_service.go","apps/station/app/subserver/agent/service/home_projection_service.go","apps/station/app/subserver/agent/service/home_projection_service_test.go","apps/desktop/src/store/goalExecution.ts","apps/desktop/src/components/home/GoalProgressPanel.tsx","apps/desktop/src/components/home/MigratedWorkBadge.tsx","apps/desktop/src/components/home/MigratedWorkBadge.test.tsx","packages/locales/en/agent.json","packages/locales/zh-CN/agent.json","tooling/acceptance/gates/agent/personal_goal_slices/paos_11_agenttask_migration.py"],
  "readSet": ["apps/station/app/subserver/agent/infrastructure/persistence/agent_task.go","apps/desktop/src/pages/HomePage.tsx"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_11_agenttask_migration.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"agenttask-migration-source","command":"git diff --check -- apps/station/app/subserver/agent apps/desktop/src","verificationClass":"SOURCE_CHECK"},
    {"id":"agenttask-migration-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*AgentTaskMigration' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/components/home/MigratedWorkBadge.test.tsx","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["A legacy AgentTask opens from Home under deterministic Goal and TaskRun ids","Repeated migration and restart do not duplicate records","Ambiguous owner or terminal state appears as blocked migration","Source rows remain intact for rollback"],
  "failureBehavior": ["Do not dual-write legacy and canonical task state","Do not translate ambiguous completion into success"],
  "updatedAt": "2026-10-04T21:08:35Z",
  "durableEvidence": [
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "git:f3e17289bc4306f17f023a9b72bc3e718a02fb25;development://personal-agent-os-convergence-20261003/artifacts/20261004T210750949687Z/paos-11-agenttask-migration/capture.json;manifest-sha256:78ca2a18e4e85edcdcc1bbe2e69bb8c50aeace9f048b1255daa872cf5f77d2a4"
    }
  ]
}
```

## Four-Hour Delivery

- User action: open a pre-migration task from Home.
- Visible result: one canonical Goal/TaskRun identity with migration status.
- Station readback: mapping remains identical across repeated runs.
- Lane: Station migration; may run beside Direct Model and outbox work.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Functional slice complete. The idempotent Station migration preserves every
legacy source row, creates deterministic Goal/TaskRun/Step identities for
valid rows, records invalid ownership or ambiguous terminal state as blocked,
and exposes the migration state through the Home projection and badge.

- Focused Go, Desktop Vitest, TypeScript, proto generation, and diff checks
  pass.
- Native Profile `two` readback preserved canonical IDs across repeated Home
  reconciliation and retained the legacy source row.
- The migrated badge rendered in the native Tauri product window.
- Mobile generated contract compatibility was refreshed. Mobile's broad
  TypeScript check remains blocked by the pre-existing React type duplication
  baseline and is not part of this Desktop migration closure.

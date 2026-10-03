# PAOS-12-COLLAB-TASK-MIGRATION - Atelier legacy readback

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-12-COLLAB-TASK-MIGRATION",
  "workstreamId": "PAOS-MIGRATION",
  "title": "Reopen legacy collaboration work through canonical Goal identity",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-collab-task-migration",
  "journeyId": "PAOS-J02-MIGRATION",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/infrastructure/persistence/migrations/021_collaboration_goal_map.sql","apps/station/app/subserver/agent/infrastructure/persistence/collaboration_task_migration.go","apps/station/app/subserver/agent/infrastructure/persistence/collaboration_task_migration_test.go","apps/station/app/subserver/agent/service/atelier_projection.go","apps/applets/atelier/frontend/src/domain/projection.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_12_collab_task_migration.py"],
  "readSet": ["apps/station/app/subserver/agent/infrastructure/persistence/orchestration.go","apps/applets/atelier/frontend/src/application/projectionReducer.ts"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_12_collab_task_migration.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"collab-migration-source","command":"git diff --check -- apps/station/app/subserver/agent apps/applets/atelier/frontend/src","verificationClass":"SOURCE_CHECK"},
    {"id":"collab-migration-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*CollaborationTaskMigration' -count=1 && cd ../.. && pnpm --filter @peers-touch/atelier-official-applet exec vitest run","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["A legacy collaboration project opens in Atelier under its canonical Goal id","Project and TaskRun links remain stable after repeated migration","Ambiguous metadata is shown as blocked instead of inferred","Legacy source rows remain readable until hard cut"],
  "failureBehavior": ["Do not make Atelier the migration authority","Do not mutate or delete source rows in this slice"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: open a pre-migration Atelier project.
- Visible result: the canonical Goal identity and migration state are shown.
- Station readback: project id, Goal id, and TaskRun mapping are stable.
- Lane: Station migration plus Atelier projection; follows `PAOS-11`.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Atelier project identity is still rooted in CollaborationTask.

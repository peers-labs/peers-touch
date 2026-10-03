# PAOS-14-TASK-READER-CUTOVER - Canonical work projections

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-14-TASK-READER-CUTOVER",
  "workstreamId": "PAOS-MIGRATION",
  "title": "Read TaskRun lifecycle consistently in Home and Atelier",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-task-reader-cutover",
  "journeyId": "PAOS-J02-CUTOVER",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/home_projection_service.go","apps/station/app/subserver/agent/service/home_projection_service_test.go","apps/station/app/subserver/agent/service/atelier_projection.go","apps/station/app/subserver/agent/service/atelier_projection_test.go","apps/desktop/src/store/tasks.ts","apps/desktop/src/store/home.ts","apps/applets/atelier/frontend/src/domain/projection.ts","apps/applets/atelier/frontend/src/application/projectionReducer.ts","apps/applets/atelier/frontend/src/application/projectionReducer.test.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_14_task_reader_cutover.py"],
  "readSet": ["model/domain/agent/orchestration.proto","apps/station/app/subserver/agent/infrastructure/persistence/task_run.go"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_14_task_reader_cutover.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"task-reader-cutover-source","command":"git diff --check -- apps/station/app/subserver/agent apps/desktop/src apps/applets/atelier/frontend/src","verificationClass":"SOURCE_CHECK"},
    {"id":"task-reader-cutover-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*(HomeProjection|AtelierProjection).*TaskRun' -count=1 && cd ../.. && pnpm --dir apps/desktop check && pnpm --filter @peers-touch/atelier-official-applet exec vitest run","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Home and Atelier render one TaskRun status vocabulary","Opening migrated and new work yields the same visible lifecycle","No client derives terminal state from metadata or summary text","Station revision wins over cached projection"],
  "failureBehavior": ["Unknown status renders unavailable instead of completed","Do not retain dual-read fallback after this slice"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: open the same new or migrated work in Home and Atelier.
- Visible result: status, attempt, and current step agree on both surfaces.
- Station readback: both projections resolve through TaskRun.
- Lane: Station integration; serial consumer cutover.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Home, Atelier, and Chat currently project different task lifecycle models.

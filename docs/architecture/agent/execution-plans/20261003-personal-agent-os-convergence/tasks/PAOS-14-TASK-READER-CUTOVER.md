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
  "updatedAt": "2026-10-05T01:29:00Z",
  "durableEvidence": [
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "git:46fedde77d96325882691e6263d29c9247ebd610;development://personal-agent-os-convergence-20261003/artifacts/20261005T012724791404Z/paos-14-task-reader-cutover/capture.json;capture-sha256:a549e99103a1ee0e8c84c5a583e30d7cccb43f4fcbc87a1f310db385df9dc12e;manifest-sha256:da3d810f45cddabc788c508321e593ba56fa09c6a564842f65288ec106b2c411"
    }
  ]
}
```

## Four-Hour Delivery

- User action: open the same new or migrated work in Home and Atelier.
- Visible result: status, attempt, and current step agree on both surfaces.
- Station readback: both projections resolve through TaskRun.
- Lane: Station integration; serial consumer cutover.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Functional slice complete. Home, Desktop Tasks, and Atelier now read
Station-owned TaskRun and ExecutionStep records only.

- Home no longer reads AgentTask lifecycle rows or rescans legacy rows while
  serving a projection.
- Atelier workspace and owner lookup no longer read CollaborationTask or
  CollaborationTaskNode lifecycle state.
- Both surfaces use
  `pending/running/needs_user/completed/failed/cancelled/unavailable`; an
  unknown status is unavailable and never completed.
- New TaskRun `task_0c921754f65cafe9565d9f4e` and migrated TaskRun
  `collab_paos12_1791150834` matched across Home and Atelier on status,
  current step, attempt ID, and attempt number.
- Desktop Task store replaced its injected stale cache from Station revision
  `1791163694321496000`.
- Legacy CollaborationTask inventory remained exactly
  `["collab_paos12_1791150834"]` before and after the Journey.
- Full Agent tests, Desktop checks, Atelier 101-unit suite/build, the registered
  `agent-personal-taskrun-cutover-source` Gate, native Profile `two` Journey,
  cleanup audit, and sensitive-profile-key scan passed.

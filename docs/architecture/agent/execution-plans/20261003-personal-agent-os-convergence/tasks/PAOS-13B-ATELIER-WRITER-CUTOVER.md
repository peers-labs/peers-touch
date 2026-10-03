# PAOS-13B-ATELIER-WRITER-CUTOVER - Atelier work writes

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-13B-ATELIER-WRITER-CUTOVER",
  "workstreamId": "PAOS-MIGRATION",
  "title": "Route Atelier and optional Canvas work commands to TaskRun",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-atelier-writer-cutover",
  "journeyId": "PAOS-J02-CUTOVER",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/orchestration_service.go","apps/station/app/subserver/agent/service/orchestration_service_test.go","apps/station/app/subserver/agent/service/atelier_projection.go","apps/station/app/subserver/agent/service/atelier_projection_test.go","apps/station/app/subserver/agent/handler/orchestration_handler.go","apps/applets/atelier/frontend/src/application/taskRunCutover.test.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_13b_atelier_writer_cutover.py","tooling/acceptance/gates/agent/personal_taskrun_cutover_source.py","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml"],
  "readSet": ["model/domain/agent/orchestration.proto","apps/applets/atelier/frontend/src/application/useAtelierController.ts","docs/architecture/agent/agent-canvas-orchestration.md"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_13b_atelier_writer_cutover.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"atelier-writer-cutover-source","command":"git diff --check -- apps/station/app/subserver/agent apps/applets/atelier/frontend/src tooling/acceptance","verificationClass":"SOURCE_CHECK"},
    {"id":"atelier-writer-cutover-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*Atelier.*TaskRun' -count=1 && cd ../.. && pnpm --filter @peers-touch/atelier-official-applet exec vitest run src/application/taskRunCutover.test.ts","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"task-writer-cutover-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-taskrun-cutover-source","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Atelier creates or addresses canonical Goal and TaskRun identities","Optional Canvas callers use the same TaskRun writer without becoming core completion","No new CollaborationTask execution row is written","The all-writer cutover Gate is registered and exact-source"],
  "failureBehavior": ["Do not make Atelier or Canvas an execution authority","Do not delete legacy readers in this slice"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: create one Goal-backed work item from Atelier.
- Visible result: Atelier opens the returned canonical TaskRun.
- Station readback: no CollaborationTask execution row was added.
- Lane: Station integration; serialized after Home/Chat writer cutover.
- Scope guard: only Atelier writer conversion and optional Canvas adapter reuse
  are in scope; Canvas UI remains optional and unproven.

## Current Snapshot

Atelier create-from-goal and orchestration writers still create CollaborationTask state.

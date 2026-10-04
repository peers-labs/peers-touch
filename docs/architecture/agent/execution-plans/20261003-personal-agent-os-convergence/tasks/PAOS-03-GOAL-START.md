# PAOS-03-GOAL-START - Goal admission

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-03-GOAL-START",
  "workstreamId": "PAOS-CORE",
  "title": "Admit and start a reviewed Goal from Home",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-goal-start",
  "journeyId": "PAOS-J01",
  "runtimeClass": "native-desktop",
  "writeSet": ["model/domain/agent/goal.proto","apps/station/app/subserver/agent/model/goal.pb.go","apps/desktop/src/gen/proto/domain/agent/goal_pb.ts","apps/station/app/subserver/agent/errcode/error.go","apps/station/app/subserver/agent/service/goal_admission_service.go","apps/station/app/subserver/agent/service/goal_admission_service_test.go","apps/station/app/subserver/agent/service/goal_service.go","apps/station/app/subserver/agent/service/home_projection_service.go","apps/station/app/subserver/agent/handler/goal_handler.go","apps/station/app/subserver/agent/agent.go","apps/desktop/src-tauri/src/application/home.rs","apps/desktop/src-tauri/src/interface/tauri_commands/home.rs","apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","apps/desktop/src-tauri/src/main.rs","apps/desktop/src/services/desktop_api.ts","apps/desktop/src/services/desktop_api.home.test.ts","apps/desktop/src/store/goalDraft.ts","apps/desktop/src/store/goalDraft.test.ts","apps/desktop/src/components/home/GoalDraftCard.tsx","apps/desktop/src/components/home/GoalReviewPanel.tsx","apps/desktop/src/components/home/GoalReviewPanel.test.tsx","apps/desktop/src/runtimes/homeRuntime.ts","apps/desktop/src/runtimes/homeRuntime.test.ts","apps/desktop/src/acceptance/agent/homeJourney.test.ts","packages/locales/en/agent.json","packages/locales/zh-CN/agent.json","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/capabilities/agent.yaml","tooling/acceptance/domains/agent.yaml","tooling/acceptance/environments/home-station.yaml","tooling/acceptance/gates/agent/personal_goal_contract_source.py","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml","tooling/acceptance/gates/agent/personal_goal_slices/paos_03_goal_start.py"],
  "readSet": ["apps/desktop/src/store/home.ts","docs/architecture/agent/proposals/20261003-personal-agent-os.md"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_03_goal_start.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"goal-start-source","command":"bash model/build.sh && git diff --check -- model/domain/agent apps/station/app/subserver/agent apps/desktop tooling/acceptance","verificationClass":"SOURCE_CHECK"},
    {"id":"goal-start-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*Goal.*(Admission|Start)' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/components/home/GoalReviewPanel.test.tsx src/acceptance/agent/homeJourney.test.ts","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"goal-start-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-contract-source","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Review exposes material assumptions before Start","Start commits READY to RUNNING with idempotency and expected revision","Rejected admission shows the blocking reason in Home","No TaskRun exists before admission commits"],
  "failureBehavior": ["Preserve the reviewed draft after admission failure","Do not start from stale, unauthorized, or incomplete input"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: review and press Start.
- Visible result: admitted `RUNNING` state or an actionable admission error.
- Station readback: the same Goal revision proves the transition.
- Lane: Station integration; owns shared Gate registration for waves 1-3.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

No first-class Goal admission boundary currently separates review from execution.

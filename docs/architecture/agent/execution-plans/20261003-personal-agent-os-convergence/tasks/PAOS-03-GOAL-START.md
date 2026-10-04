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
  "writeSet": ["model/domain/agent/goal.proto","apps/station/app/subserver/agent/model/goal.pb.go","apps/desktop/src/gen/proto/domain/agent/goal_pb.ts","apps/station/app/subserver/agent/errcode/error.go","apps/station/app/subserver/agent/service/goal_admission_service.go","apps/station/app/subserver/agent/service/goal_admission_service_test.go","apps/station/app/subserver/agent/service/goal_service.go","apps/station/app/subserver/agent/service/home_projection_service.go","apps/station/app/subserver/agent/handler/goal_handler.go","apps/station/app/subserver/agent/agent.go","apps/desktop/src-tauri/src/application/home.rs","apps/desktop/src-tauri/src/interface/tauri_commands/home.rs","apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","apps/desktop/src-tauri/src/main.rs","apps/desktop/src/services/desktop_api.ts","apps/desktop/src/services/desktop_api.home.test.ts","apps/desktop/src/store/goalDraft.ts","apps/desktop/src/store/goalDraft.test.ts","apps/desktop/src/components/home/GoalDraftCard.tsx","apps/desktop/src/components/home/GoalContractEditor.tsx","apps/desktop/src/components/home/GoalContractEditor.test.tsx","apps/desktop/src/components/home/GoalReviewPanel.tsx","apps/desktop/src/components/home/GoalReviewPanel.test.tsx","apps/desktop/src/components/home/goalAdmissionPresentation.ts","apps/desktop/src/runtimes/homeRuntime.ts","apps/desktop/src/runtimes/homeRuntime.test.ts","apps/desktop/src/acceptance/agent/homeJourney.test.ts","packages/locales/en/agent.json","packages/locales/zh-CN/agent.json","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/capabilities/agent.yaml","tooling/acceptance/domains/agent.yaml","tooling/acceptance/environments/home-station.yaml","tooling/acceptance/gates/agent/personal_goal_contract_source.py","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml","tooling/acceptance/gates/agent/personal_goal_slices/paos_01_home_draft.py","tooling/acceptance/gates/agent/personal_goal_slices/paos_03_goal_start.py"],
  "readSet": ["apps/desktop/src/store/home.ts","docs/architecture/agent/proposals/20261003-personal-agent-os.md"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_03_goal_start.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"goal-start-source","command":"bash model/build.sh && git diff --check -- model/domain/agent apps/station/app/subserver/agent apps/desktop tooling/acceptance","verificationClass":"SOURCE_CHECK"},
    {"id":"goal-start-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*Goal.*(Admission|Start)' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/components/home/GoalReviewPanel.test.tsx src/acceptance/agent/homeJourney.test.ts","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"goal-start-contract","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-contract-source","verificationClass":"SOURCE_CHECK"}
  ],
  "doneWhen": ["Review exposes material assumptions before Start","Start commits READY to RUNNING with idempotency and expected revision","Rejected admission shows the blocking reason in Home","No TaskRun exists before admission commits"],
  "failureBehavior": ["Preserve the reviewed draft after admission failure","Do not start from stale, unauthorized, or incomplete input"],
  "updatedAt": "2026-10-04T11:17:00Z",
  "durableEvidence": [
    {"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"git:9d2cf846eab66af7c14cff97d2bbc0e92a2a3902;agent-personal-goal-contract-source:20261004T110258135875Z-2a9468a10cf6a934937faad80d91bb7e;code-structure:sha256:3abeeae3352b4f6af7c2c5738488e9456eeb768d93342f383a41124ad0b0285b"},
    {"verificationClass":"FUNCTIONAL_CHECK","result":"PASS","ref":"development://personal-agent-os-convergence-20261003-r8/checks/functional-result-36ce22b742ef68bcec0f9e5821b8191b2a7ee59ad8dc722b69e4e6f0cbe851d7.json"}
  ]
}
```

## Four-Hour Delivery

- User action: review and press Start.
- Visible result: admitted `RUNNING` state or an actionable admission error.
- Station readback: the same Goal revision proves the transition.
- Lane: Station integration; owns shared Gate registration for waves 1-3.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.
- Evidence boundary: the Native Journey proves visible assumptions, Station-authored
  admission rejection, stale recovery, READY/RUNNING readback, and no new active
  Home work. The focused Station persistence test directly proves admission and
  start create zero `TaskRun` rows; Home projection counts do not substitute for
  that persistence assertion.

## Current Snapshot

Station owns separate `REVIEWING -> READY -> RUNNING` commands and Home renders
their authoritative revisions. The exact-source r8 Native Journey covers
Station-authored rejection, stale recovery, start, readback, evidence hashing,
and cleanup; r9 binds those immutable results into this Task before final review.

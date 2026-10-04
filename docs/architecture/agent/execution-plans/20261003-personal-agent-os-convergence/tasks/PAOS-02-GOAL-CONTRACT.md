# PAOS-02-GOAL-CONTRACT - Reviewable Goal contract

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-02-GOAL-CONTRACT",
  "workstreamId": "PAOS-HOME",
  "title": "Edit and review the durable Goal contract",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-goal-contract",
  "journeyId": "PAOS-J01",
  "runtimeClass": "native-desktop",
  "writeSet": ["model/domain/agent/goal.proto","apps/station/app/subserver/agent/model/goal.pb.go","apps/desktop/src/gen/proto/domain/agent/goal_pb.ts","apps/station/app/subserver/agent/service/goal_service.go","apps/station/app/subserver/agent/service/goal_service_test.go","apps/station/app/subserver/agent/handler/goal_handler.go","apps/station/app/subserver/agent/agent.go","apps/desktop/src-tauri/src/application/home.rs","apps/desktop/src-tauri/src/interface/tauri_commands/home.rs","apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","apps/desktop/src-tauri/src/main.rs","apps/desktop/src/services/desktop_api.ts","apps/desktop/src/services/desktop_api.home.test.ts","apps/desktop/src/runtimes/homeRuntime.ts","apps/desktop/src/runtimes/homeRuntime.test.ts","apps/desktop/src/components/home/GoalDraftCard.tsx","apps/desktop/src/components/home/GoalContractEditor.tsx","apps/desktop/src/components/home/GoalContractEditor.test.tsx","apps/desktop/src/store/goalDraft.ts","apps/desktop/src/store/goalDraft.test.ts","apps/desktop/src/pages/HomePage.tsx","apps/desktop/src/pages/HomePage.test.tsx","packages/locales/en/agent.json","packages/locales/zh-CN/agent.json","tooling/acceptance/gates/agent/personal_goal_slices/paos_02_goal_contract.py"],
  "readSet": ["docs/architecture/agent/proposals/20261003-personal-agent-os.md"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1200,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_02_goal_contract.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"goal-contract-ui-source","command":"bash model/build.sh && git diff --check -- model/domain/agent/goal.proto apps/station/app/subserver/agent/service/goal_service.go apps/desktop/src packages/locales","verificationClass":"UX_REVIEW"},
    {"id":"goal-contract-ui-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*Goal.*(Update|Revision|Review)' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/store/goalDraft.test.ts src/components/home/GoalContractEditor.test.tsx","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["User can edit outcome, non-goals, constraints, budget, and acceptance criteria","Review mode shows the exact Station revision that will be started","A stale revision renders conflict and reload actions without losing edits","Unauthorized mutation is visible and cannot be retried as if transient"],
  "failureBehavior": ["Reject stale writes with the latest Station revision","Never infer accepted contract fields from free-form output"],
  "updatedAt": "2026-10-04T06:02:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: edit a draft, enter review, and recover from one revision conflict.
- Visible result: contract sections, stale/conflict state, and an explicit reload path.
- Station readback: the reviewed values and revision match the persisted Goal.
- Lane: Home; serial after `PAOS-01`.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Goal semantics currently live in task descriptions and metadata instead of a reviewed contract.

# PAOS-04-GOAL-CANCEL - Cancel before execution

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-04-GOAL-CANCEL",
  "workstreamId": "PAOS-HOME",
  "title": "Cancel a draft or admitted Goal from Home",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-goal-cancel",
  "journeyId": "PAOS-J01",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_command_service.go","apps/station/app/subserver/agent/service/goal_command_service_test.go","apps/desktop/src/components/home/GoalCancelControl.tsx","apps/desktop/src/components/home/GoalCancelControl.test.tsx","apps/desktop/src/services/goal-service.ts","apps/desktop/src/pages/HomePage.tsx","packages/locales/en/agent.json","packages/locales/zh-CN/agent.json","tooling/acceptance/gates/agent/personal_goal_slices/paos_04_goal_cancel.py"],
  "readSet": ["model/domain/agent/goal.proto","apps/desktop/src/store/home.ts","docs/client/common/ui-identity/interaction.md"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1200,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_04_goal_cancel.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"goal-cancel-ui","command":"pnpm --dir apps/desktop exec vitest run src/components/home/GoalCancelControl.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"goal-cancel-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*Goal.*Cancel' -count=1 && cd ../.. && pnpm --dir apps/desktop check","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["User can cancel DRAFT, REVIEWING, or READY work from Home","Confirmation names the affected Goal and keeps focus ownership correct","Home waits for Station readback before showing CANCELLED","English and Simplified Chinese labels and accessible names exist"],
  "failureBehavior": ["Failed cancellation keeps the prior state and retry context","Destructive UI never removes the Goal before Station confirmation"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: cancel a non-executing Goal with keyboard or pointer.
- Visible result: confirmed `CANCELLED` state with localized feedback.
- Station readback: terminal state and revision match the command response.
- Lane: Home; may run beside `PAOS-05` because their files do not overlap.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Home has no Goal lifecycle controls or Goal-specific accessibility contract.

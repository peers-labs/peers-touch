# PAOS-19-BUDGET-EXHAUSTION - Visible budget stop

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-19-BUDGET-EXHAUSTION",
  "workstreamId": "PAOS-AUTONOMY",
  "title": "Stop on budget exhaustion and resume by explicit decision",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-budget-exhaustion",
  "journeyId": "PAOS-J03",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_budget_policy.go","apps/station/app/subserver/agent/service/goal_budget_policy_test.go","apps/station/app/subserver/agent/service/goal_decision_service.go","apps/station/app/subserver/agent/service/goal_coordinator.go","apps/desktop/src/components/home/GoalBudgetBanner.tsx","apps/desktop/src/components/home/GoalBudgetBanner.test.tsx","apps/desktop/src/store/goalDecisions.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_19_budget_exhaustion.py"],
  "readSet": ["apps/station/app/subserver/agent/infrastructure/persistence/task_budget_usage.go","apps/station/app/subserver/agent/service/budget_usage_reconciler.go"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_19_budget_exhaustion.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"goal-budget-ui","command":"pnpm --dir apps/desktop exec vitest run src/components/home/GoalBudgetBanner.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"goal-budget-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*Goal.*Budget' -count=1","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Home displays used and capped time, token, and money dimensions","Exhaustion stops new dispatch and enters Needs You","User may approve a higher cap or cancel with explicit consequence","Resume uses the updated Station budget revision"],
  "failureBehavior": ["Do not execute beyond a hard cap","Missing pricing or usage evidence is visible and fail-closed"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: exhaust a small budget and choose increase or cancel.
- Visible result: budget-exhausted banner and valid recovery actions.
- Station readback: usage, cap, decision, and resumed revision agree.
- Lane: Home budget path; may run beside deterministic acceptance.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Task usage exists, but Goal-level budget exhaustion is not a complete user state.

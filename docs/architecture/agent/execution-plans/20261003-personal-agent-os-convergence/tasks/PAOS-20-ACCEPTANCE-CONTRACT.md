# PAOS-20-ACCEPTANCE-CONTRACT - Frozen completion criteria

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-20-ACCEPTANCE-CONTRACT",
  "workstreamId": "PAOS-TRUST",
  "title": "Freeze visible Goal acceptance criteria before execution",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-acceptance-contract",
  "journeyId": "PAOS-J01,PAOS-J04",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/infrastructure/persistence/goal_acceptance_round.go","apps/station/app/subserver/agent/service/goal_acceptance_service.go","apps/station/app/subserver/agent/service/goal_acceptance_service_test.go","apps/station/app/subserver/agent/service/goal_admission_service.go","apps/desktop/src/components/home/GoalAcceptanceCriteria.tsx","apps/desktop/src/components/home/GoalAcceptanceCriteria.test.tsx","apps/desktop/src/store/goalAcceptance.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_20_acceptance_contract.py"],
  "readSet": ["model/domain/agent/goal.proto","apps/station/app/subserver/agent/infrastructure/persistence/acceptance_predicate.go"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_20_acceptance_contract.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"acceptance-contract-ui","command":"pnpm --dir apps/desktop exec vitest run src/components/home/GoalAcceptanceCriteria.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"acceptance-contract-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*GoalAcceptance.*Contract' -count=1","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Review shows each criterion, level, evaluator, and evidence requirement","Start freezes an acceptance contract revision","Execution cannot silently weaken or replace frozen criteria","Home reads the frozen contract from Station"],
  "failureBehavior": ["Unknown evaluator or expression blocks admission","Do not treat Acceptance Framework configuration as production criteria"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: review acceptance criteria and start the Goal.
- Visible result: criteria become read-only with a frozen revision.
- Station readback: the acceptance contract remains unchanged during execution.
- Lane: trust; may run beside Home resync after the base contract is stable.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Acceptance predicates exist for tasks, but no Goal-owned frozen contract is visible.

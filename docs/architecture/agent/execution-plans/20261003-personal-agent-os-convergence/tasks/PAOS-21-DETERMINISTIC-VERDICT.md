# PAOS-21-DETERMINISTIC-VERDICT - L0/L1 acceptance

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-21-DETERMINISTIC-VERDICT",
  "workstreamId": "PAOS-TRUST",
  "title": "Render evidence-backed deterministic Goal verdicts",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-deterministic-verdict",
  "journeyId": "PAOS-J04",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_acceptance_service.go","apps/station/app/subserver/agent/service/goal_acceptance_service_test.go","apps/station/app/subserver/agent/service/acceptance_predicate_evaluator.go","apps/station/app/subserver/agent/service/goal_result_projection.go","apps/desktop/src/components/home/GoalVerdictPanel.tsx","apps/desktop/src/components/home/GoalVerdictPanel.test.tsx","apps/desktop/src/store/goalAcceptance.ts","tooling/acceptance/gates/agent/personal_goal_acceptance_e2e.py","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml","tooling/acceptance/gates/agent/personal_goal_slices/paos_21_deterministic_verdict.py"],
  "readSet": ["apps/station/app/subserver/agent/infrastructure/persistence/task_artifact.go","apps/station/app/subserver/agent/infrastructure/persistence/task_gate_result.go","docs/architecture/acceptance-framework"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_21_deterministic_verdict.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"deterministic-verdict-ui","command":"pnpm --dir apps/desktop exec vitest run src/components/home/GoalVerdictPanel.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"deterministic-verdict-functional","command":"cd apps/station && go test ./app/subserver/agent/... -run 'Test.*GoalAcceptance.*(L0|L1|Repair|Partial)' -count=1","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"deterministic-verdict-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-acceptance-e2e","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Home shows ACCEPTING before a terminal verdict","Each L0/L1 criterion links immutable evidence and evaluator output","Unmet criteria produce repair, PARTIAL, or FAILED instead of ACCEPTED","Only GoalAcceptanceService commits the Goal verdict"],
  "failureBehavior": ["Do not accept from node counts or final summary","Do not mutate a terminal acceptance round"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: run a deterministic Goal and open its verdict.
- Visible result: criterion-level pass/fail evidence and accepted/partial outcome.
- Station readback: verdict owner, round, and evidence refs match.
- Lane: trust plus serialized Acceptance registration.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

GoalKeeper can currently infer success from node completion and summary text.

# PAOS-15-READY-FRONTIER - Autonomous next work

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-15-READY-FRONTIER",
  "workstreamId": "PAOS-AUTONOMY",
  "title": "Advance ready Goal nodes automatically within bounds",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-ready-frontier",
  "journeyId": "PAOS-J02",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_coordinator.go","apps/station/app/subserver/agent/service/goal_coordinator_test.go","apps/station/app/subserver/agent/infrastructure/persistence/goal_coordinator_lease.go","apps/station/app/subserver/agent/service/goal_execution_service.go","apps/desktop/src/components/home/GoalTimeline.tsx","apps/desktop/src/components/home/GoalTimeline.test.tsx","tooling/acceptance/gates/agent/personal_goal_coordinator_e2e.py","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml","tooling/acceptance/gates/agent/personal_goal_slices/paos_15_ready_frontier.py"],
  "readSet": ["model/domain/agent/goal.proto","model/domain/agent/orchestration.proto"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_15_ready_frontier.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"ready-frontier-source","command":"git diff --check -- apps/station/app/subserver/agent apps/desktop/src tooling/acceptance","verificationClass":"SOURCE_CHECK"},
    {"id":"ready-frontier-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*GoalCoordinator.*(Frontier|Lease|Dispatch)' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/components/home/GoalTimeline.test.tsx","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"ready-frontier-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-coordinator-e2e","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Home visibly advances from one completed node to the next without Continue prompts","Ready frontier is deterministic and bounded by concurrency","Every dispatch preallocates node, TaskRun, step, and attempt identity","One lease generation owns scheduling"],
  "failureBehavior": ["Do not dispatch unresolved dependency, policy, capability, or budget","Takeover reconciles in-flight work before dispatch"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: start a two-node Goal and leave it running.
- Visible result: Home advances to the second eligible node automatically.
- Station readback: graph revision and lease generation explain the transition.
- Lane: Station integration.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Existing orchestration has leases and nodes but no first-class Goal coordinator.

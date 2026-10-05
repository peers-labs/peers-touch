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
  "writeSet": ["apps/station/app/subserver/agent/agent.go","apps/station/app/subserver/agent/infrastructure/persistence/models.go","apps/station/app/subserver/agent/infrastructure/persistence/goal_coordinator_lease.go","apps/station/app/subserver/agent/service/goal_admission_service.go","apps/station/app/subserver/agent/service/goal_coordinator.go","apps/station/app/subserver/agent/service/goal_coordinator_test.go","apps/station/app/subserver/agent/service/goal_direct_model_executor.go","apps/station/app/subserver/agent/service/goal_direct_model_executor_test.go","apps/station/app/subserver/agent/service/goal_execution_service.go","apps/desktop/src/components/home/GoalProgressPanel.tsx","apps/desktop/src/components/home/GoalProgressPanel.test.tsx","apps/desktop/src/components/home/GoalTimeline.tsx","apps/desktop/src/components/home/GoalTimeline.test.tsx","tooling/acceptance/capabilities/agent.yaml","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/fixtures/chat_native_actors.py","tooling/acceptance/fixtures/chat_native_reset.py","tooling/acceptance/gates.yaml","tooling/acceptance/gates/agent/personal_goal_coordinator_e2e.py","tooling/acceptance/gates/agent/personal_goal_slices/paos_03_goal_start.py","tooling/acceptance/gates/agent/personal_goal_slices/paos_15_ready_frontier.py","tooling/acceptance/provisioners/home_station.py","tooling/acceptance/registry.yaml","tooling/acceptance/tests/test_provisioner_runtime.py","tooling/acceptance/tests/test_provisioning_owners.py"],
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
  "updatedAt": "2026-10-05T02:44:21Z",
  "durableEvidence": [
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "git:1412c895ec63cc5e00058891fdc2685405e2b455;acceptance://872e6a11e6df33b5/agent-personal-goal-coordinator-e2e/20261005T024059407431Z-5dd762166e510e5f31519bf48f27b12f/manifest.json;manifest-sha256:8216ffcde4c33d0debec3eada251a88ef8e68763554f259b87a3275eec7bab02"
    }
  ]
}
```

## Four-Hour Delivery

- User action: start a two-node Goal and leave it running.
- Visible result: Home advances to the second eligible node automatically.
- Station readback: graph revision and lease generation explain the transition.
- Lane: Station integration.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Functional slice complete. Station now owns deterministic ready-frontier
selection through one generation-fenced Goal coordinator lease.

- Goal start commits only the first TaskRun, preserving the atomic start
  contract. After that TaskRun succeeds, the coordinator creates the
  dependency-bound continuation node, TaskRun, ExecutionStep, and attempt in
  one transaction before dispatch.
- Frontier order is `priority DESC, node_id ASC`; unresolved prerequisites,
  invalid parallelism, unavailable execution capability, and an unexpired
  foreign coordinator lease prevent dispatch.
- Expired-lease takeover increments generation and reconciles in-flight work
  before considering new work.
- Every Direct Model event records graph revision, coordinator lease
  generation, and dispatch sequence. Native Home renders the two canonical
  nodes as one selectable timeline and automatically presents the next active
  node without a Continue action.
- Full Station Agent tests, Desktop type checks, focused timeline tests,
  Provisioner tests, and code-structure review passed.
- Exact-source Profile `two` Gate
  `agent-personal-goal-coordinator-e2e` passed at commit `1412c895e`, including
  Native receiver UI, Station readback, runtime events, source identity, and
  clean process/port/storage cleanup.

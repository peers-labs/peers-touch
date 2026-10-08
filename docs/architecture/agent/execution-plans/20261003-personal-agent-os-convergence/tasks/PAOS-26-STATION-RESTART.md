# PAOS-26-STATION-RESTART - Service recovery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-26-STATION-RESTART",
  "workstreamId": "PAOS-RECOVERY",
  "title": "Recover Goal ownership and progress after Station restart",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-station-restart",
  "journeyId": "PAOS-J03,PAOS-J04",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_recovery_service.go","apps/station/app/subserver/agent/service/goal_recovery_service_test.go","apps/station/app/subserver/agent/service/goal_coordinator.go","apps/station/app/subserver/agent/service/agent_realtime_relay.go","apps/station/app/subserver/agent/agent.go","tooling/acceptance/gates/agent/personal_goal_recovery_e2e.py","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml"],
  "readSet": ["apps/station/app/subserver/agent/infrastructure/persistence/executor_lease.go","apps/station/app/subserver/agent/infrastructure/persistence/task_checkpoint.go","apps/desktop/src/runtimes/homeRuntime.ts","apps/applets/atelier/frontend/src/application/useAtelierController.ts"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":2400,"cleanupSeconds":240},
  "runtimeReuse": {"scope":"suite","entryCheckId":"station-restart-functional","scenarioIds":["station-restart","duplicate-delivery","stale-writer"],"maxProvisioningRuns":1,"maxClientLaunches":2,"minWarmReuseRate":0.75,"requireAttachOnlyScenarios":true,"requireReceiverVisibleProof":true,"allowClientReplacement":true},
  "checks": [
    {"id":"station-restart-source","command":"git diff --check -- apps/station/app/subserver/agent tooling/acceptance","verificationClass":"SOURCE_CHECK"},
    {"id":"station-restart-functional","command":"python3 tooling/acceptance/gates/agent/personal_goal_recovery_e2e.py --mode development","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"station-restart-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-recovery-e2e","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Home and Atelier show RECOVERING while Station reconciles","Lease, TaskRuns, outbox cursor, and accepted anchors reconcile before dispatch","Duplicate delivery and stale writers cannot repeat accepted work","Recovery Gate proves the same Goal on both surfaces"],
  "failureBehavior": ["Remain RECOVERING or NEEDS_USER when ownership is ambiguous","Do not start a replacement execution before reconciliation"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: restart Station during work and wait for reconnection.
- Visible result: both surfaces show recovery, then the same reconciled Goal.
- Station readback: lease generation and accepted anchors remain stable.
- Lane: Station integration and shared recovery Gate.
- Scope guard: reuse the existing restart harness and lease/checkpoint stores;
  this slice only adds Goal reconciliation and does not provision a new runtime.

## Current Snapshot

Leases, checkpoints, and replay exist but are not reconciled under one Goal revision.

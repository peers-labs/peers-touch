# PAOS-25-DESKTOP-RESTART - Client continuity

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-25-DESKTOP-RESTART",
  "workstreamId": "PAOS-RECOVERY",
  "title": "Reopen the same Goal after Desktop restart",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-desktop-restart",
  "journeyId": "PAOS-J03,PAOS-J04",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop/src/runtimes/homeRuntime.ts","apps/desktop/src/runtimes/homeRuntime.test.ts","apps/desktop/src/store/home.ts","apps/desktop/src/store/home.test.ts","apps/desktop/src/pages/HomePage.tsx","apps/desktop/src/acceptance/agent/homeJourney.ts","apps/desktop/src/acceptance/agent/homeJourney.test.ts","tooling/acceptance/gates/agent/personal_goal_recovery_e2e.py"],
  "readSet": ["docs/client/desktop/runtime-projections.md","apps/desktop/src/kernel/boot.ts","apps/desktop/src/store/goalExecution.ts","apps/desktop/src/store/goalAcceptance.ts"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"desktop-restart-ui","command":"pnpm --dir apps/desktop exec vitest run src/runtimes/homeRuntime.test.ts src/store/home.test.ts src/acceptance/agent/homeJourney.test.ts","verificationClass":"UX_REVIEW"},
    {"id":"desktop-restart-functional","command":"python3 tooling/acceptance/gates/agent/personal_goal_recovery_e2e.py --mode development --scenario desktop-restart","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Desktop restart opens the same Goal id and Station revision","Draft, graph, active TaskRun, accepted anchors, verdict, and evidence rehydrate","No duplicate command or local terminal inference occurs","Focus returns to the reopened Goal's primary heading"],
  "failureBehavior": ["Cache may accelerate paint but never override Station","Recovery failure keeps last accepted data visibly stale"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: close and reopen Desktop, then open the Goal.
- Visible result: the same Goal, progress, and verdict return without re-entry.
- Station readback: identity, revision, graph, and evidence match before and after restart.
- Lane: Home recovery; may run beside L2 review and Atelier evidence.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Home runtime can bootstrap a projection, but Goal recovery has no exact journey proof.

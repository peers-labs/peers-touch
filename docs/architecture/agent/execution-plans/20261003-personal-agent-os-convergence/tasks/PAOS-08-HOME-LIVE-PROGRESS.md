# PAOS-08-HOME-LIVE-PROGRESS - Live Home projection

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-08-HOME-LIVE-PROGRESS",
  "workstreamId": "PAOS-HOME",
  "title": "Show canonical Goal progress live in Home",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-home-live-progress",
  "journeyId": "PAOS-J02",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop/src/kernel/events/catalog.ts","apps/desktop/src/kernel/events/types.ts","apps/desktop/src/runtimes/homeRuntime.ts","apps/desktop/src/runtimes/homeRuntime.test.ts","apps/desktop/src/store/home.ts","apps/desktop/src/store/home.test.ts","apps/desktop/src/components/home/GoalProgressPanel.tsx","apps/desktop/src/components/home/GoalProgressPanel.test.tsx","tooling/acceptance/gates/agent/personal_goal_home_e2e.py","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/capabilities/agent.yaml","tooling/acceptance/domains/agent.yaml","tooling/acceptance/environments/home-station.yaml","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml"],
  "readSet": ["apps/desktop/src/services/eventStream.ts","apps/station/app/subserver/events"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"home-live-progress-ui","command":"pnpm --dir apps/desktop exec vitest run src/runtimes/homeRuntime.test.ts src/store/home.test.ts src/components/home/GoalProgressPanel.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"home-live-progress-functional","command":"python3 tooling/acceptance/gates/agent/personal_goal_home_e2e.py --mode development","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"home-live-progress-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-home-e2e","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Home applies typed Goal and TaskRun events without a page remount","Progress, current node, budget, and revision change visibly","Periodic reconcile remains only a missed-event safety net","The Home journey Gate is registered and receiver-visible"],
  "failureBehavior": ["Ignore duplicate or older event revisions","Do not use polling as the normal progress driver"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: keep Home open while a Goal advances.
- Visible result: progress and current work update without refresh.
- Station readback: the visible revision equals the authoritative snapshot.
- Lane: Home; shared Gate registration is serialized here.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Home only reconciles periodically and does not consume Goal progress events.

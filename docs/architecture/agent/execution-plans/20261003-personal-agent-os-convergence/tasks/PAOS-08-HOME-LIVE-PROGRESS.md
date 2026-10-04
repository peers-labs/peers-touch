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
  "updatedAt": "2026-10-04T19:10:00Z",
  "durableEvidence": [
    {
      "verificationClass": "UX_REVIEW",
      "result": "PASS",
      "ref": "vitest:homeRuntime+homeStore+GoalProgressPanel;desktop-check:pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "git:c6cf05c95c6f12cd1548f23a4840715cda62d90a;development://personal-agent-os-convergence-20261003/artifacts/20261004T185157672642Z/paos-08-home-live-progress/capture.json;manifest-sha256:69991e2f6e90a3fab400826afcc5637d0aa0e5ec86521af91b0c03469b764d48"
    }
  ]
}
```

## Four-Hour Delivery

- User action: keep Home open while a Goal advances.
- Visible result: progress and current work update without refresh.
- Station readback: the visible revision equals the authoritative snapshot.
- Lane: Home; shared Gate registration is serialized here.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Functional slice complete.

- Home consumes typed Agent domain events from the shared event stream and
  deduplicates them by durable event identity and sequence.
- The visible terminal TaskRun retains progress, current node, budget, and
  authoritative projection revision without a page remount.
- Profile `two` Native proof matched the visible and Station revisions with
  clean runtime teardown.
- Final suite-lifecycle Acceptance remains owned by `PAOS-30`.

# PAOS-09-HOME-RESYNC - Visible reconnect and resync

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-09-HOME-RESYNC",
  "workstreamId": "PAOS-HOME",
  "title": "Recover Home from disconnect, cursor gap, and stale projection",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-home-resync",
  "journeyId": "PAOS-J02-EVENTS",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop/src/runtimes/homeRuntime.ts","apps/desktop/src/runtimes/homeRuntime.test.ts","apps/desktop/src/store/home.ts","apps/desktop/src/store/home.test.ts","apps/desktop/src/components/home/GoalConnectionStatus.tsx","apps/desktop/src/components/home/GoalConnectionStatus.test.tsx","apps/desktop/src/pages/HomePage.tsx","apps/desktop/src/acceptance/agent/homeJourney.test.ts","packages/locales/en/agent.json","packages/locales/zh-CN/agent.json","tooling/acceptance/gates/agent/personal_goal_slices/paos_09_home_resync.py"],
  "readSet": ["apps/desktop/src/services/eventStream.ts","model/domain/agent/home.proto"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_09_home_resync.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"home-resync-ui","command":"pnpm --dir apps/desktop exec vitest run src/runtimes/homeRuntime.test.ts src/store/home.test.ts src/components/home/GoalConnectionStatus.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"home-resync-functional","command":"pnpm --dir apps/desktop exec vitest run src/acceptance/agent/homeJourney.test.ts -t 'reconnect|resync|stale'","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Home distinguishes reconnecting, resyncing, stale, fresh, and unauthorized","Stale accepted data remains visible while mutations are disabled","A cursor gap requests one authoritative snapshot and converges","Retry is available only for retryable failures"],
  "failureBehavior": ["Do not render a disconnect as an empty Goal list","Do not allow stale or unauthorized commands"],
  "updatedAt": "2026-10-04T19:10:00Z",
  "durableEvidence": [
    {
      "verificationClass": "UX_REVIEW",
      "result": "PASS",
      "ref": "vitest:eventStream+homeRuntime+homeStore+GoalConnectionStatus;tests:27/27"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "development://personal-agent-os-convergence-20261003/artifacts/20261004T190548557666Z/paos-09-home-resync/capture.json;manifest-sha256:adaa2b0f5b12b115830729bf375abb1dfa7ad9ad2176c35ea36ef6d97a55291f"
    }
  ]
}
```

## Four-Hour Delivery

- User action: disconnect, reconnect, and press Retry when permitted.
- Visible result: explicit reconnect/resync/stale states without content loss.
- Station readback: snapshot revision closes the cursor gap.
- Lane: Home; may run beside `PAOS-20`.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Functional slice complete.

- Explicit stream stop now publishes the canonical disconnected lifecycle
  transition, and bridge installation is single-flight across boot callers.
- Home visibly traverses reconnecting, stale, retry, and fresh while retaining
  the last accepted Goal and TaskRun.
- Profile `two` Native proof converged back to the exact Station revision and
  released ports, storage, and runtime profile cleanly.
- Final suite-lifecycle Acceptance remains owned by `PAOS-30`.

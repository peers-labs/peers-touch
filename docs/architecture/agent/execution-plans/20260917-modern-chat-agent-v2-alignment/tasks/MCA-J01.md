# MCA-J01 - Home Command Center

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-J01",
  "workstreamId": "MCA-J01",
  "title": "Home Command Center functional closure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J01-functional",
  "journeyId": "V2-J01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "model/domain/agent",
    "packages/locales",
    "tooling/acceptance",
    "docs/architecture/agent"
  ],
  "readSet": [
    "docs/architecture/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "home-focused",
      "command": "pnpm --dir apps/desktop exec vitest run src/runtimes/homeRuntime.test.ts src/store/home.test.ts src/services/desktop_api.home.test.ts && (cd apps/station && go test ./app/subserver/agent/service -run 'TestHome')",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "home-native-journey",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mca-v2-j01 --gate agent-v2-home-command-center-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Home renders Station-backed pinned Agents, recents, readiness, Brief, Needs You, tasks, and capability status",
    "Chat and Task submissions preserve intent until canonical Station acceptance and navigate to the accepted work",
    "Restart, stale, disconnected, empty, and failed states reconcile without mock success data",
    "The exact-source native Desktop Journey passes and cleans up disposable work"
  ],
  "failureBehavior": [
    "Do not aggregate durable Home truth in the page or a client store",
    "Do not infer readiness from labels or cached configuration",
    "Return the first source or runtime failure to its owning layer"
  ],
  "updatedAt": "2026-09-16T17:27:35Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/desktop:vitest:home-9-pass;apps/station:go-test:TestHome-pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "workspace://65e7b6da4dc9be85/runtime/two/data/v2-j01-native-bfdc1ae5f-run4/journey-result.json"
    }
  ]
}
```

## Objective

Reverify and complete V2-J01 from Station projection through Desktop Home and
canonical Chat/Task handoff.

## Current Snapshot

- Home proto, Station projection/command services, `homeRuntime`, store, API,
  and product page exist.
- Current-source Home focused checks pass: 9 Desktop tests plus Station Home
  service tests.
- Exact-source native Chat/Task/restart functional replay passes on Profile
  `two`, Slot `1`, including disposable-work cleanup and pin restoration.
- Formal Acceptance remains owned by the aggregate MCA-A01 closure.

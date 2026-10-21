# Station-backed command projection

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-03",
  "workstreamId": "ADL",
  "title": "Deterministic command registry and Station capability palette",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ADL-command-projection",
  "journeyId": "agent-slash-command",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop/src",
    "packages/locales",
    "packages/prototypes/desktop",
    "tooling/acceptance",
    "docs/architecture/domains/agent",
    "docs/client/desktop"
  ],
  "readSet": [
    "apps/desktop/src-tauri"
  ],
  "budgets": {
    "focusedCheckSeconds": 360,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "command-source",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "command-functional",
      "command": "make desktop",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "command-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-slash-command-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "command-functional",
    "scenarioIds": [
      "depth-skill-binding",
      "commands-authority",
      "commands-degraded",
      "commands-narrow"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Composer exposes one keyboard-operable Commands & Skills palette.",
    "/help uses the Desktop static registry; /tools and /skills use only the versioned Station snapshot.",
    "/clear submits a Station new-Topic mutation and preserves prior evidence.",
    "Stale Station projection is labeled, disables capability actions, and does not block ordinary text conversation.",
    "Prototype and production consume one shared command semantic contract."
  ],
  "failureBehavior": [
    "Unavailable projection never falls back to localStorage or current-config inference.",
    "Disabled, retired or incompatible capability cannot be selected.",
    "Command visibility never grants authority or bypasses Tool approval."
  ],
  "updatedAt": "2026-10-20T04:10:00.000Z"
}
```

## Current Snapshot

Production now exposes one keyboard-operable Commands & Skills palette.
`/help` is a static Desktop registry; `/tools` and `/skills` consume one
versioned Station `AgentCommandCapabilitySnapshot` built from exact manifests,
bindings and readiness; `/clear` creates and selects a Station Topic. The
Desktop cache distinguishes ready, empty, stale and unavailable and never uses
command state to block ordinary text send. The insert-only Slash path and
prototype/localStorage authority are absent from production.

Focused Station service/handler packages, Desktop TypeScript and 33 focused
Desktop tests pass. Agent Acceptance structure validation and the ADL-03
pipeline contract pass. The Profile-two Native Gate is registered but not run;
stale/unavailable, narrow and real `/clear` behavior remain `UNPROVEN`.

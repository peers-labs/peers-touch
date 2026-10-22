# Installed Linux Native Agent closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-05",
  "workstreamId": "ADL",
  "title": "Installed Linux Native Agent depth end-to-end closure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "ADL-native-closure",
  "journeyId": "agent-depth-linux-native",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "tooling/acceptance",
    "docs/architecture/domains/agent",
    "docs/architecture/engineering/local-dev",
    "docs/client/desktop"
  ],
  "readSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop",
    "packages/prototypes/desktop"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "closure-focused",
      "command": "pnpm --dir apps/desktop run check && cd apps/station/app && go test ./subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "closure-install",
      "command": "make desktop-install",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "closure-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-depth-linux-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "closure-install",
    "scenarioIds": [
      "install-launch",
      "agent-definition",
      "command-palette",
      "skill-activation",
      "turn-attribution",
      "restart-readback"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "The installed artifact reports the frozen source and reaches the reviewed Profile two Station.",
    "The default account creates an Agent, edits and restarts with the same SOUL/AGENTS, and binds a Skill.",
    "/skills shows the exact Binding, skill_view activates the same version, and the final response carries Skill attribution.",
    "Changing the current Binding leaves the historical Turn attribution unchanged.",
    "Restart restores Agent, Topic, command projection and attribution, then releases all owned resources."
  ],
  "failureBehavior": [
    "Environment or missing package failures remain environment blockers.",
    "Any source movement after install invalidates the Journey.",
    "Partial Journey success remains UNPROVEN and never substitutes for cleanup."
  ],
  "updatedAt": "2026-10-20T04:10:00.000Z"
}
```

## Current Snapshot

The installed Linux depth Suite owner is registered and builds through the
unchanged `make desktop-install` entry with explicit acceptance-only WebDriver
instrumentation. It binds one source receipt, Profile-two AgentDefinition,
Station command snapshot, Skill activation, historical attribution,
binding-change immutability, restart readback and reverse cleanup lifecycle.

Real `make desktop-install` preflight stops before build because this host lacks
`webkit2gtk-4.1`, `javascriptcoregtk-4.1` and `libsoup-3.0` development
packages. devctl correctly does not install system packages or require root.
No installed artifact or Native Journey exists, so
`Installed Linux Agent Depth Journey = UNPROVEN` with
`ENVIRONMENT_BLOCKER`.

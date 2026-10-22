# Workspace layout and complete evidence

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "agent-chat-acceptance-20261018", "taskId": "ACA-05", "workstreamId": "ACA",
  "title": "Responsive workspace and complete operation proof",
  "workClass": "product-behavior", "completionClass": "functional", "executionMode": "fix",
  "closureId": "ACA-layout", "journeyId": "agent-chat-workspace", "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop", "packages/locales", "packages/prototypes/desktop", "tooling/acceptance", "docs/architecture/domains/agent", "docs/architecture/engineering/prototypes/desktop-shell", "docs/client"],
  "readSet": ["apps/station/app/subserver/agent", "model/domain/agent"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 1800, "cleanupSeconds": 180},
  "checks": [
    {"id": "workspace-source", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "workspace-native", "command": "make desktop", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "layout-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate agent-chat-layout-native", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "workspace-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate agent-chat-workspace-native", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {
    "scope": "suite", "entryCheckId": "workspace-native", "scenarioIds": ["workspace-wide", "workspace-compact", "workspace-narrow", "workspace-operation-coverage"],
    "maxProvisioningRuns": 1, "maxClientLaunches": 1, "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": true
  },
  "doneWhen": ["Compact and narrow navigation keep Profile, Topics and Chat accessible.", "Every one of the 121 baseline operations and added document contracts has explicit coverage.", "All six Gates bind current source and successful owned-resource cleanup."],
  "failureBehavior": ["Unsupported or unobserved operation remains UNPROVEN.", "Structural validation never substitutes for runtime proof."],
  "updatedAt": "2026-10-18T00:00:00.000Z"
}
```

## Current Snapshot

Implementation in progress. The 560px prototype breakpoint now removes both
desktop rails from the reading path. Chat Back opens the full-width Topic list;
Switch Agent opens a transient left drawer. Profile does not mount Topic history.
Compact Topic navigation includes the projected Topic count.

Five layout checks and six existing workbench contracts passed. Native navigation,
drawer focus restoration, menu anchoring, overflow and the full 121-operation
trace remain UNPROVEN. All six Gates are registered.

The workspace runner executes Profile, layout, Topics, Models and Conversation
in one Suite Runtime. `../workspace-runtime.json` declares their combined
scenario set, one provisioning run and three total client launches: initial
launch, document-restart verification and waiting-clarification restart.
Individual Gate contracts remain projections for focused runs. Operation
children retain their owning Gate IDs and cannot become PROVEN until the
entire Suite, all required operations and terminal cleanup pass.

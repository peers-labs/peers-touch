# Settings and Topic models

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "agent-chat-acceptance-20261018", "taskId": "ACA-02", "workstreamId": "ACA",
  "title": "Settings defaults and composite Topic overrides",
  "workClass": "product-behavior", "completionClass": "functional", "executionMode": "fix",
  "closureId": "ACA-models", "journeyId": "agent-chat-models", "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop", "apps/station/app/subserver/agent", "model/domain/agent", "packages/locales", "tooling/acceptance", "docs/architecture/domains/agent", "docs/client"],
  "readSet": ["packages/prototypes/desktop"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 1200, "cleanupSeconds": 180},
  "checks": [
    {"id": "models-source", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "models-native", "command": "make desktop", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "models-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate agent-chat-models-native", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {
    "scope": "suite", "entryCheckId": "models-native", "scenarioIds": ["models-default", "models-topic-isolation", "models-cli-discovery", "models-disable-recovery"],
    "maxProvisioningRuns": 1, "maxClientLaunches": 1, "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": true
  },
  "doneWhen": ["Composite identities persist and drive actual turns.", "CLI models are Station-discovered and read-only.", "Provider batch enable and disable are atomic."],
  "failureBehavior": ["Never resolve ambiguous model IDs to another Provider.", "Failed mutation keeps authoritative state and usable recovery."],
  "updatedAt": "2026-10-18T00:00:00.000Z"
}
```

## Current Snapshot

Approved; awaiting preceding closure and implementation proof.

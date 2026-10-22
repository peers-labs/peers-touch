# AgentDefinition roundtrip

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-02A",
  "workstreamId": "ADL",
  "title": "Typed AgentDefinition mutation, migration and restart readback",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ADL-agent-definition",
  "journeyId": "agent-definition-roundtrip",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop/src",
    "apps/desktop/src-tauri",
    "docs/architecture/domains/agent",
    "docs/client/desktop"
  ],
  "readSet": [
    "tooling/acceptance"
  ],
  "budgets": {
    "focusedCheckSeconds": 480,
    "functionalRunSeconds": 1500,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "definition-station",
      "command": "cd apps/station/app && go test ./subserver/agent/service ./subserver/agent/handler",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "definition-desktop",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "definition-functional",
      "command": "make desktop",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "definition-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-definition-roundtrip-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "definition-functional",
    "scenarioIds": [
      "definition-create",
      "definition-edit-package",
      "definition-restart",
      "definition-conflict"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "SOUL and AGENTS are typed from Proto through persistence, CRUD and Desktop projection.",
    "Existing Agents migrate atomically and package import/export preserves explicit empty and non-empty documents.",
    "Version conflict rejects without partial mutation or draft loss.",
    "Restart reads the same typed AgentDefinition and no runtime consumer reads the old config_json aliases."
  ],
  "failureBehavior": [
    "Invalid legacy payload remains a visible migration error and is never silently defaulted.",
    "Failed migration retains the prior durable row and blocks mutation.",
    "Agent name, description and avatar remain presentation-only."
  ],
  "updatedAt": "2026-10-20T04:10:00.000Z"
}
```

## Current Snapshot

Typed `identity_prompt` and `agent_config_prompt` now own Proto, persistence,
CRUD, package import/export and Desktop projection. The atomic migration copies
historical aliases into typed columns, removes those aliases from `config_json`,
and fails without mutating an invalid legacy row. Focused persistence, service
and handler tests pass, including explicit empty/non-empty package roundtrip,
restart and CAS rollback.

`agent-definition-roundtrip-native-e2e` is structurally registered with one
Profile-two Suite Runtime covering visible create/edit, package supporting
readback, Native restart, stale-write rejection, retained draft and cleanup.
The Native runtime Gate has not executed and remains `UNPROVEN`.

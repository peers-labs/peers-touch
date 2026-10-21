# Turn attribution projection

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-04",
  "workstreamId": "ADL",
  "title": "Historical typed Turn attribution from ContextLedger to Chat",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ADL-turn-attribution",
  "journeyId": "agent-context-attribution",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop/src",
    "packages/locales",
    "tooling/acceptance",
    "docs/architecture/domains/agent",
    "docs/client/desktop"
  ],
  "readSet": [
    "apps/desktop/src-tauri"
  ],
  "budgets": {
    "focusedCheckSeconds": 480,
    "functionalRunSeconds": 1500,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "attribution-station",
      "command": "cd apps/station/app && go test ./subserver/agent/service ./subserver/agent/handler",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "attribution-desktop",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "attribution-functional",
      "command": "make desktop",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "attribution-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-context-projection-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "attribution-functional",
    "scenarioIds": [
      "depth-skill-binding",
      "depth-skill-consumption",
      "historical-attribution"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "Terminal Turn projection exposes redacted typed attribution pinned to ContextLedger and ToolCall lineage.",
    "Chat badges distinguish actual Skill, Memory, Knowledge, Attachment and Tool participation.",
    "Contextual details expose version, inclusion, omission or truncation reason without raw Prompt, credentials or local paths.",
    "Current Agent or binding changes never rewrite historical attribution.",
    "The Knowledge/Attachment-only owner and current-config inference paths are deleted."
  ],
  "failureBehavior": [
    "Missing or malformed attribution fails closed to unavailable without fabricating sources.",
    "Actor or Turn identity mismatch rejects the projection.",
    "Ordinary Chat never exposes debug trace or sensitive segment content."
  ],
  "updatedAt": "2026-10-20T04:10:00.000Z"
}
```

## Current Snapshot

Station now projects terminal historical attribution from the selected
attempt's typed ContextLedger and exact ToolCall lineage. Skill, Memory,
Knowledge, Attachment and Tool entries carry redacted IDs, names, exact
historical versions, included/omitted/truncated outcome and bounded reason
codes. Missing or malformed lineage is explicitly unavailable. Desktop loads
the projection with historical messages, renders compact actual-participation
badges plus one detail surface, and never consults current Agent bindings.

The Knowledge/Attachment-only badge owner and current Memory/Compression config
inference were deleted. Focused Station service/handler packages, Desktop
TypeScript and 33 focused Desktop tests pass. Agent Acceptance structure
validation and the ADL-04 pipeline contract pass. The Profile-two Native
binding-change/restart Gate is registered but not run and remains `UNPROVEN`.

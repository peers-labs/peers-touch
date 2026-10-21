# Linux Native Agent closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-05",
  "workstreamId": "ADL",
  "title": "Installed Linux Native Agent end-to-end closure",
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
    "The installed Linux artifact reports the frozen source identity and reaches the reviewed remote Station.",
    "The default account creates an Agent, edits and rereads SOUL/AGENTS, and binds an enabled Skill.",
    "/skills shows the binding, skill_view activates the exact version, and the final response carries Skill attribution.",
    "Restart restores the Agent, Topic, command projection and attribution.",
    "Owned processes, ports, temporary installs and fixtures are released."
  ],
  "failureBehavior": [
    "Environment or missing Linux package failures are classified as environment blockers, not product failures.",
    "Any source change after install invalidates the Journey.",
    "Partial Journey success remains UNPROVEN and retains diagnostic evidence only.",
    "Desktop full Acceptance and Windows persistent installation remain explicit non-claims."
  ],
  "updatedAt": "2026-10-20T03:15:00.000Z"
}
```

## Current Snapshot

未开始。Profile `two` Station 可用，但当前 Linux host 无可安装 Desktop
artifact；因此 Linux install、默认账号 Agent depth Journey、restart readback
和 cleanup 均为 `NOT_RUN`。

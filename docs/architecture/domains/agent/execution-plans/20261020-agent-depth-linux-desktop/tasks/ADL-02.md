# Typed Agent definition and Prompt ownership

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-02",
  "workstreamId": "ADL",
  "title": "Typed Agent definition, Skill binding truth and Prompt cutover",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ADL-agent-definition",
  "journeyId": "agent-definition-prompt",
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
    "packages/prototypes/desktop",
    "tooling/acceptance"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "agent-definition-station",
      "command": "cd apps/station/app && go test ./subserver/agent/service ./subserver/agent/handler",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "agent-definition-desktop",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "agent-definition-functional",
      "command": "make desktop",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "agent-definition-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-chat-profile-native",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "SOUL and AGENTS are typed AgentDefinition fields from Proto through Station persistence and Desktop projection.",
    "Agent display metadata remains presentation-only and never enters Provider prompt assembly.",
    "AgentCapabilityBinding is the only enablement and policy truth for Skills.",
    "Prompt assembly reads canonical typed fields and records immutable ContextLedger source refs.",
    "Package import/export and existing Agent migration preserve accepted content atomically."
  ],
  "failureBehavior": [
    "Conflicting Agent or binding revisions reject without partial mutation.",
    "Invalid legacy payloads remain visible as migration errors and are not silently defaulted.",
    "Provider execution never starts when the typed definition or capability snapshot is invalid.",
    "New Profile sections and display-metadata Prompt injection remain explicit non-claims."
  ],
  "updatedAt": "2026-10-20T03:15:00.000Z"
}
```

## Current Snapshot

未开始。SOUL/AGENTS 已参与 Prompt assembly，但生产 CRUD 仍通过
`Agent.config_json` 保存，`AgentDefinition` 类型化字段尚未成为唯一真相；
Skill 可用性同时受旧 Skill row 和 Capability Binding 过滤。

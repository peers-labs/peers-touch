# Turn attribution projection

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-04",
  "workstreamId": "ADL",
  "title": "Typed Turn attribution from ContextLedger to Chat",
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
  "doneWhen": [
    "Terminal Turn projection exposes redacted typed attribution derived from the persisted ContextLedger and ToolCall lineage.",
    "Chat visibly distinguishes Skill, Memory, Knowledge, Attachment and Tool contributions.",
    "Details show inclusion, omission or truncation reason without exposing Prompt content, secrets or local paths.",
    "Historical attribution remains pinned when current Agent bindings change.",
    "The old Knowledge/Attachment-only attribution owner is deleted."
  ],
  "failureBehavior": [
    "Missing or malformed attribution fails closed to an unavailable state without fabricating sources.",
    "Actor or Turn identity mismatch rejects the projection.",
    "Sensitive segment content remains available only through existing redacted diagnostics authority.",
    "Answer correctness and raw Prompt display remain explicit non-claims."
  ],
  "updatedAt": "2026-10-20T03:15:00.000Z"
}
```

## Current Snapshot

未开始。Station 已持久化 ContextLedger、Prompt hash、SkillIndexHash 和
SkillsLoaded；普通 Chat 仅显示 Knowledge/Attachment badge，Skill/Memory
仍主要停留在原始 Turn Diagnostics source refs。

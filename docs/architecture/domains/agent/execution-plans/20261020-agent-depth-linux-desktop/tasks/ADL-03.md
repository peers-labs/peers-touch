# Station-backed Agent command projection

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-03",
  "workstreamId": "ADL",
  "title": "Station-backed slash command and capability palette",
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
      "id": "command-projection-source",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "command-projection-functional",
      "command": "make desktop",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "command-projection-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-slash-command-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Composer opens a keyboard-operable Commands and Skills palette instead of only inserting a slash.",
    "/help, /tools and /skills read current typed projections without starting a model Turn.",
    "/clear creates a new Topic and preserves the prior Topic and evidence.",
    "Skill entries reflect the selected Agent's enabled bindings and readiness.",
    "Prototype and production consume the same command semantics."
  ],
  "failureBehavior": [
    "Stale or unavailable capability projection keeps the last accepted list visibly stale and blocks execution.",
    "A disabled, retired or incompatible capability is absent or visibly unavailable.",
    "Command selection never bypasses Station mutation or Tool approval ownership.",
    "Reference-client CUT commands and developer inspectors remain explicit non-claims."
  ],
  "updatedAt": "2026-10-20T03:15:00.000Z"
}
```

## Current Snapshot

未开始。Production Composer 的 Slash action 只向草稿插入 `/`；基准客户端式
Commands & Skills 菜单只存在于 Prototype，并以 localStorage 作为数据源，
不构成生产投影证据。

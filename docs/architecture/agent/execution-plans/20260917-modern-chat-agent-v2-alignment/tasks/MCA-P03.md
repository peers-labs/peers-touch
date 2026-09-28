# MCA-P03 - Production Debug Telemetry Cleanup

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-P03",
  "workstreamId": "MCA-P03",
  "title": "Remove unconditional Agent UI debug telemetry",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "V2-agent-debug-telemetry-cleanup",
  "journeyId": "V2-agent-core-lifecycle",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop/src/components/agent/workbench/AgentWorkbench.tsx",
    "apps/desktop/src/hooks/useNavigation.ts"
  ],
  "readSet": [
    "apps/desktop/src/kernel",
    "docs/client/desktop/runtime-projections.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 1,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "agent-debug-telemetry-source",
      "command": "if rg -n '127\\.0\\.0\\.1:(7777|7791)|debug-point .*workbench-resize|debug-point .*as-f06-page-switch' apps/desktop/src/components/agent/workbench/AgentWorkbench.tsx apps/desktop/src/hooks/useNavigation.ts; then exit 1; fi && pnpm --dir apps/desktop check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "agent-debug-telemetry-functional",
      "command": "pnpm --dir apps/desktop exec vitest run src/components/agent/workbench/layout.test.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Production resize and navigation paths issue no localhost diagnostic requests",
    "Workbench responsive collapse behavior is unchanged",
    "Navigation event subscription and cleanup are unchanged"
  ],
  "failureBehavior": [
    "Do not remove runtime behavior with the temporary instrumentation",
    "Do not replace debug HTTP calls with another production side channel"
  ],
  "updatedAt": "2026-09-28T08:35:00Z",
  "durableEvidence": []
}
```

## Objective

Remove temporary Agent UI debugging emissions from production paths while
preserving navigation and responsive layout behavior.

## Current Snapshot

- Unconditional localhost requests were present in resize and navigation code.
- The requests have been removed locally and require main-agent source review.

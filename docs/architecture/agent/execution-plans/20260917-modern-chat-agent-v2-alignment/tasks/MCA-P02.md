# MCA-P02 - Agent Topic Recovery And Honest Empty State

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-P02",
  "workstreamId": "MCA-P02",
  "title": "Prevent topic load failures from becoming empty sessions",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "V2-agent-topic-recovery",
  "journeyId": "V2-agent-topic-recovery",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/components/AgentSidebar.tsx",
    "apps/desktop/src/runtimes/agentTopicRuntime.ts",
    "apps/desktop/src/services/openAgentChatSession.ts",
    "apps/desktop/src/store/agentTopics.ts",
    "apps/desktop/src/utils/openAgentChatSession.ts",
    "packages/locales/en/agent.json",
    "packages/locales/zh-CN/agent.json"
  ],
  "readSet": [
    "apps/desktop/src/store/chat.ts",
    "apps/desktop/src/services/chat-service.ts",
    "docs/architecture/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "agent-topic-recovery-source",
      "command": "pnpm --dir apps/desktop check && pnpm --dir apps/desktop exec vitest run src/store/agentTopics.test.ts src/runtimes/agentTopicRuntime.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "agent-topic-recovery-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item MCA-P02 --gate agent-core-lifecycle-native-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "A failed Station topic load preserves the last accepted topic projection",
    "A failed topic load never creates or selects a blank draft",
    "The mounted Agent UI exposes a retryable error",
    "A successful authoritative empty read creates at most one local draft",
    "Explicit New Topic behavior remains unchanged"
  ],
  "failureBehavior": [
    "Never render transport failure as authoritative emptiness",
    "Never hide accepted topics after a failed refresh",
    "Never persist a local draft merely because reconciliation failed"
  ],
  "updatedAt": "2026-09-28T08:35:00Z",
  "durableEvidence": []
}
```

## Objective

Make Agent topic/session projection failure explicit and recoverable instead of
silently replacing persisted history with a blank local conversation.

## Current Snapshot

- Topic loading previously returned `[]` on error.
- The runtime interpreted `[]` as authoritative emptiness and created a draft.
- Local implementation and focused coverage are present but still require
  main-agent product verification.

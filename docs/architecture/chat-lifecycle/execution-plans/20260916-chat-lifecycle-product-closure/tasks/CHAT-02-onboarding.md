# CHAT-02 Discovery To First Message

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-02-onboarding",
  "workstreamId": "CHAT-W01",
  "title": "Find person, establish relationship, and send the first message",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "chat-onboarding",
  "journeyId": "CHAT-J01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/station/app/subserver",
    "apps/station/frame/core/federation",
    "apps/station/frame/core/plugin/server/hertz",
    "apps/station/frame/core/server",
    "apps/station/frame/touch/actor",
    "apps/desktop",
    "tooling/acceptance",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/social-runtime",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "chat-onboarding-source",
      "command": "pnpm --dir apps/desktop exec vitest run src/kernel/identityRuntime.test.ts src/store/federation.test.ts src/store/friendshipProjection.test.ts src/store/socialNormalizers.test.ts src/services/socialRealtime.test.ts src/components/chat/contactSelection.test.ts && python3 -m unittest tooling.acceptance.gates.chat.lifecycle_onboarding_test tooling.acceptance.gates.chat.lifecycle_regression_contract_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-onboarding-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item CHAT-02-onboarding --gate chat-lifecycle-onboarding-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-onboarding-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-onboarding-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "CHAT-UR01: a restorable no-PIN native account cold-launches directly, a PIN-protected account asks only for PIN, and only a missing or revoked session requests provider credentials",
    "CHAT-UR08: request history projects one selectable row per counterparty PTID with current state and total attempt count",
    "CHAT-UR09: contact summary uses the authoritative Station name while canonical PTID, Station peer ID, handle, and Federation ID remain expandable and copyable",
    "Native UI completes local and federated search with stable identity",
    "Friend request send, receive, accept, reject, duplicate, and retry states converge",
    "Accepted contact creates or reuses one Direct conversation",
    "Alice and Bob exchange the first exact plaintext message"
  ],
  "failureBehavior": [
    "Never downgrade a native restorable session to provider reauthentication in the renderer",
    "Preserve search query, selected peer, pending request, and inline retry state",
    "Do not fall back to legacy friend-chat or client-fabricated relationship state"
  ],
  "updatedAt": "2026-09-17T08:20:00Z",
  "durableEvidence": []
}
```

## Objective

Close the product gap that previously allowed Chat acceptance to start from a
pre-created conversation.

## Current Snapshot

- Discovery and relationship source paths exist.
- Station-scoped catalog search and current Native lifecycle proof are missing.
- Direct-open resilience has historical evidence only.

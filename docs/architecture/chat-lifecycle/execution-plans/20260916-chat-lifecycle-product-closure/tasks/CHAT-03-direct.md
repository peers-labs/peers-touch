# CHAT-03 Daily Direct Lifecycle

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-03-direct",
  "workstreamId": "CHAT-W02",
  "title": "Durable Direct messaging and conversation projection",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "chat-direct",
  "journeyId": "CHAT-J02",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/chat",
    "apps/station/app/subserver/conversation",
    "apps/desktop",
    "docs/architecture/social/prototype/README.md",
    "packages/prototypes/desktop/features/social-chat",
    "packages/messaging-core",
    "tooling/acceptance",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "chat-direct-source",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-direct-functional",
      "command": "python3 -m tooling.acceptance.gates.chat.lifecycle_direct",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-direct-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-direct-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Bidirectional text, offline delivery, reconnect, and restart preserve exact identity and order",
    "CHAT-UR02: each newly received message appears in the active receiver transcript without manual reload",
    "CHAT-UR03: aggregate Chat acknowledgement does not erase unread counts from unopened conversation rows",
    "CHAT-UR04: each conversation row immediately projects the exact latest message and timestamp and preserves them after restart",
    "CHAT-UR10: Direct header, row, and detail use authoritative Station names and snapshot-plus-event presence without raw-ID or guessed-status primary labels",
    "CHAT-UR11: local chat background preview is immediate while upload/persistence runs asynchronously, with rollback and retry on failure",
    "CHAT-UR12: message search targets canonical Conversation projections, finds known durable plaintext, and keeps the clear affordance inside the input",
    "CHAT-UR13: current-device conversation clearing commits a verified sequence/hash floor, remains effective after restart, does not affect the peer device, and permits later messages",
    "Queued, retrying, failed, delivered, and read states are visibly distinct",
    "Message-level retry reuses the logical message without duplicate authority facts",
    "Conversation preview, unread/read, history pagination, search, and settings survive restart"
  ],
  "failureBehavior": [
    "Keep exact durable command and user content on uncertain submit outcome",
    "Stop on false delivered/read state, no-op freshness owner, missing per-conversation unread attribution, stale preview, or duplicate message identity"
  ],
  "updatedAt": "2026-09-17T07:00:00Z",
  "durableEvidence": []
}
```

## Objective

Turn the existing Engine and Conversation foundations into a reliable daily
Direct Chat experience with truthful visible state.

## Current Snapshot

- Durable send/receive and historical Native proof exist.
- Current source has no matching proof.
- Visible terminal failure/retry and conversation-list freshness are incomplete.

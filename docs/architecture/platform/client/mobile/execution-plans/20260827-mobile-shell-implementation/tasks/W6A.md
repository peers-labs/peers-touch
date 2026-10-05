# W6A - Chat Contacts And Group Product Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6A",
  "workstreamId": "W6A",
  "title": "Chat, Contacts, and Group source closure",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W6A-source",
  "journeyId": "MS-J03..MS-J04-source",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/chat",
    "apps/station/app/subserver/conversation",
    "apps/station/frame/touch/model/chat",
    "packages/messaging-core",
    "apps/mobile/src-tauri",
    "apps/mobile/src/gen/proto/domain/chat",
    "apps/mobile/src/services",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/features/chat",
    "apps/mobile/src/features/group",
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/ChatPage.tsx",
    "apps/mobile/src/pages/chat",
    "apps/mobile/src/pages/ContactsPage.tsx",
    "apps/desktop/src-tauri/src/messaging/store.rs",
    "apps/desktop/src/gen/proto/domain/chat",
    "docs/architecture/platform/client/mobile",
    "packages/locales",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "docs/architecture/domains/chat/messaging",
    "docs/architecture/platform/client/mobile",
    "docs/client/chat",
    "docs/client/mobile"
  ],
  "budgets": {
    "focusedCheckSeconds": 1770,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "w6a-structure",
      "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "w6a-conversation-owner",
      "command": "(cd apps/station && go test -race -count=1 ./app/subserver/conversation/...)",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "w6a-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/chat src/features/group src/pages/ChatPage.history.test.tsx src/pages/ContactsPage.window.test.tsx",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Chat, Contact, and Group source uses canonical owners",
    "Forward re-encrypts into the destination Conversation",
    "Retract, actor-local hide, and moderation tombstone remain distinct generated commands with authoritative readback",
    "History and rendered lists remain bounded",
    "All local W6A checks pass on exact source"
  ],
  "failureBehavior": [
    "Do not collapse retract, actor-hide, and moderation into one delete operation",
    "Do not reuse source ciphertext when forwarding",
    "Do not retry identity, Inbox, key, or command conflicts without owner semantics",
    "Receiver and restart proof remains in W6A-PROOF"
  ],
  "updatedAt": "2026-09-19T00:18:31.239Z"
}
```

## Objective

Complete the Mobile-owned Chat, Contacts, and Group source against canonical owners.

## Current Snapshot

- Generated Conversation contracts and Station authority keep forward,
  retract, actor-hide, and moderation as four distinct ordered actions.
- Direct Double Ratchet and Group MLS forward paths create fresh destination
  ciphertext; attachments are copied from verified local plaintext into the
  existing durable upload draft and receive new object crypto material.
- Mobile readback preserves moderation separately from retract, actor-hide
  filters only that actor's projection, and the bottom action sheet exposes
  exact role-gated actions with bounded forward destination selection.
- Required checks, full Mobile Vitest (92 files / 666 tests), Messaging Core
  (116 tests), Mobile Rust (206 tests), iOS project parsing, contract/hard-cut
  scans, bounded-list/history checks, and prototype layout checks pass.
- Acceptance gap detection cannot isolate this Task from the intentionally
  shared dirty worktree; receiver and restart proof remains `UNPROVEN` in
  `W6A-PROOF`.

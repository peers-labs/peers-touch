# W6A-CORE - Mobile Chat Contacts And Group Core

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6A-CORE",
  "workstreamId": "W6A",
  "title": "Mobile-owned Chat, Contacts, and Group core",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W6A-core-source",
  "journeyId": "MS-J03..MS-J04-mobile-core",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/components/BoundedList.tsx",
    "apps/mobile/src/features/chat",
    "apps/mobile/src/features/group",
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/ChatPage.tsx",
    "apps/mobile/src/pages/ContactsPage.tsx"
  ],
  "readSet": [
    "docs/architecture/messaging-platform",
    "docs/architecture/mobile",
    "docs/client/chat",
    "docs/client/mobile"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "w6a-core-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/chat src/features/group src/features/social/contactJourney.test.ts src/features/social/socialRequestPagination.test.ts src/pages/ChatPage.history.test.tsx src/pages/ContactsPage.window.test.tsx",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "w6a-core-bounds",
      "command": "node apps/mobile/scripts/check-bounded-lists.mjs && node apps/mobile/scripts/check-chat-history-search.mjs",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Mobile-owned Chat, Contacts, and Group commands use the accepted runtime owners",
    "Friend Request pagination and stale-session fencing pass",
    "Message, contact, and member presentation remains bounded with stable anchors"
  ],
  "failureBehavior": [
    "Protected Group and Social owner operations remain in W5-OWNER",
    "Forward, delete, and retained-history budget remain outside this core slice",
    "Receiver and restart proof remains in W6A-PROOF"
  ],
  "updatedAt": "2026-09-16T00:00:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3045"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src/features/social/socialRequestPagination.test.ts"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src-tauri/target/search-interaction-browser/results.json"
    }
  ]
}
```

## Objective

Close the already implemented Mobile-owned Chat, Contacts, and Group source
without conflating it with protected owner APIs or receiver runtime proof.

## Current Snapshot

- Fresh exact-worktree checks pass: 144 focused tests, 1,250 traversed rows
  per viewport with at most 100 mounted, and 56/56 indexed-search scenarios.
- Protected owner APIs and receiver/runtime proof remain outside this closure.

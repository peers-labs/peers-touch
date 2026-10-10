# MWPU-04-CHAT: Chat Surface Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-04-CHAT",
  "workstreamId": "MWPU-PAGES",
  "title": "Close three-client Direct, Group, voice, call, composer, and action workflows",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-chat-usability",
  "journeyId": "MS-J03",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop/src/components/chat",
    "apps/desktop/src/modules/p2p",
    "apps/desktop/src/pages/SocialChatPage.tsx",
    "apps/desktop/src/services",
    "apps/mobile/scripts/run-three-client-product-journey.mjs",
    "apps/mobile/src/pages/ChatPage.tsx",
    "apps/mobile/src/pages/chat",
    "apps/mobile/src/features/chat",
    "apps/mobile/src/components/call",
    "apps/mobile/src/styles.css",
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/envelope",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "apps/mobile/src/runtimes/messagingRuntime.ts",
    "docs/architecture/domains/chat/lifecycle",
    "docs/client/chat/chat-ux-contract.md",
    "docs/client/mobile/chat-layout-contract.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 5400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "chat-source",
      "command": "pnpm --dir apps/desktop exec vitest run src/components/chat src/pages/SocialChatPage.test.tsx src/modules/p2p && pnpm --dir apps/mobile exec vitest run src/pages/ChatPage.history.test.tsx src/pages/ChatPage.localFlag.test.ts src/pages/chat src/features/chat",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-foreground-functional",
      "command": "node apps/mobile/scripts/run-three-client-product-journey.mjs --phase chat",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-foreground-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-chat-contacts-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "chat-foreground-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set chat",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "chat-foreground-functional",
    "scenarioIds": ["three-client-direct", "three-client-group", "voice-message", "voice-video-call", "chat-recovery"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 3,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Android Alice, Desktop Bob, and iOS Coral exchange receiver-visible Direct messages in every required direction using text, attachment, reaction, reply, forward, voice message, history, and recovery actions",
    "all three actors create and use one Group, exercise membership and administration, and receive converged messages and metadata",
    "voice and video call start, ringing, answer, reject, hangup, retry, and stale-state cleanup are operated through foreground client controls",
    "conversation titles use friendly identity and never raw PTID",
    "messages remain readable and all bottom/floating layers are non-occluding",
    "degraded runtime state is local and the composer remains usable whenever writes are admitted",
    "foreground screenshots and interaction traces cover every declared Chat workflow on all three clients"
  ],
  "failureBehavior": [
    "do not accept message delivery alone as Chat usability proof",
    "do not overlay message content with action controls",
    "do not advance while any Chat inventory row is unvisited or visually blocked"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- Chat command and receiver behavior is covered by narrow functional Gates.
- Current native evidence exposes raw PTID title text, weak hierarchy, an
  app-obstructing module notice, and compromised composer space.
- Conversation list, actions, search, Group management, keyboard, and
  attachment/voice states have not been reviewed as one foreground product.

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
    "apps/desktop/src-tauri/Info.plist",
    "apps/desktop/src-tauri/src/messaging",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/mobile/scripts/run-three-client-product-journey.mjs",
    "apps/mobile/scripts/review-mobile-surfaces.mjs",
    "apps/mobile/src/acceptance/chatSurfaceFixture.ts",
    "apps/mobile/src/acceptance/chatSurfaceFixture.test.ts",
    "apps/mobile/src/components/MobileAvatar.tsx",
    "apps/mobile/src/components/MobileAvatar.test.tsx",
    "apps/mobile/src/app/lifecycle",
    "apps/mobile/src/app/mobileI18n.test.tsx",
    "apps/mobile/src-tauri/Cargo.toml",
    "apps/mobile/src-tauri/Cargo.lock",
    "apps/mobile/src-tauri/tauri.conf.json",
    "apps/mobile/src-tauri/src/messaging",
    "apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/AndroidManifest.xml",
    "apps/mobile/src/pages/ChatPage.tsx",
    "apps/mobile/src/pages/chat",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src/features/station/StationLaunchScreen.tsx",
    "apps/mobile/src/features/chat",
    "apps/mobile/src/features/call",
    "apps/mobile/src/features/social",
    "apps/mobile/src/components/call",
    "apps/mobile/src/styles.css",
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/envelope",
    "apps/station/app/subserver/key_exchange",
    "packages/messaging-core/src/inbox",
    "packages/messaging-core/src/mls",
    "packages/prototypes/mobile/chat",
    "packages/prototypes/desktop/features/social-chat",
    "packages/client-chat-core/src/chatEmojis.ts",
    "packages/client-chat-core/src/callId.ts",
    "packages/client-chat-core/src/index.ts",
    "packages/client-chat-core/tests/im-projection-contract.test.mjs",
    "packages/locales",
    "docs/architecture/domains/chat/messaging/data-model.md",
    "docs/architecture/domains/social/core/prototype/README.md",
    "docs/client/chat/chat-ux-contract.md",
    "docs/client/mobile/chat-layout-contract.md",
    "docs/client/common/ui-identity/components.md",
    "docs/client/desktop/chat-layout-contract.md",
    "docs/architecture/platform/client/mobile/social-parity/prototype/README.md",
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
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml inbox::drain && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml messaging:: && pnpm --dir apps/desktop exec vitest run src/components/chat src/pages/SocialChatPage.test.tsx src/modules/p2p && pnpm --dir apps/mobile run check:web && pnpm --dir apps/mobile exec vitest run src/components/MobileAvatar.test.tsx src/app/lifecycle/runtimeReadiness.test.ts src/pages/ChatPage.history.test.tsx src/pages/ChatPage.localFlag.test.ts src/pages/chat src/features/chat && python3 -m unittest tooling.acceptance.gates.mobile.three_client_product_journey_evidence_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-foreground-functional",
      "command": "node apps/mobile/scripts/run-three-client-product-journey.mjs --phase chat --publish-evidence",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-supporting-harness-contract-proof",
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
    "conversation first load preserves row geometry while cached refresh and recoverable failure retain readable rows",
    "unread totals derive from projected conversations and relationship state no longer competes with preview and unread state",
    "consecutive messages form sender clusters with one final metadata row and one avatar per incoming cluster",
    "one failed message owns one local Retry action while unknown outcome owns Check status and forbids blind retry",
    "pinned content uses a compact banner plus dedicated list instead of a permanent thread switch",
    "messages remain readable and all bottom/floating layers are non-occluding",
    "degraded runtime state is local and the composer remains usable whenever writes are admitted",
    "durable foreground screenshots and interaction traces cover Direct, Group, voice, call, history, and recovery workflows on Android Alice, Desktop Bob, and iOS Coral",
    "current-source Mobile surface evidence and agent visual review cover every declared Chat inventory row in portrait, landscape, and maximum-text cells"
  ],
  "failureBehavior": [
    "do not accept message delivery alone as Chat usability proof",
    "do not claim the two-iOS Harness Gate proves the separate three-client foreground Journey",
    "do not leave the three-client foreground result or screenshots only in temporary storage",
    "do not overlay message content with action controls",
    "do not add a second avatar, delivery-status, or runtime owner",
    "do not advance while any Chat inventory row is unvisited or visually blocked"
  ],
  "updatedAt": "2026-10-12T13:46:00.000Z"
}
```

## Current Snapshot

- Chat command and receiver behavior is covered by narrow functional Gates.
- Current native evidence exposes raw PTID title text, weak hierarchy, an
  app-obstructing module notice, and compromised composer space.
- Conversation list, actions, search, Group management, keyboard, and
  attachment/voice states have not been reviewed as one foreground product.
- The Owner-confirmed 2026-10-12 prototype adds the exact interaction baseline
  for list loading, cached refresh, sender clusters, message-local recovery,
  pinned navigation, avatar roles, and Mobile touch geometry.

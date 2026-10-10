# MPS-02-HOME-EXPLORE - Composed Home And Explore

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-02-HOME-EXPLORE",
  "workstreamId": "MPS-EXPERIENCE",
  "title": "Render one bounded Home and Explore projection for public, private, local and remote Moments",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mps-home-explore",
  "journeyId": "MSP-J01-J05",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/MomentsPage.tsx",
    "apps/mobile/src/pages/moments",
    "apps/mobile/src/runtimes/momentsProjectionDescriptor.ts",
    "apps/mobile/src/services/gateways/momentsGateway.ts",
    "apps/mobile/src/styles.css",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "docs/architecture/domains/social/core",
    "docs/architecture/platform/client/mobile/social-parity",
    "model/domain/social"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "mps-feed-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social/momentsFeedStore.test.ts src/pages/MomentsPage.test.ts src/pages/moments/MomentFeedItem.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-feed-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-feed-native",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "mps-feed-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-feed-native",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mps-feed-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate mobile-social-feed-native",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mps-feed-old-owner-removal",
      "command": "if rg -n 'readActiveMomentsRuntime|usePrivateMomentsRuntime|useMomentsFeed' apps/mobile/src/pages/MomentsPage.tsx; then exit 1; else test $? -eq 1; fi",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Home composes authorized public and private local and remote items by canonical Post ID",
    "Explore preserves canonical public sort and pagination semantics",
    "The Home and Explore segment is 36px with 32px controls and preserves feed anchor on switch or refresh",
    "Text, image, video, link, poll, repost and location render without fallback content kinds",
    "Feed windows, loading, empty, denied and source-unavailable states remain bounded and generation-scoped"
  ],
  "failureBehavior": [
    "Do not create separate private and public pages or stores as product owners",
    "Do not infer authorization, relationship or content kind from missing fields",
    "Do not retain hidden page trees or unbounded feed rows"
  ],
  "updatedAt": "2026-10-06T09:34:00.000Z"
}
```

## Objective

把现有 public feed 与 Native private projection 合并为同一 receiver-scoped Mobile
体验，同时保持 Home/Explore 各自的 canonical cursor 和 anchor。

## Current Snapshot

- Mobile has a public feed store and separate private read projection.
- Explore is not a first-class Mobile scope with Desktop sort parity.
- Content-kind and remote delivery states are not represented in one feed contract.

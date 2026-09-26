# W7S: Desktop Pilot Source

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SECURE-CONTENT-HARD-CUT-20260913","taskId":"W7S","workstreamId":"W7","title":"Desktop pilot source closure","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"w7s-desktop-source","journeyId":"sc-dj-w7-source","runtimeClass":"source-only","writeSet":["apps/desktop","apps/station/app/subserver/social","packages/messaging-core","packages/secure-content-core","packages/locales","tooling/development/secure_content"],"readSet":["docs/architecture/social","docs/architecture/secure-content"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1,"cleanupSeconds":60},"checks":[{"id":"w7s-source","command":"python3 -m unittest tooling.development.secure_content.test_run","verificationClass":"SOURCE_CHECK"}],"doneWhen":["Desktop Native, store, UI, and attach-only W7 scenarios implement SC-D21"],"failureBehavior":["source completion never claims receiver-visible runtime behavior"],"updatedAt":"2026-09-18T00:00:00.000Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"checkpoint 6eeb92b05; cargo 71/71; vitest 17/17"}]}
```

## Current Snapshot

- Desktop pilot source closure is complete; runtime proof belongs to W7.

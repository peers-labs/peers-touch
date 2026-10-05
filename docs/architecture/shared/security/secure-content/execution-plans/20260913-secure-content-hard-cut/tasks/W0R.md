# W0R: Runtime Control

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SECURE-CONTENT-HARD-CUT-20260913","taskId":"W0R","workstreamId":"W0R","title":"Machine registration and runtime lease closure","workClass":"infrastructure","completionClass":"functional","executionMode":"build","closureId":"w0r-runtime-control","journeyId":"sc-dj-runtime-lease-control","runtimeClass":"source-only","writeSet":["Makefile","tooling/make/local-dev.mk","tooling/scripts/local-dev"],"readSet":["docs/architecture/local-dev-control-plane"],"budgets":{"focusedCheckSeconds":300,"functionalRunSeconds":300,"cleanupSeconds":60},"checks":[{"id":"w0r-source","command":"node --test tooling/scripts/local-dev/dev-work.test.mjs","verificationClass":"SOURCE_CHECK"},{"id":"w0r-functional","command":"make config","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["machine registration and declared runtime ownership fail closed"],"failureBehavior":["worktree, Profile, slot, or lease mismatch blocks execution"],"updatedAt":"2026-09-18T00:00:00.000Z","durableEvidence":[{"verificationClass":"FUNCTIONAL_CHECK","result":"PASS","ref":"checkpoint 8a7722c93"}]}
```

## Current Snapshot

- Machine registration and lease control are complete.

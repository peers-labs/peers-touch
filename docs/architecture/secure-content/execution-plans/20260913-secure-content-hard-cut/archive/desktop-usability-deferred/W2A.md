# W2A: Shared Kernel Source

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SECURE-CONTENT-HARD-CUT-20260913","taskId":"W2A","workstreamId":"W2","title":"Atomic shared-kernel source cut","workClass":"refactor","completionClass":"source","executionMode":"build","closureId":"w2a-kernel","journeyId":"sc-dj-chat-kernel-source","runtimeClass":"source-only","writeSet":["packages/secure-content-core","packages/messaging-core","apps/station/app/internal/securecontent","apps/station/app/subserver/conversation","apps/desktop/src-tauri","apps/mobile/src-tauri"],"readSet":["model/domain/chat"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1,"cleanupSeconds":60},"checks":[{"id":"w2a-source","command":"cargo test --manifest-path packages/secure-content-core/Cargo.toml","verificationClass":"SOURCE_CHECK"}],"doneWhen":["Chat and Social share the portable Secure Content kernel without authority drift"],"failureBehavior":["no compatibility shim or duplicate crypto implementation remains"],"updatedAt":"2026-09-18T00:00:00.000Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"checkpoint c69edd606"}]}
```

## Current Snapshot

- Shared-kernel source work is complete; Native proof remains in W2.

# W11 Source: Hard-Cut Substrate

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SECURE-CONTENT-HARD-CUT-20260913","taskId":"W11-SOURCE","workstreamId":"W11","title":"Source, route, generated, deploy, and health hard cut","workClass":"refactor","completionClass":"source","executionMode":"build","closureId":"w11-source-hardcut","journeyId":"sc-dj-hardcut-source","runtimeClass":"source-only","writeSet":["model","apps/station","apps/desktop","apps/mobile","packages","tooling/scripts","tooling/development/secure_content","tooling/acceptance","docs/architecture/secure-content","docs/architecture/social","docs/global","docs/knowledge"],"readSet":["docs/architecture/messaging-platform","docs/architecture/api-ownership","docs/architecture/encryption"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":1,"cleanupSeconds":120},"checks":[{"id":"w11-source","command":"python3 tooling/scripts/secure-content-hard-cut-check.py","verificationClass":"SOURCE_CHECK"},{"id":"w11-diff","command":"git diff --check","verificationClass":"STRUCTURAL_CHECK"}],"doneWhen":["legacy source, route, and generated consumers are removed and Station health passes"],"failureBehavior":["remaining old-path references block the functional hard-cut matrix"],"updatedAt":"2026-09-18T00:00:00.000Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"checkpoint a4031b195; Station four deploy and health PASS"}]}
```

## Current Snapshot

- Source, route, generated, deploy, and health closure is complete.

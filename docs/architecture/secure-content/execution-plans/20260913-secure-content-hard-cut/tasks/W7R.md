# W7R: Runtime Manifest And Owner

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SECURE-CONTENT-HARD-CUT-20260913","taskId":"W7R","workstreamId":"W7","title":"Runtime Manifest v2 and executable owner source","workClass":"infrastructure","completionClass":"source","executionMode":"build","closureId":"w7r-runtime-owner","journeyId":"sc-dj-runtime-manifest-v2","runtimeClass":"source-only","writeSet":["tooling/development/secure_content","tooling/acceptance/gates/agent/foundation_runtime_client.py","tooling/acceptance/gates/agent/foundation_runtime_client_test.py","tooling/make/local-dev.mk","tooling/scripts/local-dev","tooling/scripts/plan"],"readSet":["apps/desktop","tooling/acceptance"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1,"cleanupSeconds":120},"checks":[{"id":"w7r-owner","command":"python3 -m unittest tooling.development.secure_content.test_runtime_owner tooling.development.secure_content.test_runtime_manifest","verificationClass":"SOURCE_CHECK"},{"id":"w7r-workflow","command":"node --test tooling/scripts/local-dev/dev-work.test.mjs tooling/scripts/plan/planctl.test.mjs","verificationClass":"SOURCE_CHECK"}],"doneWhen":["Runtime Manifest v2 and the owner-controlled launch, restart, lineage, and cleanup path are implemented"],"failureBehavior":["missing service, fixture, client, session, or lease identity remains BLOCKED/UNPROVEN"],"updatedAt":"2026-09-18T00:00:00.000Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"checkpoint 341e818910ec954cf2ecf66f2eac71b3579d6227; Python 80; Node 146"}]}
```

## Current Snapshot

- Runtime Manifest v2 and executable owner source are complete.
- SC-D28 preserves this closure as historical source evidence; W12A owns the
  v3 hard cut, and no v2 artifact can satisfy current W7 runtime admission.

# W7A: Content PreKey Client Boundary

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SECURE-CONTENT-HARD-CUT-20260913","taskId":"W7A","workstreamId":"W7A","title":"Content PreKey client boundary","workClass":"infrastructure","completionClass":"functional","executionMode":"build","closureId":"w7a-prekey-client","journeyId":"sc-dj-content-prekey-client-boundary","runtimeClass":"service","writeSet":["model/domain/secure_content/prekey.proto","model/domain/error/error.proto","apps/station/app/subserver/key_exchange","apps/station/app/cmd/station_api_ownership","tooling/development/secure_content/scenarios/content_prekey_client_boundary.py"],"readSet":["tooling/acceptance/gates.yaml"],"budgets":{"focusedCheckSeconds":900,"functionalRunSeconds":1200,"cleanupSeconds":60},"checks":[{"id":"w7a-source","command":"node --test tooling/scripts/check-content-prekey-errors.test.mjs","verificationClass":"SOURCE_CHECK"},{"id":"w7a-functional","command":"python3 -m tooling.development.secure_content.run --runtime service --scenario content-prekey-client-boundary --budget-seconds 1200","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["canonical client publication and inventory boundaries pass exact replay and isolation checks"],"failureBehavior":["wire, auth, or ownership drift fails closed"],"updatedAt":"2026-09-18T00:00:00.000Z","durableEvidence":[{"verificationClass":"FUNCTIONAL_CHECK","result":"PASS","ref":"checkpoint 14b0cdf81"}]}
```

## Current Snapshot

- Canonical Content PreKey client boundary is complete.

# CSS-04: Private Delivery And Object Read

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-04-private-delivery","workstreamId":"CSS-W03","title":"Commit and deliver viewer-scoped private Social resources","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"cross-station-private-delivery","journeyId":"SOC-SEC-J10","runtimeClass":"service","writeSet":["apps/station/frame/core/federation","apps/station/app/subserver/social"],"readSet":["model/domain/social/private_federation.proto","model/domain/federation/delivery.proto","docs/architecture/secure-content","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":3600,"functionalRunSeconds":3600,"cleanupSeconds":180},"checks":[{"id":"private-delivery-source","command":"cd apps/station && go test -race ./frame/core/federation/... ./app/subserver/social/...","verificationClass":"SOURCE_CHECK"},{"id":"private-delivery-functional","command":"cd apps/station && go test -race ./frame/core/federation/... ./app/subserver/social/... -run 'TestFederatedPrivate(Resource|Object|Projection)'","verificationClass":"FUNCTIONAL_CHECK"},{"id":"private-delivery-proof","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-delivery","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["source resource and every required per-actor outbox frame commit atomically","receiver inbox and viewer projection commit atomically","Bob reads payload and object ciphertext through Station B while Eve is denied","duplicate, wrong-target, conflict, crash and outage create no duplicate or partial projection","supported same-Federation recipients no longer reach the unconditional locality rejection"],"failureBehavior":["large object bytes never enter a frame","receiver stores no co-recipient identities or envelopes","clients never connect directly to a remote Station","invalid or stale frames cannot mutate Social projection"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-04 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-04 execution"},{"verificationClass":"ACCEPTANCE_PROOF","result":"NOT_RUN","ref":"pending AS17/AS18/AS19/AS21/AS24 evidence"}]}
```

## Current Snapshot

Same-Station Social commits ciphertext and local delivery intents; no private
Social Federation receiver, imported projection, or object peer stream exists.

This is the atomic cutover from remote rejection to positive private delivery.

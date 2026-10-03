# CSS-06: Revocation And Recovery

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-06-revocation-recovery","workstreamId":"CSS-W05","title":"Converge cross-Station revocation and trusted recovery","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"cross-station-revocation-recovery","journeyId":"SOC-SEC-J11-J12","runtimeClass":"service","writeSet":["apps/station/app/subserver/social"],"readSet":["apps/station/frame/core/federation","apps/station/app/subserver/key_exchange","model/domain/social/private_federation.proto","docs/architecture/secure-content","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":3000,"cleanupSeconds":180},"checks":[{"id":"revocation-recovery-source","command":"cd apps/station && go test -race ./app/subserver/social/...","verificationClass":"SOURCE_CHECK"},{"id":"revocation-recovery-functional","command":"cd apps/station && go test -race ./app/subserver/social/... -run 'TestFederatedPrivate(Invalidation|Recovery|Reconcile)'","verificationClass":"FUNCTIONAL_CHECK"},{"id":"revocation-recovery-proof","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-revocation-recovery","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["delete, friendship loss and block emit monotonic invalidations","recipient-local block suppresses immediately and source truth converges","tombstones reject stale delivery and reconcile","Bob2 recovers authorized never-opened history","revoked devices and expired membership remain denied"],"failureBehavior":["lost events repair through durable replay or reconcile","wrong recovery secret or proof remains terminally denied","no result claims deletion of recipient-controlled plaintext copies"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-06 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-06 execution"},{"verificationClass":"ACCEPTANCE_PROOF","result":"NOT_RUN","ref":"pending AS22/AS23/AS24 evidence"}]}
```

## Current Snapshot

Same-Station delete, block, and recovery work, but no remote invalidation
tombstone or imported-resource recovery projection exists.

This task starts after CSS-05 closes its Social authority changes.

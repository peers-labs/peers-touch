# CSN-05: Revocation And Recovery

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SOCIAL-CROSS-STATION-NATIVE-20261003","taskId":"CSN-05-revocation-recovery","workstreamId":"CSN-W05","title":"Converge private resource revocation and trusted recovery","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"cross-station-revocation-recovery","journeyId":"SOC-SEC-J11-J12","runtimeClass":"service","writeSet":["apps/station/app/subserver/social"],"readSet":["apps/station/frame/core/federation","apps/station/app/subserver/key_exchange","model/domain/social","docs/architecture/secure-content"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":3000,"cleanupSeconds":180},"checks":[{"id":"cross-station-revocation-source","command":"cd apps/station && go test -race ./app/subserver/social/...","verificationClass":"SOURCE_CHECK"},{"id":"social-cross-station-revocation-recovery","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-revocation-recovery","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["delete, friendship loss and block emit monotonic invalidations","recipient-local block suppresses immediately and source invalidation converges","stale delivery cannot revive a revoked generation","Bob2 recovers never-opened authorized history and revoked devices remain denied"],"failureBehavior":["event loss is repaired by reconcile and durable replay","expired membership blocks new delivery and recovery","no claim promises deletion of exported or maliciously saved plaintext"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSN-05 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending AS22/AS23/AS24 proof"}]}
```

## Current Snapshot

- Same-Station delete/block/recovery behavior is Desktop-proven.
- Cross-Station relationship events exist.
- No private resource invalidation or recipient projection tombstone exists.

## Closure

Both Stations converge on revocation without resurrection, while an authorized
replacement device can recover valid history.

## Concurrency Decision

May execute in parallel with CSN-04 after CSN-03; both must avoid overlapping
ownership in the same Social service files.

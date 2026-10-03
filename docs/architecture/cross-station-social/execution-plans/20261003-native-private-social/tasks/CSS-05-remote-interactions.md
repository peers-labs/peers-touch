# CSS-05: Remote Private Interactions

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-05-remote-interactions","workstreamId":"CSS-W04","title":"Route private Comment and Reaction to source Social","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"cross-station-interactions","journeyId":"SOC-SEC-J11","runtimeClass":"service","writeSet":["apps/station/app/subserver/social"],"readSet":["apps/station/frame/core/federation","model/domain/social/private_federation.proto","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":2400,"cleanupSeconds":120},"checks":[{"id":"remote-interaction-source","command":"cd apps/station && go test -race ./app/subserver/social/...","verificationClass":"SOURCE_CHECK"},{"id":"remote-interaction-functional","command":"cd apps/station && go test -race ./app/subserver/social/... -run 'TestFederatedPrivate(Comment|Reaction)'","verificationClass":"FUNCTIONAL_CHECK"},{"id":"remote-interaction-proof","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-interaction","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Comment prepare and submit both return to source authority","Reaction and unreaction use typed source mutations","actor Home Station persists one command identity and durable outbox record","source revalidates the parent and exact replay commits one result","both viewer projections converge"],"failureBehavior":["deleted parent, revoked grant, invalid payload, rate limit and hash conflict write no interaction","unknown outcome retries the same command ID","comment draft remains on the Native client","recipient Station never becomes interaction authority"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-05 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-05 execution"},{"verificationClass":"ACCEPTANCE_PROOF","result":"NOT_RUN","ref":"pending AS20 evidence"}]}
```

## Current Snapshot

Private Comment and Reaction are source-authoritative only on same-Station
paths; no remote prepare/submit or mutation result path exists.

This task is serial before CSS-06 because both change Social authority files.

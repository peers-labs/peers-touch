# CSS-03: Remote Content PreKeys

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-03-remote-prekeys","workstreamId":"CSS-W02","title":"Claim Content PreKeys from recipient Home Stations","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"cross-station-prekeys","journeyId":"SOC-SEC-J10","runtimeClass":"service","writeSet":["apps/station/frame/core/federation","apps/station/app/subserver/key_exchange","apps/station/app/subserver/social"],"readSet":["model/domain/secure_content/prekey.proto","model/domain/key_exchange/key_exchange.proto","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":1800,"cleanupSeconds":120},"checks":[{"id":"remote-prekey-source","command":"cd apps/station && go test -race ./app/subserver/key_exchange/... ./frame/core/federation/... ./app/subserver/social/...","verificationClass":"SOURCE_CHECK"},{"id":"remote-prekey-functional","command":"cd apps/station && go test -race ./app/subserver/key_exchange/... ./app/subserver/social/... -run 'TestFederatedContentPreKey'","verificationClass":"FUNCTIONAL_CHECK"},{"id":"remote-prekey-proof","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-prekey","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["source Social partitions verified recipients by Home Station","target Key Exchange authenticates Federation membership and target identity","exact replay returns identical claims and hash conflict is terminal","an unavailable required recipient prevents Social resource commit"],"failureBehavior":["partially consumed one-time keys may be abandoned but audience is never reduced","timeout or cancellation before durable admission preserves the draft","Social never accesses Key Exchange persistence directly"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-03 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-03 execution"},{"verificationClass":"ACCEPTANCE_PROOF","result":"NOT_RUN","ref":"pending CSS-03 execution"}]}
```

## Current Snapshot

Remote endpoint manifests resolve today, but Content PreKey inventory and claim
remain local to one Home Station.

This closure proves remote key authority without enabling private resource
delivery.

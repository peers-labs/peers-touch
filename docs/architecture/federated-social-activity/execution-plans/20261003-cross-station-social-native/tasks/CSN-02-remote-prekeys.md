# CSN-02: Remote Content PreKey Authority

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SOCIAL-CROSS-STATION-NATIVE-20261003","taskId":"CSN-02-remote-prekeys","workstreamId":"CSN-W01","title":"Claim remote Content PreKeys through recipient Home Stations","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"cross-station-prekeys","journeyId":"SOC-SEC-J10","runtimeClass":"service","writeSet":["apps/station/frame/core/federation","apps/station/app/subserver/key_exchange","apps/station/app/subserver/social"],"readSet":["model/domain/social","model/domain/federation/delivery.proto","model/domain/key_exchange/key_exchange.proto","docs/architecture/federated-social-activity"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":1800,"cleanupSeconds":120},"checks":[{"id":"cross-station-prekey-source","command":"cd apps/station && go test -race ./app/subserver/key_exchange/... ./frame/core/federation/...","verificationClass":"SOURCE_CHECK"},{"id":"social-cross-station-prekey","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-prekey","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["source Social groups targets by verified Home Station","remote inventory and claim are Federation-authenticated and target-bound","exact replay returns identical claims and hash conflict is terminal","any unavailable required recipient prevents Social resource commit"],"failureBehavior":["partially claimed one-time keys may be discarded but audience is never reduced","remote outage preserves the draft and creates no Post","Social never reads or writes Key Exchange persistence directly"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSN-02 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending two-Station PreKey proof"}]}
```

## Current Snapshot

- Remote signed endpoint-manifest resolution already works.
- Content PreKey publish/inventory/claim is local-only.
- Current locality guards reject remote actors before any PreKey claim.

## Closure

Local and remote recipients produce one canonical ordered slot set for the
existing encryption plan with crash-safe exact replay.

## Concurrency Decision

Serial after CSN-01 because implementation consumes the generated peer contract.

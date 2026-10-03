# CSN-03: Private Resource Delivery

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SOCIAL-CROSS-STATION-NATIVE-20261003","taskId":"CSN-03-private-delivery","workstreamId":"CSN-W03","title":"Deliver viewer-scoped private resources across Stations","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"cross-station-private-delivery","journeyId":"SOC-SEC-J10","runtimeClass":"service","writeSet":["apps/station/frame/core/federation","apps/station/app/subserver/social"],"readSet":["model/domain/social","model/domain/federation/delivery.proto","docs/architecture/federated-social-activity","docs/architecture/secure-content"],"budgets":{"focusedCheckSeconds":3600,"functionalRunSeconds":3600,"cleanupSeconds":180},"checks":[{"id":"cross-station-delivery-source","command":"cd apps/station && go test -race ./app/subserver/social/... ./frame/core/federation/...","verificationClass":"SOURCE_CHECK"},{"id":"social-cross-station-delivery","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-delivery","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["source resource and every remote per-actor outbox frame commit atomically","receiver inbox and viewer-scoped projection commit atomically","Bob reads exact payload and object ciphertext through Station B while Eve is denied","duplicate, wrong-target, hash-conflict and outage cases create no duplicate or partial projection","supported same-Federation recipients no longer hit the legacy locality rejection"],"failureBehavior":["large object bytes never enter a Federation frame","receiver stores no co-recipient envelopes or identities","clients never connect directly to a remote Station","stale or invalid frames cannot mutate Social projection"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSN-03 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending AS17/AS18/AS19/AS21/AS24 proof"}]}
```

## Current Snapshot

- Same-Station Social UOW persists ciphertext, grants, envelopes and delivery intents.
- Shared Federation delivery supports durable typed payloads.
- No private Social receiver, imported projection or object peer stream exists.

## Closure

One source commit produces exactly one authorized remote projection per actor,
with source-authority object reads and no plaintext at either Station.

## Concurrency Decision

Serial after CSN-02. CSN-04 and CSN-05 may start in parallel after this closure.

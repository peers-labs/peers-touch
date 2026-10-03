# CSN-01: Canonical Contracts And Ownership

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SOCIAL-CROSS-STATION-NATIVE-20261003","taskId":"CSN-01-contracts","workstreamId":"CSN-W01","title":"Define cross-Station private Social contracts and ownership","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"cross-station-contracts","journeyId":"SOC-SEC-J10-J12","runtimeClass":"source-only","writeSet":["model/domain/social","model/domain/federation/delivery.proto","model/domain/key_exchange/key_exchange.proto"],"readSet":["docs/architecture/social","docs/architecture/federated-social-activity","docs/architecture/secure-content","docs/architecture/federation"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":1,"cleanupSeconds":60},"checks":[{"id":"cross-station-contract-source","command":"make model-gen && git diff --exit-code -- model apps/station/frame/touch/model apps/desktop/src/gen apps/mobile/src/gen && python3 tooling/scripts/acceptance-run.py --gate station-api-ownership","verificationClass":"STRUCTURAL_CHECK"}],"doneWhen":["one generated Social payload family defines resource delivery, invalidation and interaction command/result","Federation delivery only adds typed payload kinds and Key Exchange owns Content PreKey peer requests","Go, Rust, Desktop and Mobile generated outputs have zero drift","the current remote-recipient rejection remains active until CSN-03"],"failureBehavior":["unknown fields or identity aliases fail contract validation","generation drift blocks the task","no runtime behavior is enabled from partially generated contracts"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"STRUCTURAL_CHECK","result":"NOT_RUN","ref":"pending CSN-01 execution"}]}
```

## Current Snapshot

- `private_content.proto` owns same-Station private resource contracts.
- `delivery.proto` has no private Social payload kind.
- Key Exchange has remote Direct/MLS routes but no Content PreKey peer route.
- `ptid` and Home Station locality already exist in Social snapshots.

## Closure

All consumers compile against one generated contract family, ownership tests
pass, and remote behavior remains disabled.

## Concurrency Decision

Serial foundation. CSN-02 is the only direct same-workstream functional
successor.

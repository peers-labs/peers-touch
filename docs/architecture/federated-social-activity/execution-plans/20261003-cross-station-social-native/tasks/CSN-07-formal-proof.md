# CSN-07: Formal Two-Station Proof

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SOCIAL-CROSS-STATION-NATIVE-20261003","taskId":"CSN-07-formal-proof","workstreamId":"CSN-W07","title":"Prove the complete Native Desktop cross-Station Social claim","workClass":"product-behavior","completionClass":"acceptance-aggregate","executionMode":"build","closureId":"cross-station-final-proof","journeyId":"SOC-SEC-J10-J12","runtimeClass":"source-only","writeSet":["tooling/acceptance","tooling/development/secure_content","docs/architecture/social","docs/architecture/federated-social-activity"],"readSet":["apps/station/frame/core/federation","apps/station/app/subserver/key_exchange","apps/station/app/subserver/social","apps/desktop/src-tauri/src/social","apps/desktop/src/services/privateMomentsNative.ts","apps/desktop/src/store/privateMoments.ts","apps/desktop/src/runtimes/momentsRuntime.ts","apps/desktop/src/pages/moments"],"budgets":{"focusedCheckSeconds":3600,"functionalRunSeconds":10800,"cleanupSeconds":300},"checks":[{"id":"cross-station-acceptance-source","command":"python3 tooling/scripts/acceptance-validate.py --domain social && python3 tooling/scripts/acceptance-plan.py --root tooling/acceptance --self-check","verificationClass":"STRUCTURAL_CHECK"},{"id":"social-cross-station-native-e2e","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-native-e2e","verificationClass":"ACCEPTANCE_PROOF"},{"id":"social-cross-station-completion","command":"python3 tooling/scripts/acceptance-validate.py --domain social --require-proven","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["AS17 through AS24 and Browser AS11 are PROVEN","same-Station Desktop Social regression remains PROVEN","all reports bind exact source, runtime, actors, Stations and cleanup","gap detector reports zero blocking Desktop cross-Station gaps","Mobile remains explicitly deferred and unproven"],"failureBehavior":["missing receiver-visible or source/receiver durable evidence remains unproven","matching runtime attestations are reused instead of rebuilt","all clients, tunnels, ports, fixtures and declarations release on every exit"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"STRUCTURAL_CHECK","result":"NOT_RUN","ref":"pending CSN-07 execution"},{"verificationClass":"ACCEPTANCE_PROOF","result":"NOT_RUN","ref":"pending exact-source two-Station run"}]}
```

## Current Snapshot

- Same-Station Desktop Social has 14/14 scenarios and 6/6 Gates proven.
- Historical RC06 proves only that remote recipients were rejected safely.
- No positive cross-Station private Social Gate exists.

## Closure

`SOCIAL_CROSS_STATION_DESKTOP_PROVEN` is backed by exact-source two-Station
Native evidence. Mobile remains deferred; Browser remains prohibited.

## Concurrency Decision

Final serial aggregate after all product-functional tasks.

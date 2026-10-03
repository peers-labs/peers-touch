# CSS-08: Replacement-Device Recovery

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-08-recovery","workstreamId":"CSS-W08","title":"Recover authorized remote history on a replacement Native Desktop","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"slice-recovery","journeyId":"SOC-SEC-AS23","runtimeClass":"native-desktop","writeSet":["apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","tooling/acceptance/gates/social","tooling/development/secure_content"],"readSet":["apps/station/frame/core/federation","apps/station/app/subserver/key_exchange","model/domain/social/private_federation.proto","docs/architecture/secure-content","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":300},"checks":[{"id":"replacement-recovery-source","command":"cd apps/station && go test -race ./app/subserver/social/... -run 'TestFederatedPrivateRecovery' && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml social:: -- recovery","verificationClass":"SOURCE_CHECK"},{"id":"replacement-recovery-functional","command":"python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario replacement-recovery --execution-policy development && python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario delivery-resilience --execution-policy development","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["Bob2 recovers authorized never-opened history after Station restart","retained source proof and recovery envelope verify","wrong phrase, revoked device, expired membership, and invalid proof are denied","all earlier usable slices remain green","one conventional commit records only this usable slice"],"failureBehavior":["missing recovery material remains explicit and retryable where allowed","Station never receives plaintext or recovery secret","revoked content cannot be recovered"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-08"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-08"}]}
```

## Current Snapshot

Remote delivery survives restart after CSS-07, but a replacement device cannot
yet recover never-opened remote history.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): recover cross-station private history`.

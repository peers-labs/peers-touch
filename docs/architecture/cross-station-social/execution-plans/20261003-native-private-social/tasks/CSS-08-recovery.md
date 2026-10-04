# CSS-08: Replacement-Device Recovery

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-08-recovery","workstreamId":"CSS-W-SOURCE","title":"Recover authorized remote history on a replacement Native Desktop","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-recovery","journeyId":"SOC-SEC-AS23","runtimeClass":"source-only","writeSet":["apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","packages/locales","tooling/acceptance/gates/social","tooling/development/secure_content","tooling/scripts/check-social-cross-station-operability.mjs","tooling/scripts/check-social-cross-station-operability.test.mjs"],"readSet":["apps/station/frame/core/federation","apps/station/frame/core/metrics","apps/station/app/subserver/key_exchange","model/domain/social/private_federation.proto","docs/architecture/secure-content","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"replacement-recovery-source","command":"(cd apps/station && go test -race ./app/subserver/social/... -run 'TestFederatedPrivateRecovery') && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml social:: -- recovery && pnpm --dir apps/desktop exec vitest run src/i18n -t 'recovery|device|proof' && node --test tooling/scripts/check-social-cross-station-operability.test.mjs && node tooling/scripts/check-social-cross-station-operability.mjs && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["Bob2 recovers authorized never-opened history after Station restart","retained source proof and recovery envelope verify","wrong phrase, revoked device, expired membership, and invalid proof are denied with typed localized states","recovery/rejection metrics pass the bounded operability checker without exposing proof material or secrets","all earlier usable slices remain green","one conventional commit records only this usable slice"],"failureBehavior":["missing recovery material remains explicit and retryable where allowed","Station never receives plaintext or recovery secret","revoked content cannot be recovered","client replacement is explicit evidence and does not reprovision the two-Station Suite","Native product behavior remains UNPROVEN until the CSS-08A activation and CSS-09 exact-source Suite."],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-08"}]}
```

## Current Snapshot

Remote delivery survives restart after CSS-07, but a replacement device cannot
yet recover never-opened remote history.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): recover cross-station private history`.

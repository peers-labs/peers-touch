# CSS-08: Replacement-Device Recovery

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-08-recovery","workstreamId":"CSS-W-SOURCE","title":"Recover authorized remote history on a replacement Native Desktop","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-recovery","journeyId":"SOC-SEC-AS23","runtimeClass":"source-only","writeSet":["apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","packages/locales","tooling/acceptance/gates/social","tooling/development/secure_content","tooling/scripts/check-social-cross-station-operability.mjs","tooling/scripts/check-social-cross-station-operability.test.mjs"],"readSet":["apps/station/frame/core/federation","apps/station/frame/core/metrics","apps/station/app/subserver/key_exchange","model/domain/social/private_federation.proto","docs/architecture/secure-content","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"replacement-recovery-source","command":"(cd apps/station && test -n \"$(go test ./app/subserver/social/... -list '^TestFederatedPrivateRecovery' | rg '^TestFederatedPrivateRecovery')\" && go test -race ./app/subserver/social/... -run '^TestFederatedPrivateRecovery' -count=1) && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-fail-fast recovery && pnpm --dir apps/desktop exec vitest run src/test/moments-store.test.ts -t 'recovery|device|proof' && node --test tooling/scripts/check-social-cross-station-operability.test.mjs && node tooling/scripts/check-social-cross-station-operability.mjs && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["Bob2 recovers authorized never-opened history after Station restart","retained source proof and recovery envelope verify","wrong phrase, revoked device, expired membership, and invalid proof are denied with typed localized states","recovery/rejection metrics pass the bounded operability checker without exposing proof material or secrets","all earlier usable slices remain green","one conventional commit records only this usable slice"],"failureBehavior":["missing recovery material remains explicit and retryable where allowed","Station never receives plaintext or recovery secret","revoked content cannot be recovered","client replacement is explicit evidence and does not reprovision the two-Station Suite","Native product behavior remains UNPROVEN until the CSS-08A activation and CSS-09 exact-source Suite."],"updatedAt":"2026-10-05T01:43:00+08:00","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"replacement-recovery-source passed on 2026-10-05: Station recovery route/service tests executed under race detection; 25 Desktop Rust recovery tests passed; 2 Moments store recovery tests passed; operability contract passed 9/9 with 71 locale keys, 9 typed errors, 12 metrics, and 177 privacy files. Native product behavior remains UNPROVEN until CSS-08A and CSS-09."}]}
```

## Mechanical Gate Amendment

The original check silently selected zero Go tests and pointed Vitest at a
directory containing no test files. The check now requires at least one
`TestFederatedPrivateRecovery*` entry, runs those tests without cache, selects
the existing Rust recovery suite directly, and executes the Moments store
recovery tests. This changes only evidence precision, not product semantics,
architecture ownership, or proof strength.

## Current Snapshot

Replacement-device recovery source is implemented and source-verified. Native
receiver behavior remains unproven until CSS-08A activation and CSS-09.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): recover cross-station private history`.

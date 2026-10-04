# CSS-02D: Federated Audience Matrix

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-02D-audience-matrix","workstreamId":"CSS-W-SOURCE","title":"Publish one exact mixed local and remote private audience including GROUP","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-audience-matrix","journeyId":"SOC-SEC-AS18","runtimeClass":"source-only","writeSet":["model/domain/key_exchange/key_exchange.proto","tooling/scripts/proto-gen-secure-content.mjs","tooling/scripts/proto-gen-secure-content.test.mjs","docs/architecture/api-ownership/station-api-capabilities.yaml","apps/station/frame/core/auth/federation","apps/station/frame/core/federation","apps/station/app/subserver/federation","apps/station/app/subserver/key_exchange","apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/build.rs","apps/desktop/src-tauri/src/social","apps/mobile/src/gen/proto","apps/mobile/src-tauri/build.rs","packages/messaging-core","packages/locales","tooling/scripts/check-social-cross-station-operability.mjs","tooling/scripts/check-social-cross-station-operability.test.mjs","tooling/acceptance/gates/social","docs/client/desktop/runtime-projections.md","docs/client/common/ui-identity/frontend-component-tree-registry.md"],"readSet":["apps/station/app/subserver/conversation","model/domain/social","apps/station/frame/core/metrics","docs/architecture/secure-content/decisions.md","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":1500,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"audience-matrix-source","command":"node tooling/scripts/proto-gen-secure-content.mjs --check && node --test tooling/scripts/proto-gen-secure-content.test.mjs && (cd apps/station && go test -race ./frame/core/auth/federation/... ./frame/core/federation/... ./app/subserver/federation/... ./app/subserver/key_exchange/... ./app/subserver/social/... -run 'Test.*(FederatedContentPreKey|RemoteContentPreKeyValidation|FederatedAudience|RemoteRecipient|AudienceMatrix)') && go run ./apps/station/app/cmd/station_api_ownership --root . --registry docs/architecture/api-ownership/station-api-capabilities.yaml && pnpm --dir apps/desktop run check && pnpm --dir apps/desktop exec vitest run src/pages/moments src/components/moments/momentsInteraction.contract.test.ts src/services/socialRealtime.test.ts src/runtimes/momentsRuntime.test.ts -t 'audience|group|recipient|relationship candidates' && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml && pnpm --dir apps/mobile build && cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml && cargo test --manifest-path packages/messaging-core/Cargo.toml && node --test tooling/scripts/check-social-cross-station-operability.test.mjs && node tooling/scripts/check-social-cross-station-operability.mjs && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["FRIENDS, FOLLOWERS, CIRCLE, GROUP, CUSTOM_ALLOW, and CUSTOM_DENY(FOLLOWERS) produce one exact deduplicated mixed local/remote recipient set","prepare and submit use the CSS-02C Conversation fence and revalidate active Federation membership before Content PreKey claim or Social commit","every remote claim partition passes the CSS-D10 read-only submit validation contract before local commit while the local partition retains transaction-bound validation","stale endpoint, advanced recovery epoch, inactive Federation, malformed input, missing receipt, and unavailable peer preserve typed terminal-versus-retryable disposition and commit zero Social rows","every eligible remote actor receives one viewer-scoped frame and every local actor retains the existing local path","CUSTOM_DENY(PUBLIC), stale Group snapshot, unresolved identity, cross-Federation member, and actor/slot bounds fail with zero partial rows","typed localized failures and bounded privacy-safe admission metrics pass the Social operability checker","generated Go, Desktop, generated-only Mobile, Desktop Rust, Mobile Rust, and messaging-core consumers compile against the amended contract","one conventional commit records only this usable slice"],"failureBehavior":["remote Group members are never silently removed and Social never copies Conversation membership truth","a changed snapshot or Federation membership rejects the whole publish before commit","remote validation uses deterministic Station order, preserves exact claim replay, and cannot claim a global cross-Station snapshot","the old locality guard is deleted only for verified same-Federation recipients","Browser and Mobile product surfaces remain absent","Native product behavior remains UNPROVEN until CSS-08A and CSS-09 exact-source Suite."],"updatedAt":"2026-10-04T02:00:00.000Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"Development Session CROSS-STATION-SOCIAL-NATIVE-20261003233300 event f4d3887d3a9036db00d1e463e47a8d22676e79f42467b99aba20d0dc42b1e462; pre-amendment source check passed, accepted CSS-D10 implementation and amended source-check rerun remain pending"}]}
```

## Current Snapshot

CSS-02D is source-ready. Mixed local and remote audiences, including Group
recipients, use frozen prepare-time locality. Remote Content PreKey validation
runs before the Social transaction, while local validation remains
transaction-bound. Native product behavior remains `UNPROVEN`.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): support federated private audiences`.

## Concurrency Decision

Execution is hybrid. Separate read-only lanes inspect the Station audience and
delivery path and the Desktop audience/readiness surface. The integrator owns
all writes, tests, Session transitions, plan updates, commit, and Gate work.
Audience expansion, Federation validation, outbox fan-out, receiver validation,
and Desktop exposure remain serial producer-consumer boundaries.

## Mechanical Plan Amendment

The Moments page now consumes the existing Social relationship and Messaging
conversation projections for audience selection. The Desktop runtime contract
and component-tree registry therefore move from read-only references into this
Task's write set so the descriptor and its governing documentation remain in
sync. The focused check names the component and `socialRealtime` tests directly
and adds the Desktop type/runtime boundary check; no product scope or runtime
claim changes.

## Architecture Amendment Gate

Accepted `CSS-D10` defines a distinct read-only Federation peer validation
contract while preserving exact claim replay. The independent review in
`../20261004-remote-prekey-submit-validation-amendment-review-prompt.md`
passed after the Task write set and checks were amended proto-first.

The amended `audience-matrix-source` Gate passed in Development Session
`CROSS-STATION-SOCIAL-NATIVE-20261003233300`, event
`63ae371ff346496d750b2c7c4f22c5bd84018161d9e163b169f071d2cb08227a`.
It proves proto/codegen parity, focused Go race tests, Station API ownership,
Desktop TypeScript and focused Vitest, Desktop and Mobile Rust compilation,
Mobile web compilation, `messaging-core`, Social operability, and diff hygiene.
This is source evidence only; Browser and Mobile product surfaces remain absent.

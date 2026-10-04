# CSS-02D: Federated Audience Matrix

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-02D-audience-matrix","workstreamId":"CSS-W-SOURCE","title":"Publish one exact mixed local and remote private audience including GROUP","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-audience-matrix","journeyId":"SOC-SEC-AS18","runtimeClass":"source-only","writeSet":["apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","packages/locales","tooling/scripts/check-social-cross-station-operability.mjs","tooling/scripts/check-social-cross-station-operability.test.mjs","tooling/acceptance/gates/social"],"readSet":["apps/station/app/subserver/conversation","model/domain/social","model/domain/key_exchange/key_exchange.proto","apps/station/frame/core/federation","apps/station/frame/core/metrics","docs/architecture/secure-content/decisions.md","docs/architecture/cross-station-social","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":1500,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"audience-matrix-source","command":"(cd apps/station && go test -race ./app/subserver/social/... -run 'Test.*(FederatedAudience|RemoteRecipient|AudienceMatrix)') && pnpm --dir apps/desktop exec vitest run src/pages/moments src/runtimes/momentsRuntime.test.ts -t 'audience|group|recipient' && node --test tooling/scripts/check-social-cross-station-operability.test.mjs && node tooling/scripts/check-social-cross-station-operability.mjs && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["FRIENDS, FOLLOWERS, CIRCLE, GROUP, CUSTOM_ALLOW, and CUSTOM_DENY(FOLLOWERS) produce one exact deduplicated mixed local/remote recipient set","prepare and submit use the CSS-02C Conversation fence and revalidate active Federation membership before Content PreKey claim or Social commit","every eligible remote actor receives one viewer-scoped frame and every local actor retains the existing local path","CUSTOM_DENY(PUBLIC), stale Group snapshot, unresolved identity, cross-Federation member, and actor/slot bounds fail with zero partial rows","typed localized failures and bounded privacy-safe admission metrics pass the Social operability checker","one conventional commit records only this usable slice"],"failureBehavior":["remote Group members are never silently removed and Social never copies Conversation membership truth","a changed snapshot or Federation membership rejects the whole publish before commit","the old locality guard is deleted only for verified same-Federation recipients","Browser and Mobile product surfaces remain absent","Native product behavior remains UNPROVEN until the CSS-08A activation and CSS-09 exact-source Suite."],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-02D"}]}
```

## Current Snapshot

CSS-02C establishes the Federation-bound Group authority. The current Social
recipient directory still rejects all remote members before PreKey claim.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): support federated private audiences`.

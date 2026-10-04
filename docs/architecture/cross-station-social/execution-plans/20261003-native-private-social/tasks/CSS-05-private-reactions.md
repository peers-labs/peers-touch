# CSS-05: Private Reactions

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-05-private-reactions","workstreamId":"CSS-W-SOURCE","title":"Converge remote Reaction and unreaction at source Social","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-private-reactions","journeyId":"SOC-SEC-AS20-REACTION","runtimeClass":"source-only","writeSet":["apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","packages/locales","tooling/scripts/check-social-cross-station-operability.mjs","tooling/scripts/check-social-cross-station-operability.test.mjs","tooling/acceptance/gates/social"],"readSet":["apps/station/frame/core/federation","apps/station/frame/core/metrics","model/domain/social/private_federation.proto","docs/architecture/social-runtime/decisions.md","docs/architecture/cross-station-social","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":900,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"private-reaction-source","command":"(cd apps/station && go test -race ./app/subserver/social/... -run 'TestFederatedPrivateReaction') && pnpm --dir apps/desktop exec vitest run src/test/moments-store.test.ts src/runtimes/momentsRuntime.test.ts src/i18n -t 'reaction|eventBus|pending|retry' && node --test tooling/scripts/check-social-cross-station-operability.test.mjs && node tooling/scripts/check-social-cross-station-operability.mjs && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["Reaction and unreaction return to source authority","duplicate command IDs commit once and hash conflicts fail","the typed reaction event reaches the single momentsRuntime owner and updates hidden Alice/Bob projections exactly once","typed localized pending/retry/reject states and bounded replay/rejection metrics pass the operability checker","Alice and Bob converge after reconnect","Comment and media slices remain usable","one conventional commit records only this usable slice"],"failureBehavior":["revoked or deleted parent rejects mutation","unknown outcome remains pending under the same command","duplicate events cannot duplicate the visible reaction projection","no receiver-local canonical Reaction row exists and no metric label contains actor or resource identity","Native product behavior remains UNPROVEN until the CSS-08A activation and CSS-09 exact-source Suite."],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-05"}]}
```

## Current Snapshot

Remote Comments work after CSS-04; Reaction still has no source-authority
cross-Station command/result path.

## Timebox And Checkpoint

Agent timebox: 2 hours. Commit:
`feat(social): support cross-station private reactions`.

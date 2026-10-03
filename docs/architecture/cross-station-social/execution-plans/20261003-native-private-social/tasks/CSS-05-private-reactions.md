# CSS-05: Private Reactions

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-05-private-reactions","workstreamId":"CSS-W05","title":"Converge remote Reaction and unreaction at source Social","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"slice-private-reactions","journeyId":"SOC-SEC-AS20-REACTION","runtimeClass":"native-desktop","writeSet":["apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","tooling/acceptance/gates/social"],"readSet":["apps/station/frame/core/federation","model/domain/social/private_federation.proto","docs/architecture/social-runtime/decisions.md","docs/architecture/cross-station-social","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":900,"functionalRunSeconds":1200,"cleanupSeconds":300},"checks":[{"id":"private-reaction-source","command":"cd apps/station && go test -race ./app/subserver/social/... -run 'TestFederatedPrivateReaction' && cd ../.. && pnpm --dir apps/desktop exec vitest run src/test/moments-store.test.ts src/runtimes/momentsRuntime.test.ts -t 'reaction|eventBus'","verificationClass":"SOURCE_CHECK"},{"id":"private-reaction-functional","command":"python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario private-reaction --execution-policy development && python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario private-comment --execution-policy development","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["Reaction and unreaction return to source authority","duplicate command IDs commit once and hash conflicts fail","the typed reaction event reaches the single momentsRuntime owner and updates hidden Alice/Bob projections exactly once","Alice and Bob converge after reconnect","Comment and media slices remain usable","one conventional commit records only this usable slice"],"failureBehavior":["revoked or deleted parent rejects mutation","unknown outcome remains pending under the same command","duplicate events cannot duplicate the visible reaction projection","no receiver-local canonical Reaction row exists"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-05"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-05"}]}
```

## Current Snapshot

Remote Comments work after CSS-04; Reaction still has no source-authority
cross-Station command/result path.

## Timebox And Checkpoint

Agent timebox: 2 hours. Commit:
`feat(social): support cross-station private reactions`.

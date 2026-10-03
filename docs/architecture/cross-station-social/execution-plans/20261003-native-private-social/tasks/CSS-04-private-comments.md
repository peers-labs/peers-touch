# CSS-04: Private Comments

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-04-private-comments","workstreamId":"CSS-W04","title":"Prepare and submit one remote private Comment through source Social","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"slice-private-comments","journeyId":"SOC-SEC-AS20-COMMENT","runtimeClass":"native-desktop","writeSet":["apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","tooling/acceptance/gates/social"],"readSet":["apps/station/frame/core/federation","model/domain/social/private_federation.proto","docs/architecture/social-runtime/decisions.md","docs/architecture/cross-station-social","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":300},"checks":[{"id":"private-comment-source","command":"cd apps/station && go test -race ./app/subserver/social/... -run 'TestFederatedPrivateComment' && cd ../.. && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml social:: -- private_comment && pnpm --dir apps/desktop exec vitest run src/runtimes/momentsRuntime.test.ts -t 'comment|eventBus'","verificationClass":"SOURCE_CHECK"},{"id":"private-comment-functional","command":"python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario private-comment --execution-policy development && python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario private-media --execution-policy development","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["remote prepare and submit both return to source Social","Bob's comment draft survives timeout or unknown result","source parent authorization commits one Comment","the committed Comment emits one typed event and the single momentsRuntime owner refreshes Alice and Bob while detail is hidden","Alice and Bob converge without exposing comment plaintext to either Station","one conventional commit records only this usable slice"],"failureBehavior":["delete, revoke, invalid payload, rate limit, or pre-admission cancel writes no Comment","retry reuses one command identity and duplicate events produce one projection effect","no page refresh, direct Tauri listener, or second runtime owner substitutes for EventBus consumption","recipient Station never becomes Comment authority"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-04"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-04"}]}
```

## Current Snapshot

Remote Post and media are usable, but private Comment prepare/submit remains a
same-Station path.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): support cross-station private comments`.

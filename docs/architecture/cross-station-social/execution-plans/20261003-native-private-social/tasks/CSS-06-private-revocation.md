# CSS-06: Private Revocation

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-06-private-revocation","workstreamId":"CSS-W06","title":"Revoke remote private resources without resurrection","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"slice-private-revocation","journeyId":"SOC-SEC-AS22","runtimeClass":"native-desktop","writeSet":["apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","tooling/acceptance/gates/social"],"readSet":["apps/station/frame/core/federation","model/domain/social/private_federation.proto","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":300},"checks":[{"id":"private-revocation-source","command":"cd apps/station && go test -race ./app/subserver/social/... -run 'TestFederatedPrivate(Invalidation|Tombstone)' && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml social:: -- revoke","verificationClass":"SOURCE_CHECK"},{"id":"private-revocation-functional","command":"python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario private-revocation --execution-policy development && python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario private-reaction --execution-policy development","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["delete, friendship loss, and either-direction block revoke future access","recipient-local block suppresses immediately","source invalidation advances a monotonic tombstone","stale delivery cannot resurrect content","one conventional commit records only this usable slice"],"failureBehavior":["feed/detail/comment/media/recovery share the same denial","lost invalidation remains repairable by reconcile","no result claims deletion of recipient-controlled plaintext copies"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-06"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-06"}]}
```

## Current Snapshot

Remote Post, media, Comment, and Reaction work, but receiver projections have
no source-revision tombstone.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): revoke cross-station private resources`.

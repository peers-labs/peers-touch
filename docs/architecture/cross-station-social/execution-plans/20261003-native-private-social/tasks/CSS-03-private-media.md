# CSS-03: Private Media

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-03-private-media","workstreamId":"CSS-W03","title":"Open remote private image and video through source-authorized ciphertext streaming","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"slice-private-media","journeyId":"SOC-SEC-AS17-MEDIA","runtimeClass":"native-desktop","writeSet":["apps/station/frame/core/federation","apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","tooling/acceptance/gates/social"],"readSet":["model/domain/social/private_federation.proto","model/domain/secure_content/object.proto","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":300},"checks":[{"id":"private-media-source","command":"cd apps/station && go test -race ./frame/core/federation/... ./app/subserver/social/... -run 'TestFederatedPrivateObject' && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml social:: -- private_media","verificationClass":"SOURCE_CHECK"},{"id":"private-media-functional","command":"python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario private-media --execution-policy development && python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario private-text --execution-policy development","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["Bob opens one image and one video from Station B","ciphertext ranges are source-authorized and descriptor-verified","wrong actor/device/object/range is denied","text-only cross-Station publish remains usable","one conventional commit records only this usable slice"],"failureBehavior":["object bytes never enter durable Federation frames","no public URL or direct client-to-remote fallback exists","interrupted downloads are retryable without changing object identity"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-03"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-03"}]}
```

## Current Snapshot

CSS-02 provides remote text projection; large encrypted objects still have no
Social-owned peer stream.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): stream cross-station private media`.

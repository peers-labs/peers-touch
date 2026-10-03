# CSS-03: Private Media

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-03-private-media","workstreamId":"CSS-W-SOURCE","title":"Open remote private image and video through source-authorized ciphertext streaming","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-private-media","journeyId":"SOC-SEC-AS17-MEDIA","runtimeClass":"source-only","writeSet":["docs/architecture/api-ownership/station-api-capabilities.yaml","apps/station/frame/core/federation","apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","packages/locales","tooling/scripts/check-social-cross-station-operability.mjs","tooling/scripts/check-social-cross-station-operability.test.mjs","tooling/acceptance/gates/social"],"readSet":["model/domain/social/private_federation.proto","model/domain/secure_content/object.proto","apps/station/frame/core/metrics","docs/architecture/api-ownership","docs/architecture/cross-station-social"],"budgets":{"focusedCheckSeconds":1500,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"private-media-source","command":"(cd apps/station && go test -race ./frame/core/federation/... ./app/subserver/social/... -run 'TestFederatedPrivateObject') && go run ./apps/station/app/cmd/station_api_ownership --root . --registry docs/architecture/api-ownership/station-api-capabilities.yaml && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml social:: -- private_media && pnpm --dir apps/desktop exec vitest run src/i18n src/pages/moments -t 'media|object|source unavailable' && node --test tooling/scripts/check-social-cross-station-operability.test.mjs && node tooling/scripts/check-social-cross-station-operability.mjs && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["Bob opens one image and one video from Station B","the source-authorized ciphertext peer stream has one registered API owner and no alias","ciphertext ranges are descriptor-verified; wrong actor/device/object/range is denied with typed localized state","stream latency, rejection, interruption, and retry metrics use bounded labels and preserve trace identity","text-only cross-Station publish remains usable","one conventional commit records only this usable slice"],"failureBehavior":["object bytes never enter durable Federation frames","no public URL or direct client-to-remote fallback exists","interrupted downloads are retryable without changing object identity","an unregistered route or logs/metrics containing private payload, keys, actor list, or object bytes blocks the commit","Native product behavior remains UNPROVEN until the CSS-08A activation and CSS-09 exact-source Suite."],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-03"}]}
```

## Current Snapshot

CSS-02 provides remote text projection; large encrypted objects still have no
Social-owned peer stream.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): stream cross-station private media`.

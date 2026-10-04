# CSS-07: Delivery Resilience

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-07-delivery-resilience","workstreamId":"CSS-W-SOURCE","title":"Recover private Social delivery after outage and restart","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-delivery-resilience","journeyId":"SOC-SEC-AS21-AS24","runtimeClass":"source-only","writeSet":["apps/station/frame/core/federation","apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","packages/locales","tooling/acceptance/gates/social","tooling/development/secure_content","tooling/scripts/check-social-cross-station-operability.mjs","tooling/scripts/check-social-cross-station-operability.test.mjs"],"readSet":["model/domain/social/private_federation.proto","apps/station/frame/core/metrics","docs/architecture/social-runtime/decisions.md","docs/architecture/cross-station-social","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"delivery-resilience-source","command":"(cd apps/station && go test -race ./frame/core/federation/... ./app/subserver/social/... -run 'TestFederatedPrivate(Replay|Restart|Reconcile|Conflict)') && pnpm --dir apps/desktop exec vitest run src/acceptance/moments/crossStation.test.ts src/runtimes/momentsRuntime.test.ts src/i18n -t 'retry|restart|pending|resync|duplicate' && node --test tooling/scripts/check-social-cross-station-operability.test.mjs && node tooling/scripts/check-social-cross-station-operability.mjs && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["source commit survives receiver outage","one durable identity retries across dispatcher and Station restart","Desktop shows localized pending/retrying/source-unavailable states then converges","missed EventBus delivery is repaired by Station-backed reconcile without opening Moments","duplicate, reorder, hash conflict, expiry, wrong target/signature, and receiver crash produce typed dispositions with no duplicate or partial state","retry/replay/reject/resync counts and latency pass the bounded operability checker and are trace-correlated","logout and Actor/Station switch remove old subscriptions and projection scope","one conventional commit records only this usable slice"],"failureBehavior":["terminal reject or expiry is visible","fixed polling or page remount cannot replace typed wake plus periodic reconcile","verified offline content may remain readable but new operations fail explicitly","logs and metrics contain no payload, key, actor list, or unbounded identity label","all temporary processes and leases are released","Native product behavior remains UNPROVEN until the CSS-08A activation and CSS-09 exact-source Suite."],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-07"}]}
```

## Current Snapshot

Normal delivery and revocation work after CSS-06; outage/restart and exact
reconcile are not yet a product-supported path.

## Timebox And Checkpoint

Agent timebox: 4 hours. Commit:
`feat(social): recover cross-station delivery after outages`.

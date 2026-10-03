# CSS-07: Delivery Resilience

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-07-delivery-resilience","workstreamId":"CSS-W07","title":"Recover private Social delivery after outage and restart","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"slice-delivery-resilience","journeyId":"SOC-SEC-AS21-AS24","runtimeClass":"native-desktop","writeSet":["apps/station/frame/core/federation","apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","tooling/acceptance/gates/social","tooling/development/secure_content"],"readSet":["model/domain/social/private_federation.proto","docs/architecture/social-runtime/decisions.md","docs/architecture/cross-station-social","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":2400,"cleanupSeconds":300},"checks":[{"id":"delivery-resilience-source","command":"cd apps/station && go test -race ./frame/core/federation/... ./app/subserver/social/... -run 'TestFederatedPrivate(Replay|Restart|Reconcile|Conflict)' && cd ../.. && pnpm --dir apps/desktop exec vitest run src/acceptance/moments/crossStation.test.ts src/runtimes/momentsRuntime.test.ts -t 'retry|restart|pending|resync|duplicate'","verificationClass":"SOURCE_CHECK"},{"id":"delivery-resilience-functional","command":"python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario delivery-resilience --execution-policy development && python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario private-revocation --execution-policy development","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["source commit survives receiver outage","one durable identity retries across dispatcher and Station restart","Desktop shows pending/retrying/source-unavailable then converges","missed EventBus delivery is repaired by Station-backed reconcile without opening Moments","duplicate, reorder, hash conflict, and crash write no duplicate or partial state","logout and Actor/Station switch remove old subscriptions and projection scope","one conventional commit records only this usable slice"],"failureBehavior":["terminal reject or expiry is visible","fixed polling or page remount cannot replace typed wake plus periodic reconcile","verified offline content may remain readable but new operations fail explicitly","all temporary processes and leases are released"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-07"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-07"}]}
```

## Current Snapshot

Normal delivery and revocation work after CSS-06; outage/restart and exact
reconcile are not yet a product-supported path.

## Timebox And Checkpoint

Agent timebox: 4 hours. Commit:
`feat(social): recover cross-station delivery after outages`.

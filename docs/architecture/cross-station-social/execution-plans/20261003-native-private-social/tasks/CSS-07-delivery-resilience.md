# CSS-07: Delivery Resilience

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-07-delivery-resilience","workstreamId":"CSS-W-SOURCE","title":"Recover private Social delivery after outage and restart","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-delivery-resilience","journeyId":"SOC-SEC-AS21-AS24","runtimeClass":"source-only","writeSet":["model/domain/federation/delivery.proto","model/domain/social/private_content.proto","model/domain/social/private_federation.proto","tooling/scripts/proto-gen-secure-content.mjs","tooling/scripts/proto-gen-secure-content.test.mjs","docs/architecture/api-ownership/station-api-capabilities.yaml","docs/architecture/cross-station-social/data-model.md","docs/architecture/cross-station-social/integration.md","apps/station/frame/core/federation","apps/station/frame/touch/model/privatecontent","apps/station/app/subserver/events","apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/build.rs","apps/desktop/src-tauri/src/secure_content/adapter.rs","apps/desktop/src-tauri/src/social","apps/mobile/src/gen/proto","apps/mobile/src-tauri/build.rs","packages/locales","tooling/acceptance/gates/social","tooling/development/secure_content","tooling/scripts/check-social-cross-station-operability.mjs","tooling/scripts/check-social-cross-station-operability.test.mjs"],"readSet":["apps/station/frame/core/metrics","docs/architecture/social-runtime/decisions.md","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"delivery-resilience-source","command":"node tooling/scripts/proto-gen-secure-content.mjs --check && node --test tooling/scripts/proto-gen-secure-content.test.mjs && go run ./apps/station/app/cmd/station_api_ownership --root . --registry docs/architecture/api-ownership/station-api-capabilities.yaml && (cd apps/station && go test -race ./frame/core/federation/... ./app/subserver/events/... ./app/subserver/social/...) && pnpm --dir apps/desktop run check && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml social:: --no-fail-fast && pnpm --dir apps/desktop exec vitest run src/acceptance/moments/crossStation.test.ts src/runtimes/momentsRuntime.test.ts src/test/moments-store.test.ts src/i18n && pnpm --dir apps/mobile build && cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml && node --test tooling/scripts/check-social-cross-station-operability.test.mjs && node tooling/scripts/check-social-cross-station-operability.mjs && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["source commit survives receiver outage","one durable identity retries across dispatcher and Station restart","Desktop shows localized pending/retrying/source-unavailable states then converges","missed EventBus delivery is repaired by Station-backed reconcile without opening Moments","duplicate, reorder, hash conflict, expiry, wrong target/signature, and receiver crash produce typed dispositions with no duplicate or partial state","retry/replay/reject/resync counts and latency pass the bounded operability checker and are trace-correlated","logout and Actor/Station switch remove old subscriptions and projection scope","one conventional commit records only this usable slice"],"failureBehavior":["terminal reject or expiry is visible","fixed polling or page remount cannot replace typed wake plus periodic reconcile","verified offline content may remain readable but new operations fail explicitly","logs and metrics contain no payload, key, actor list, or unbounded identity label","all temporary processes and leases are released","Native product behavior remains UNPROVEN until the CSS-08A activation and CSS-09 exact-source Suite."],"updatedAt":"2026-10-04T17:20:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"CSS-07 exact Source Gate command passed on 2026-10-04: proto parity 18/18, Station API ownership 85 capabilities with 0 diagnostics, Federation/Events/Social Go race suites, Desktop TypeScript, Desktop Rust Social 63/63, Desktop Vitest 71/71, Mobile build and cargo check, operability 9/9 with 177 privacy files, and git diff hygiene. Acceptance gap detector correctly keeps Native behavior UNPROVEN until CSS-08A activation and CSS-09 exact-source Suite."}]}
```

## Concurrency Decision

Execution is hybrid. Read-only Station, Desktop, operability, and stream-contract
inventories ran in parallel. The integrator owns all writes, shared proto and
generated outputs, API registry changes, plan/session transitions, commits,
runtime resources, and final Gates. The wire contract, Station status/reconcile
readback, Rust projection, TypeScript runtime/UI, and operability checks remain
serial producer-consumer boundaries.

## Mechanical Plan Amendment

The accepted product state model and `CSS-D02`, `CSS-D03`, `AAR-C05`, and
`AAR-C09` already require source-authoritative remote delivery state,
Station-backed missed-event reconcile, generated consumer parity, typed wake
integration, and bounded delivery observability. The original Task inventory
listed its Social proto as read-only and omitted generated consumers, route
registry, Events wiring, and platform compile checks. Those paths and checks
move into the write set without changing product semantics, architecture
ownership, runtime class, or proof strength.

## Current Snapshot

Normal delivery and revocation work after CSS-06; outage/restart and exact
reconcile are not yet a product-supported path.

## Timebox And Checkpoint

Agent timebox: 4 hours. Commit:
`feat(social): recover cross-station delivery after outages`.

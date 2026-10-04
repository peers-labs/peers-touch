# CSS-02B: One-To-One Private Text

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-02B-private-text","workstreamId":"CSS-W-SOURCE","title":"Deliver one remote FRIENDS text Post end to end","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-private-text","journeyId":"SOC-SEC-AS17-TEXT","runtimeClass":"source-only","writeSet":["model/domain/social/private_content.proto","model/domain/social/private_federation.proto","model/domain/federation/delivery.proto","tooling/scripts/proto-gen-secure-content.mjs","tooling/scripts/proto-gen-secure-content.test.mjs","tooling/scripts/check-social-cross-station-operability.mjs","tooling/scripts/check-social-cross-station-operability.test.mjs","apps/station/frame/core/auth/federation","apps/station/frame/core/federation","apps/station/frame/touch/model/privatecontent","apps/station/app/subserver/events","apps/station/app/subserver/federation","apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/build.rs","apps/desktop/src-tauri/src/infrastructure","apps/desktop/src-tauri/src/interface/tauri_commands/realtime.rs","apps/desktop/src-tauri/src/social","apps/mobile/src/gen/proto","apps/mobile/src-tauri/build.rs","packages/locales","tooling/acceptance/gates/social"],"readSet":["model/domain/secure_content","model/domain/key_exchange/key_exchange.proto","apps/station/app/subserver/key_exchange","apps/station/frame/core/metrics","docs/architecture/social-runtime/decisions.md","docs/architecture/cross-station-social","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"private-text-source","command":"node tooling/scripts/proto-gen-secure-content.mjs --check && node --test tooling/scripts/proto-gen-secure-content.test.mjs && (cd apps/station && go test -race ./frame/core/auth/federation/... ./frame/core/federation/... ./app/subserver/events/... ./app/subserver/federation/application/... ./app/subserver/social/...) && pnpm --dir apps/desktop run check && pnpm --dir apps/desktop exec vitest run src/services/eventStream.test.ts src/services/socialRealtime.test.ts src/runtimes/momentsRuntime.test.ts && (cd apps/desktop/src-tauri && cargo test social:: --no-fail-fast && cargo test infrastructure::event_stream::tests --no-fail-fast) && pnpm --dir apps/mobile build && (cd apps/mobile/src-tauri && cargo check) && node --test tooling/scripts/check-social-cross-station-operability.test.mjs && node tooling/scripts/check-social-cross-station-operability.mjs && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["canonical resource wire, delivery kind, generated bindings, source UOW, receiver projection, typed errors, metrics, and Desktop projection compile together","one remote FRIENDS recipient receives one viewer-scoped ciphertext projection from the same transaction as the canonical Post and outbox frame","the committed remote Post emits one typed Social event through the Desktop kernel EventBus and the single momentsRuntime owner updates Bob while Moments is unopened or hidden","Bob reads exact text from Station B while neither Station stores plaintext and Eve is denied","locale/error/metric parity passes the deterministic Social operability checker","one conventional commit records only this usable slice"],"failureBehavior":["source-UOW or receiver-UOW failpoints leave no partial Post/outbox/inbox/projection state","duplicate delivery is idempotent, and a same-identity hash conflict is terminal without a second event effect","a page refresh, private Tauri listener, or second runtime owner cannot substitute for the canonical EventBus path","unsupported audience shapes or operability drift retain typed failure and block the commit","Native product behavior remains UNPROVEN until the CSS-08A activation and CSS-09 exact-source Suite."],"updatedAt":"2026-10-03T22:41:21Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"private-text-source: generated parity 17/17; Go race including Federation membership classification and Social receiver UOW PASS; Desktop type/runtime checks and 24 focused Vitest cases PASS; Rust Social and 4 EventStream tests PASS; Mobile build/check PASS; operability 5/5; diff validation PASS"}]}
```

## Current Snapshot

CSS-02A proves remote recipient and one-time-key readiness, but no remote
Social resource is durably committed or projected.

## Timebox And Checkpoint

Agent timebox: 3 hours. Commit:
`feat(social): deliver cross-station private text posts`.

## Concurrency Decision

Execution is hybrid. Three read-only lanes inspect the Station delivery path,
wire/storage contracts, and Desktop projection path in parallel. The integrator
owns every write, generated artifact, Session transition, plan update, commit,
and Gate. `CSS-02B-private-text` remains the only dependency-ready Task, and its
proto generation, source/receiver UOWs, and Desktop consumer are ordered
producer-consumer boundaries, so writer lanes stay serial through reconciliation.

## Mechanical Plan Amendment

Independent review found six source-owned prerequisites already required by
the accepted architecture but omitted from the original Task write set:

- `model/domain/social/private_content.proto` for the receiver-verified
  historical author signing-key projection;
- `apps/station/frame/core/auth/federation/` for the append-only imported
  Station proof-key history used by receiver point reads;
- `apps/station/app/subserver/events/` for committing the durable Moment wake
  in the receiver UOW before post-commit live fan-out;
- `apps/station/app/subserver/federation/` for distinguishing deterministic
  inactive-membership rejection from retryable membership-store failure;
- `apps/desktop/src-tauri/src/infrastructure/event_stream/` for carrying the
  authenticated stream actor and captured Station scope into the typed
  EventBus, with `local_scope.rs` deriving the matching cursor namespace;
- `apps/desktop/src-tauri/src/interface/tauri_commands/realtime.rs` for
  preserving that scope across the Tauri command boundary.

These additions do not change topology, ownership, user-visible behavior, or
the CSS-02B completion contract. The focused source check also includes the
Events package and focused Desktop Rust Social/event-stream tests.

```text
node tooling/scripts/proto-gen-secure-content.mjs --check
node --test tooling/scripts/proto-gen-secure-content.test.mjs
(cd apps/station && go test -race ./frame/core/auth/federation/... ./frame/core/federation/... ./app/subserver/events/... ./app/subserver/federation/application/... ./app/subserver/social/...)
pnpm --dir apps/desktop run check
pnpm --dir apps/desktop exec vitest run src/services/eventStream.test.ts src/services/socialRealtime.test.ts src/runtimes/momentsRuntime.test.ts
(cd apps/desktop/src-tauri && cargo test social:: --no-fail-fast && cargo test infrastructure::event_stream::tests --no-fail-fast)
pnpm --dir apps/mobile build
(cd apps/mobile/src-tauri && cargo check)
node --test tooling/scripts/check-social-cross-station-operability.test.mjs
node tooling/scripts/check-social-cross-station-operability.mjs
git diff --check
```

## Defect Closure

The receiver now distinguishes deterministic inactive Federation membership
from transient membership-store failure. Inactive pairs remain terminal;
dependency failures return retryable and roll back inbox, projection, envelope,
and event writes. Federation owner and Social receiver regression tests cover
both branches. Growth decision: `no_growth_needed`; the typed owner contract
and consumer regression directly fence this isolated classification defect.

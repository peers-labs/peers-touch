# MP-W09: Portable Rust Messaging Core — Execution Plan

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-08-11 | **Updated**: 2026-09-04
> **Owner**: Messaging Platform Team
> Accepted architecture: MP-D16 (2026-08-09)
> Module layout: `docs/architecture/domains/chat/messaging/module-layout.md`
> Parent plan: `20260808-messaging-platform.md`

> **Authority note**: this plan remains active only for the internal
> Desktop/Mobile Device Messaging Engine and portable core. Conversation is the
> sole Chat entry point; Station API ownership is governed by the approved
> [`../../../../engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md`](../../../../engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md).

## 1. Objective

Extract the Desktop Messaging Engine (20K LOC, 27 files) into `packages/messaging-core/` as a platform-agnostic Rust crate. Desktop and Mobile both depend on this single crate via platform adapters. Mobile Sender Keys is deleted in the same closure.

## 2. Constraints (from MP-D16)

- Core contains NO Tauri, NO reqwest, NO platform path, NO UI type, NO Keychain API.
- Adapters contain NO ratchet/OpenMLS algorithm, NO queue FSM, NO recovery codec, NO duplicated SQL schema.
- No re-export shim, no feature flag dual-run, no platform-private crypto fork.
- Desktop and Mobile must pass the same protocol/transaction test suite against Core.

## 3. Dependency Order

```
Phase 1: Ports + Contracts (leaf dependencies)
Phase 2: Core modules (engine internals)
Dependency gate: MP-W12 Desktop interaction semantics + G15/G16
Phase 3: Desktop adapter (thin bridge)
Phase 4: Mobile adapter (thin bridge + Sender Keys deletion)
Phase 5: Verification closure
```

## 4. Phases

### Phase 1: Ports + Contracts Crate Skeleton — ✅ COMPLETE (2026-08-11)

**Deliverable**: `packages/messaging-core/Cargo.toml` + `src/lib.rs` + `src/ports/` + `src/contracts/`

Steps:
1. Create `packages/messaging-core/` with workspace member registration.
2. Define port traits (no implementation):
   - `EncryptedStore` — transaction, query, migration
   - `AttachmentBlob` — stage, read, cache path
   - `AttachmentTransfer` — upload chunk, download range, admission
   - `KeyMaterial` — identity key, signing key, secure random
   - `QueueTransport` — drain, ack, send envelope
   - `Clock` — now_unix_ms, monotonic
   - `ProjectionSink` — emit projection-changed event
3. Define contract types (re-exported from proto or defined as Rust types):
   - `CryptoEndpoint`, `ConversationId`, `MessageId`, `AttachmentId`
   - `EngineConfig`, `DrainProgress`, `SendIntent`, `MessageProjection`
4. Gate: `cargo check -p messaging-core` passes.

### Phase 2: Core Module Extraction — IN PROGRESS

**Deliverable**: All protocol logic moved from `apps/desktop/src-tauri/src/messaging/` into `packages/messaging-core/src/`

**Progress (2026-08-19)**:
- ✅ Proto generation (`build.rs`, 20 chat + 1 common .proto files — full coverage)
- ✅ `codec/private_content` + `codec/attachment_validation` + `codec/verification`
- ✅ `identity/keys` + `identity/enrollment`
- ✅ `inbox/drain` (queue FSM)
- ✅ `inbox/conversation_state` (ConversationStateProcessor<R> — generic over MessagingRepository)
- ✅ `inbox/receipt` (DeliveryReceiptProcessor<R> — delivery + actor read cursor)
- ✅ `inbox/public_event` (PublicEventProcessor<R> — message committed, edit, retract, reaction, pin)
- ✅ `inbox/direct` (DirectMessageProcessor<R> — full validation, DR decrypt, session establishment, commit)
- ✅ `inbox/consumer` (MessagingItemConsumer<R, M> — generic dispatcher, MlsItemConsumer port trait)
- ✅ `outbox/dispatch` (command outbox worker)
- ✅ `outbox/send` (encrypt_direct_fan_out — portable Direct encryption fan-out)
- ✅ `recovery/codec` (AES-GCM sectioned archive with KDF port)
- ✅ `store/repository` trait (MessagingRepository — queue, conversation, events, receipts, direct sessions, prekeys)
- ✅ `contracts/` (all domain types including DirectMessageContent, DirectReceiveCommit, DirectEditCommit)
- ✅ `crypto/double_ratchet` (full Signal DR: X25519 DH, HKDF-SHA256, AES-256-GCM — 8 tests)
- ✅ `crypto/identity` (IdentityKeyPair, X25519KeyPair, DeviceSigningKey — 14 tests)
- ✅ `crypto/x3dh` (sender + receiver X3DH key agreement — 3 tests)
- ✅ `crypto/session` (DirectSession, DirectSessionKey, establish_receiver_session — 5 tests)
- ✅ `ports/mls_crypto` contract
- ✅ Concrete OpenMLS provider, actor/device signing identity, and
  `MlsGroupManager` moved from Desktop into `packages/messaging-core/src/mls/`;
  Desktop imports Core directly and no longer owns those modules
- ✅ Group genesis and membership-transition preparation/validation moved into
  Core behind `MlsTransitionRepository`; Desktop retains only Station HTTP
  preparation transport and SQLCipher persistence
- ✅ MLS application/transition receive, sender-marker, and retirement
  processors moved into Core behind `MlsInboundRepository`; all seven original
  Desktop behavior tests moved with them
- ✅ KeyPackage generation/publication/retry and provider-pool rollback moved
  into Core behind `MlsKeyPackageRepository` and `MlsKeyPackageTransport`;
  Desktop retains only Station HTTP upload and SQLCipher persistence
- ✅ Group send/edit preparation moved into Core behind
  `MlsOutboundRepository`, preserving exact command bytes and
  durable-commit-before-live-state installation
- ✅ MLS startup restoration moved behind `MlsStartupRepository`; Desktop now
  restores accepted sessions, pending join providers, and every durable pending
  transition before constructing the queue consumer
- ✅ Signed leave-intent construction, deterministic signing, validation, and
  Station transport moved behind Core and Messaging Engine APIs; delegated
  `LEAVE` preparation now binds the exact intent, authority epochs, target
  actor, and removed endpoint set before mutating OpenMLS state
- ✅ Desktop production leave callers now use
  `messaging_submit_leave_intent`, `messaging_list_leave_intents`, and
  `messaging_commit_authorized_leave`; the superseded
  `mls_submit_leave_intent` and `mls_list_leave_intents` commands,
  registrations, and gateway routes were deleted
- ✅ Desktop production and pressure-harness group send/read paths now use
  `messaging_send_message` and Messaging Engine projections; the frontend raw
  decrypt/save path and its plaintext decrypt cache were deleted
- ✅ Terminally rejected and stale MLS commands now atomically remove their
  durable pending transition, and the Engine discards the exact matching live
  prepared transition so rejected state cannot be rehydrated after restart
- ✅ Legacy MLS unit coverage now lives in Core, and the three-Station E2E uses
  only canonical `messaging_*` commands and Engine projections
- ✅ The Desktop raw MLS service, Tauri commands, HTTP gateway routes, global
  signer/manager state, generic browser-side command proposal ledger, and
  `crypto_mls_*` storage owner are deleted; existing profiles transactionally
  drop the ten retired tables
- ✅ Desktop social projection reads typed active members from the Engine and
  tracks queued group creation by durable command ID until projection
- ✅ Proto unification complete (Phase 3 prerequisite resolved 2026-08-19):
  - Core owns all chat + common protos; Desktop re-exports via `messaging_core::proto::*`
  - Desktop `build.rs` uses `extern_path` to map proto packages to Core's types
  - Both `cargo check -p messaging-core` and `cargo check` (Desktop) pass
- ✅ The canonical Messaging SQLCipher schema and column-migration manifest now
  live in `packages/messaging-core/src/store/schema.rs`; Desktop and Mobile
  execute the same Core-owned migration without aligning their `rusqlite`
  dependency versions. Legacy Mobile cursor, prekey, and attachment rows are
  migrated before their temporary tables are removed.
- ✅ Direct send/edit validation, endpoint resolution, fan-out encryption,
  exact command construction, and persistence contracts now live behind
  `DirectOutboundPreparer` and `DirectOutboundRepository` in Core. Desktop and
  Mobile adapters revalidate the authority head and compare the exact
  pre-advance ratchet state inside the persistence transaction.
- ✅ The superseded Desktop raw Direct command/persistence owner is deleted
  from `interface/tauri_commands/crypto.rs`,
  `infrastructure/local_chat_store.rs`, Tauri registration, HTTP dispatch, and
  the frontend service wrapper. Existing profiles apply idempotent table-drop
  migrations while Messaging Engine storage remains the sole Direct owner.
  Live three-Station E2E remains `UNPROVEN` until isolated Stations are
  available.
- Focused evidence: `cargo test --manifest-path
  packages/messaging-core/Cargo.toml` passes 104 unit plus 2 integration tests;
  Desktop `cargo check --lib` and `cargo test --lib` pass with 24 tests,
  focused Desktop service/source-contract tests pass 35 tests, and the complete
  Mobile Rust suite passes 66 tests. The three-Station E2E compiles and is
  skipped without
  `PT_C6_MLS_E2E`. The Desktop binary remains blocked by unrelated baseline
  compilation errors, but its diagnostic build reports no error in the
  Messaging Core cutover paths.
- Gate: current Core tests and `cargo check` pass on both adapters.

Module mapping:
| Desktop source | Core destination |
|---|---|
| `direct.rs`, `direct_session.rs`, `prekeys.rs` | `src/direct/` |
| `mls.rs`, `mls_key_packages.rs`, `mls_sender.rs`, `mls_retirement.rs`, `group_genesis.rs`, `membership_transition.rs` | `src/mls/` |
| `inbox.rs`, `drain.rs`, `consumer.rs` | `src/inbox/` |
| `command_outbox.rs`, `send.rs` | `src/outbox/` |
| `store.rs` (schema + queries) | `src/store/` |
| `engine.rs`, `conversation_state.rs` | `src/engine/` |
| `recovery.rs` | `src/recovery/` |
| `attachment.rs`, `attachment_transfer.rs` | `src/attachment/` |
| `private_content.rs`, `verification.rs` | `src/codec/` |
| `public_event.rs` | `src/projection/` |
| `identity.rs` | `src/identity/` |
| `transport.rs` | stays in adapter (uses reqwest) |
| `lifecycle.rs` | stays in adapter (uses Tauri window/state) |

Steps:
1. Move files one module at a time, replacing concrete types with port traits.
2. Each move: replace `use crate::` with `use crate::ports::` or internal paths.
3. Transport calls become trait method calls on `&dyn QueueTransport`.
4. SQLCipher calls become trait method calls on `&dyn EncryptedStore`.
5. Gate per module: `cargo check -p messaging-core` passes after each module move.
6. Final gate: `cargo test -p messaging-core` — all unit tests from Desktop migrate to Core.

### Phase 3: Desktop Adapter — SOURCE COMPLETE; LIVE E2E UNPROVEN

**Deliverable**: `apps/desktop/src-tauri/src/messaging/` shrinks to adapter + lifecycle + commands.

**Proto unification prerequisite**: ✅ COMPLETE (2026-08-19)
1. ✅ Remove chat proto compilation from Desktop's `build.rs`.
2. ✅ Desktop imports `messaging_core::proto::chat::*` for all chat types.
3. ✅ Desktop's `crate::model::chat` module becomes a re-export of Core's types.
4. ✅ Non-chat protos (actor, social, auth, etc.) remain Desktop-generated.

**Codec delegation**: ✅ COMPLETE (2026-08-19)
1. ✅ `private_content.rs` → re-export from `messaging_core::codec::private_content`.
2. ✅ `verification.rs` → re-export from `messaging_core::codec::verification`.
3. ✅ `attachment.rs` validation → re-export from `messaging_core::codec::attachment_validation`.

**Crypto delegation**: ✅ COMPLETE (2026-08-19)
1. ✅ `identity.rs` types → re-export from `messaging_core::crypto::identity` (platform persistence retained).
2. ✅ `double_ratchet.rs` → thin wrappers calling `messaging_core::crypto::double_ratchet` with `From<DrError> for CryptoError` mapping.
3. ✅ `x3dh.rs` → thin wrappers calling `messaging_core::crypto::x3dh` with error classification.
4. ✅ Net reduction: -993 LOC in crypto, -160 LOC in codec. All 34 crypto + 92 messaging tests pass.

**Remaining steps** (store-level processor wiring):
1. `adapter.rs` — implements all port traits using:
   - SQLCipher connection pool (`rusqlite`)
   - `reqwest` HTTP client for Station transport
   - Tauri filesystem for attachment blob paths
   - OS keychain for key material
   - `std::time` for clock
   - Tauri event emit for projection sink
2. `lifecycle.rs` — unchanged (manages Engine worker lifecycle via Tauri state).
3. `commands.rs` — thin Tauri command wrappers calling `messaging_core::Engine`.
4. Gate: `cargo test` in Desktop passes. Native E2E (Direct + Group + attachment + recovery
   + receipts + interactions + typing) passes.

**Source hard cut**: ✅ COMPLETE (2026-09-04)
1. Legacy raw MLS commands, gateway routes, frontend service, and local storage
   owner are deleted.
2. Generic frontend conversation-command proposal persistence is deleted;
   Messaging Engine owns durable command/outbox state.
3. Three-Station E2E and Desktop social projections consume canonical
   `messaging_*` commands and typed Engine projections.
4. Focused Core, Desktop library, Desktop service, strict source-contract, and
   Mobile Rust checks pass. Live three-Station execution remains `UNPROVEN`.

### Phase 4: Mobile Adapter

**Deliverable**: `apps/mobile/src-tauri/src/messaging/` implements same port traits.

**Progress (2026-09-04)**:
- ✅ Mobile now links `rusqlite` with `bundled-sqlcipher`.
- ✅ `MobileMessagingStore` opens a keyed SQLCipher database and implements the
  queue claim/replay fence, lane checkpoint, atomic conversation projection,
  authority head, exact-byte command outbox transitions, prekey lookup,
  integrity check, and atomic-replace preparation portions of
  `MessagingRepository`.
- ✅ Direct receive/edit persistence now atomically commits ratchet state,
  skipped keys, plaintext projection/edit, authority head, receipts,
  consumption marker, and lane cursor.
- ✅ Standalone delivery receipts and actor read cursors now use the same
  claimed-item replay fence and atomic lane-cursor transaction; delivery state
  advances monotonically and read cursors never regress.
- ✅ Public sender markers and edit/retract/reaction/pin events now commit
  projections, authority heads, receipts, command state, consumption markers,
  and lane cursors atomically.
- ✅ Mobile implements `MlsOutboundRepository`, `MlsTransitionRepository`,
  `MlsKeyPackageRepository`, `MlsStartupRepository`, and
  `MlsInboundRepository`, including restart restoration and join/application/
  sender-transition/retirement commits.
- ✅ Twelve focused repository tests cover keyed SQLCipher reopen, atomic
  projection and Direct/MLS receive, replay, conflicting claimed payloads,
  authority-chain rollback, exact command-byte/attempt binding, interactions,
  KeyPackage state, and MLS startup state.
- ✅ Mobile has one account-scoped runtime registry backed by native secure
  identity material and per-account SQLCipher keys. Activation restores the MLS
  signer/session graph and constructs the Core Direct/MLS/public/conversation/
  receipt consumer graph; cross-account reuse is rejected.
- ✅ Typed Mobile Tauri commands expose activation, status, conversation
  projection, reconcile, and deactivation. Reconcile uses authenticated
  protobuf queue claim/ACK and exact-byte command submission transports.
- ✅ Core owns metadata-interaction validation and exact `ChatCommand`
  construction. Desktop and Mobile implement the same repository contract and
  revalidate the expected authority head inside the SQLCipher transaction.
- ✅ Group send/edit persistence now applies the same transaction-time
  authority-head CAS as Direct send/edit, closing the preflight-to-commit race.
- ✅ Mobile exposes account-scoped typed commands for message/thread/search
  projections, command status, Direct/Group text send and edit,
  retract/reaction/pin, read cursor, and ephemeral typing. Durable commands use
  the Messaging Engine outbox; typing bypasses every durable queue.
- ✅ Mobile committed-message writes maintain the local SQLCipher FTS projection,
  and message reads enrich attachments, reactions, pins, and reader PTIDs from
  the canonical schema.
- ✅ Desktop and Mobile now execute one Core-owned SQLCipher schema/migration
  manifest. Mobile migrates its temporary cursor, prekey, and attachment
  layouts before deleting those tables.
- ✅ Core owns Direct send/edit validation, ordered endpoint/session resolution,
  ratchet encryption, exact command construction, and persistence contracts;
  both adapters enforce authority-head and pre-advance ratchet CAS in the same
  transaction as command/outbox/projection persistence.
- ✅ Mobile now supplies root-bound attachment blob storage, authenticated
  Station transfer, SQLCipher upload/download checkpoints, cache promotion,
  typed staging/open/cancel commands, and bounded 1 MiB Web-to-Rust staging.
- ✅ The account-scoped continuous worker now drives attachment transfer,
  message-draft preparation, command dispatch, queue drain, projection events,
  source cleanup, retry deadlines, suspend/resume, and stop/join.
- ✅ Mobile Web Chat/Group message list/send/edit/retract/read/typing and
  attachment stage/open paths now consume the Device Messaging Engine.
  Legacy friend/group message routes, browser media crypto, Sender Key
  runtimes/bridges/ledger/storage, duplicate `messaging_send_text`, and generic
  Chat command-ledger admission are deleted from active Mobile source.
- ✅ Deferred attachment sends retain and lock the composer until the
  count-conserving Engine projection advances; incomplete attachment-only
  drafts remain outside the message projection.
- ✅ The current Mobile Rust library suite passes 66 tests. Production Mobile
  Web build, normal and Acceptance Rust checks, Social wire/runtime boundary
  gates, scoped diff checks, and active-source old-owner scans pass. Prior
  verified evidence remains Messaging Core 104 unit plus 2 integration tests
  and Desktop library 24 tests.
- Remaining: run Mobile Native two-actor/multi-Station Direct + Group text,
  attachment, recovery, lifecycle, restart, receipt, typing, and interaction
  evidence. The superseded Desktop raw Direct command/store owner has been
  deleted and its legacy tables are removed by an idempotent migration.

Steps:
1. ✅ Create `apps/mobile/src-tauri/src/messaging/adapter.rs` implementing ports.
2. ✅ Wire Mobile's SQLCipher, HTTP transport, keychain, filesystem.
3. ✅ Create `lifecycle.rs` for Mobile background/foreground lifecycle.
4. ✅ Create `commands.rs` exposing Tauri Mobile commands.
5. ✅ Delete Mobile Sender Keys from active Mobile Rust/Web ownership.
6. ✅ Route Mobile Chat through Messaging Engine command/outbox persistence; the
   generic Mobile command ledger remains limited to non-messaging domains.
7. ✅ Gate: `cargo check` on Mobile and Mobile production Web build succeed.
8. Gate: Mobile Native E2E — Direct + Group text, attachment, recovery, lifecycle,
   background/foreground, restart, receipt, MP-C15 typing and MP-C16 interactions.

### Phase 5: Verification Closure

Steps:
1. Run shared protocol test suite from `packages/messaging-core/` against both adapters.
2. Verify zero `use messaging_core` in adapter that touches protocol internals.
3. Verify zero platform-specific code in `packages/messaging-core/src/`.
4. Tree-wide scan: no Sender Keys references, no duplicate schema definitions.
5. Update `20260808-messaging-platform.md` W09 status to `completed`.

## 5. Risk Mitigation

| Risk | Mitigation |
|---|---|
| Large extraction breaks Desktop | Move one module at a time; gate each move |
| Mobile adapter has different SQLCipher version | Both use `rusqlite` with `bundled-sqlcipher` feature |
| OpenMLS version mismatch | Single `openmls` dependency in Core's `Cargo.toml` |
| Feature flag temptation | Hard constraint: no `#[cfg(feature = ...)]` for platform selection in Core |

## 6. Success Criteria

- `packages/messaging-core/` compiles independently with no platform dependencies.
- Desktop and Mobile both pass native E2E (text + attachment + recovery).
- Desktop and Mobile both pass MP-C01–MP-C16 contract and Native runtime parity.
- Zero protocol logic in either adapter.
- Zero Sender Keys code remaining.
- Shared test suite runs identically against both platform adapters.

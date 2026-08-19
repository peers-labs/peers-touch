# MP-W09: Portable Rust Messaging Core — Execution Plan

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-08-11 | **Updated**: 2026-08-19
> **Owner**: Messaging Platform Team
> Accepted architecture: MP-D16 (2026-08-09)
> Module layout: `docs/architecture/messaging-platform/module-layout.md`
> Parent plan: `20260808-messaging-platform.md`

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

### Phase 2: Core Module Extraction — 🔶 IN PROGRESS (2026-08-11)

**Deliverable**: All protocol logic moved from `apps/desktop/src-tauri/src/messaging/` into `packages/messaging-core/src/`

**Progress (2026-08-19)**:
- ✅ Proto generation (`build.rs`, 20 chat + 1 common .proto files — full coverage)
- ✅ `codec/private_content` + `codec/attachment_validation` + `codec/verification`
- ✅ `identity/keys` + `identity/enrollment`
- ✅ `inbox/drain` (queue FSM)
- ✅ `outbox/dispatch` (command outbox worker)
- ✅ `recovery/codec` (AES-GCM sectioned archive with KDF port)
- ✅ `store/repository` trait (MessagingRepository boundary)
- ✅ Proto unification complete (Phase 3 prerequisite resolved 2026-08-19):
  - Core owns all chat + common protos; Desktop re-exports via `messaging_core::proto::*`
  - Desktop `build.rs` uses `extern_path` to map `.peers_touch.model.chat.v1` / `.peers_touch.model.common.v1` to Core's types
  - Both `cargo check -p messaging-core` and `cargo check` (Desktop) pass
- ❌ Remaining: store-dependent module extraction (direct, mls, engine, recovery orchestration)
- Gate: 19 tests pass, `cargo clippy` clean, Desktop `cargo check` clean with Core dependency

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

### Phase 3: Desktop Adapter — 🔶 IN PROGRESS

**Deliverable**: `apps/desktop/src-tauri/src/messaging/` shrinks to adapter + lifecycle + commands.

**Proto unification prerequisite**: ✅ COMPLETE (2026-08-19)
1. ✅ Remove chat proto compilation from Desktop's `build.rs`.
2. ✅ Desktop imports `messaging_core::proto::chat::*` for all chat types.
3. ✅ Desktop's `crate::model::chat` module becomes a re-export of Core's types.
4. ✅ Non-chat protos (actor, social, auth, etc.) remain Desktop-generated.

Steps:
1. ✅ Proto unification (prerequisite above).
2. `adapter.rs` — implements all port traits using:
   - SQLCipher connection pool (`rusqlite`)
   - `reqwest` HTTP client for Station transport
   - Tauri filesystem for attachment blob paths
   - OS keychain for key material
   - `std::time` for clock
   - Tauri event emit for projection sink
2. `lifecycle.rs` — unchanged (manages Engine worker lifecycle via Tauri state).
3. `commands.rs` — thin Tauri command wrappers calling `messaging_core::Engine`.
4. Add `messaging-core` as workspace dependency in Desktop's `Cargo.toml`.
5. Gate: `cargo test` in Desktop passes. Native E2E (Direct + Group + attachment + recovery
   + receipts + interactions + typing) passes.

### Phase 4: Mobile Adapter

**Deliverable**: `apps/mobile/src-tauri/src/messaging/` implements same port traits.

Steps:
1. Create `apps/mobile/src-tauri/src/messaging/adapter.rs` implementing ports.
2. Wire Mobile's SQLCipher, HTTP transport, keychain, filesystem.
3. Create `lifecycle.rs` for Mobile background/foreground lifecycle.
4. Create `commands.rs` exposing Tauri Mobile commands.
5. Delete Mobile Sender Keys (`apps/mobile/src-tauri/src/domain/` crypto modules).
6. Gate: `cargo check` on Mobile. Mobile build succeeds.
7. Gate: Mobile Native E2E — Direct + Group text, attachment, recovery, lifecycle,
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

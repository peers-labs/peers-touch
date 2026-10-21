# Mobile Storage Coding Guide

> **Status**: active
> **Updated**: 2026-10-17
> **Scope**: Shared Mobile cache, Rust-owned durable state, and OS secure-storage adapters

---

## 1. Storage Classes

Mobile uses one storage ownership model on Android and iOS:

| Class | Owner | Examples |
|---|---|---|
| Shared business truth | Station | account state, conversations, membership, notification preferences |
| Portable-core durable state | owning Rust core | encrypted messaging state, secure-content state |
| Mobile runtime durable state | Mobile Rust runtime | command ledger, drafts, recovery/quarantine state |
| Non-secret client cache | `@peers-touch/client-storage` + Mobile runtime | avatars, projections, device preferences, Station registry |
| Secrets and key material | Rust secure-storage port + OS adapter | session credentials, install/device keys, OAuth verifier/nonce |
| OS/provider resources | typed native plugin | scoped media handles, provider tokens, permission state |

Android Room/DataStore and iOS SwiftData/UserDefaults are not parallel Mobile
business stores. Native adapters may use OS storage mechanisms only behind a
typed port whose semantic owner remains in shared Mobile/Rust code.

## 2. Shared Client Cache

`packages/client-storage/` owns renderer-neutral cache envelopes, scope keys,
TTL/stale semantics, and invalidation. Mobile composes it in
`apps/mobile/src/storage/mobileClientStorage.ts`.

Every cache entry is scoped by the dimensions required by its domain:

```text
app / Station / actor / device / session / process / domain / key
```

Rules:

- Station and actor scope use canonical identity, never display name or URL.
- Cache data is derived and replaceable; it cannot authorize business actions.
- Session/process projections are invalidated on teardown.
- Station or actor change cannot read the previous scope.
- Domain IDs and TTL policy are defined once in `packages/client-storage/`.
- Browser storage contains no credentials, private keys, OAuth verifier,
  provider secrets, or unrestricted native paths.

`localStorage` is an adapter for bounded non-secret cache data, not a general
Mobile persistence layer.

## 3. Rust-Owned Durable State

Durable commands, drafts, encrypted messaging state, retention/accounting, and
recovery state live behind Rust owners under:

```text
apps/mobile/src-tauri/src/runtime/
apps/mobile/src-tauri/src/messaging/
packages/messaging-core/
packages/secure-content-core/
```

Each durable owner declares:

- Station/PTID/device/session scope;
- schema and migration owner;
- encryption and key source;
- transaction/commit semantics;
- cancellation and crash recovery;
- logout, Station-switch, actor-switch, uninstall, and reset behavior;
- evidence Gate for corruption and recovery.

Web presentation uses typed Tauri commands and projections. It does not open
the database, write a second outbox, or mirror the durable command state into
browser storage.

## 4. Secure Storage

The Rust secure-storage port is the only application-facing owner for secrets:

```text
Mobile runtime/core
  -> Rust secure-storage port
  -> Android secure-storage plugin or iOS Keychain adapter
  -> OS-protected storage
```

Current source roots:

- `apps/mobile/src-tauri/src/platform/secure_storage/`;
- `apps/mobile/src-tauri/plugins/secure-storage/`;
- typed commands in `apps/mobile/src-tauri/src/commands/secure_storage.rs`.

Rules:

- Kotlin/Swift code does not expose secret values to Web state.
- Missing, denied, corrupted, or unsupported secure storage fails closed for
  protected sessions and writes.
- Keys bind to their Station/PTID/device purpose and version.
- Rotation and deletion are explicit operations.
- Logs and Acceptance artifacts contain only redacted identifiers.
- Hardware-backed claims require physical-device evidence.

## 5. Device Preferences

Device-local product preferences use the shared Mobile runtime and
`@peers-touch/client-storage` unless confidentiality or OS execution requires a
native port. Android and iOS do not define separate preference schemas.

Account-level preferences remain Station-owned and synchronize through typed
Station contracts. A UI setting must state whether it is:

- Station/account scoped;
- device local;
- session/process ephemeral;
- OS capability observation.

Ambiguous scope is a storage defect.

## 6. Migration And Cleanup

- Internal ownership changes use a hard cut with one writer.
- Persisted external data receives an explicit schema migration.
- No dual Room/SwiftData/Rust writes or read fallback.
- Logout removes session secrets and session-scoped projections.
- Actor or Station switch fences the old generation before new writes.
- Cache cleanup never deletes durable outbox, drafts, cryptographic state, or
  protected attachment blobs.
- Failed cleanup is typed and observable; it is not converted to success.

## 7. Verification

Focused checks cover:

- scope-key isolation across Station, PTID, device, and session;
- stale/TTL behavior and domain invalidation;
- no secret material in browser storage;
- secure-storage unavailable/corrupt/denied behavior;
- migration, crash, and partial-cleanup recovery;
- command-ledger idempotency and unknown-outcome readback;
- encrypted database/key lifecycle;
- Android and iOS adapter integration independently.

Shared source tests prove storage semantics. OS protection, backup behavior,
Keychain/Keystore behavior, uninstall, and hardware claims require the
corresponding native runtime cell.

## 8. Related Sources

- [Cross-Client Runtime](../../../architecture/platform/client/cross-client-runtime/README.md)
- [Mobile Shell](../../../architecture/platform/client/mobile/README.md)
- [Mobile Lifecycle](../../../client/mobile/lifecycle.md)
- [Chat Storage Governance](../../../architecture/domains/chat/storage-governance/README.md)

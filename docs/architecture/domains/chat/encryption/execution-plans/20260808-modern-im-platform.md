# Modern IM Platform - Execution Plan

> **Status**: active
> **Version**: 1.0.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-08
> **Owner**: Architecture Team

---

## 1. Sources

- `docs/architecture/domains/chat/encryption/design.md`
- `docs/architecture/domains/chat/encryption/decisions.md`
- `docs/architecture/domains/chat/encryption/data-model.md`
- `docs/architecture/domains/chat/encryption/integration.md`
- `docs/context/architecture/chat/federated-im/README.md`
- `docs/client/desktop/runtime-projections.md`

## 2. Scope

Deliver usable direct and group IM with device-addressed encryption, durable
delivery, recovery, and visible native evidence. No compatibility runtime,
actor-wide DKX, conversation-keyed ratchet, or test-order workaround remains.

## 3. Dependency DAG

```text
W1 canonical proto contracts
  -> W2 Station device registry and device-targeted DKX
  -> W3 Rust endpoint-pair sessions and atomic outbox
  -> W4 Desktop cryptoRuntime cutover
  -> W5 per-device direct message authority event and delivery
  -> W6 backup/recovery
  -> W7 MLS device-leaf closure
  -> W8 visible native acceptance
  -> W9 old-path deletion and audit
```

W2 Station persistence and W3 Rust internals may proceed in parallel after W1.

## 4. Workstreams

| ID | Deliverable | Gate |
|---|---|---|
| W1 | `CryptoEndpoint`, `DirectSessionInit`, device-targeted DKX, repeated direct payloads, backup APIs | proto generation succeeds; source/generated diff aligned |
| W2 | Station validates device tuples and creates only device inbox DKX | Go tests reject blank/mismatched devices |
| W3 | Rust persists endpoint-pair sessions and atomically stores ratchet/outbox | Rust unit tests cover crash/retry and two devices |
| W4 | `cryptoRuntime` becomes sole orchestrator; `socialChat` consumes it | TypeScript check/tests; duplicate runtime references zero |
| W5 | Authority commits one message with complete per-device payloads | two recipient devices decrypt one message identity |
| W6 | 24-word recovery, opaque Station revisions, all-or-nothing restore | reinstall restores exact historical plaintext |
| W7 | MLS device leaf add/remove/send/restart/recovery | visible native group journey passes |
| W8 | Isolated visible native clients with bounded step telemetry | all required journeys `DONE/PROVEN` |
| W9 | Delete old commands, fields, docs, selectors, and debug instrumentation | tree scans return zero; completion audit passes |

## 5. End-to-End Closure

### Direct Send

1. Resolve all active recipient and sender devices.
2. Ensure one ready endpoint-pair session per target.
3. Encrypt once per target inside Rust.
4. Persist ratchets and exact command bytes atomically.
5. Submit/replay the command.
6. Commit one authority event.
7. Fan out device inbox items.
8. Decrypt by sender endpoint and update local projection.
9. Submit delivered/read receipts.

### Restart and Reconnect

1. Restore local identity, sessions, and outbox.
2. Resume unacked device envelopes.
3. Deduplicate without second ratchet advancement.
4. Reconcile conversation projection.

### Reinstall

1. Authenticate and enter recovery phrase.
2. Validate and restore encrypted history atomically.
3. Enroll a fresh device identity.
4. Establish fresh direct/MLS sessions.
5. Continue new traffic while restored history remains readable.

## 6. Cutover Rules

- Proto changes land before consumers.
- Each workstream ends internally consistent.
- No old/new runtime coexistence after W4.
- No singular direct ciphertext after W5.
- Rollback uses version control/deployment rollback, not a permanent fallback.
- Any missing ordering, retry, or recovery semantic returns to architecture.

## 7. Verification

Required cells:

- Alice and Bob start concurrently in both orders.
- Alice and Bob send exact plaintext both directions.
- Bob has two devices; both decrypt one message.
- Recipient offline, resumes, ACKs, and decrypts.
- Duplicate delivery is idempotent.
- Sender crashes after outbox persistence and retries exact bytes.
- Both clients restart with history intact.
- Fresh storage restores history with the recovery phrase.
- Device revoke blocks future delivery.
- Three-device MLS group add/send/remove/restart.
- No `[Message cannot be decrypted]` for messages created by the new platform.

## 8. Evidence

- `tooling/acceptance/reports/chat-native-two-client-run.json`
- `tooling/acceptance/reports/chat-native-multi-device-run.json`
- `tooling/acceptance/reports/chat-native-recovery-run.json`
- `tooling/acceptance/reports/chat-native-group-mls-run.json`
- Station deployment commit and health evidence
- Desktop TypeScript, Rust, Go, proto, and source-deletion scans

## 9. Status

| Workstream | Status | Evidence |
|---|---|---|
| W1 | done | proto generation PASS |
| W2 | done | focused Station tests PASS |
| W3 | done | Rust check PASS; native evidence pending W8 |
| W4 | done | TypeScript check and focused tests PASS |
| W5 | done | Native active-device plaintext PASS; revoked device post-revoke inbox count `0` |
| W6 | done | Revision 2 fresh-storage restore PASS; exact plaintext and fresh device enrollment verified |
| W7 | in progress | MLS ownership and device-leaf closure in progress |
| W8 | in progress | visible-client operational runner in progress |
| W9 | pending | |

## 10. Non-Claims

No workstream is complete from file presence, compilation, or structural
assertions alone. “Usable” requires the named visible native journeys.

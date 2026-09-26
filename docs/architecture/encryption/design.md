# Chat Encryption - Architecture Design

> **Status**: active
> **Version**: 1.0.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-08
> **Owner**: Architecture Team
> **Module**: `model/domain/chat/`, `apps/station/app/subserver/{conversation,envelope,key_exchange}/`, `apps/desktop/`

---

## 1. Core Principles

1. **Endpoint identity**: crypto addresses are always `(PTID, device_id)`.
2. **Station blindness**: Station stores public bundles and opaque ciphertext.
3. **One authority event**: a message has one ordered event containing
   device-targeted ciphertext entries.
4. **Durable device delivery**: DKX and committed messages target device inboxes;
   blank device IDs fail closed.
5. **Recoverable history**: plaintext history is re-encrypted under a recovery
   key and backed up; live ratchet state is never transferred between devices.
6. **Single ownership**: `cryptoRuntime` orchestrates crypto; Rust owns keys and
   ratchets; Station owns public registry, ordering, and delivery.

## 2. System Architecture

```text
Desktop Web
  Chat projection / composer
          |
          v
  cryptoRuntime (only crypto orchestrator)
          |
          v
Desktop Rust
  device identity + X3DH + Double Ratchet + MLS + SQLCipher + backup codec
          |
          | typed protobuf commands
          v
Station
  device registry -> public key bundles
  conversation authority -> one ordered opaque event
  envelope service -> one durable inbox item per target device
  backup service -> versioned opaque backup blobs
          |
          v
Recipient Desktop/Mobile device
  envelope resume/SSE -> cryptoRuntime -> Rust decrypt -> local projection
```

## 3. Ownership

| State/capability | Source of truth | Must not be owned by |
|---|---|---|
| Actor identity trust anchor | Actor private backup + published public identity | UI store |
| Device signing identity | Device key store + Station device certificate | Conversation ID |
| SPK/OPK private material | Device-local encrypted key store | Station |
| Public device bundles | Station key-exchange subserver | Page lifecycle |
| Direct ratchet state | Rust SQLCipher keyed by endpoint pair | TypeScript store |
| MLS state | Rust MLS store keyed by group and local device | Station |
| Ordered conversation event | Conversation authority Station | Client cache |
| Device delivery cursor | Station device inbox | Actor-wide queue |
| Recovered plaintext history | Local SQLCipher after backup restore | Station plaintext |

## 4. Direct Session Contract

The canonical session key is:

```text
(conversation_id,
 self_ptid, self_device_id,
 peer_ptid, peer_device_id,
 session_generation)
```

X3DH initiation fetches all active peer bundles and produces one
`DirectSessionInit` per peer device. The init includes both endpoint addresses,
the exact SPK/OPK IDs, negotiated protocol, and sender ephemeral key.

Station validates:

- sender PTID from authentication;
- sender device from `X-Device-ID`;
- recipient device is active for recipient PTID;
- sender and recipient endpoint tuples differ;
- no DKX envelope has a blank device ID.

The receiver accepts only when the envelope recipient tuple equals the local
endpoint and the referenced private pre-keys exist.

## 5. Message Contract

A direct-message command contains:

```protobuf
message DeviceEncryptedPayload {
  string recipient_ptid = 1;
  string recipient_device_id = 2;
  string session_id = 3;
  bytes encrypted_envelope = 4;
}

message SendMessageCommand {
  repeated DeviceEncryptedPayload device_payloads = 1;
  MessageContentType content_type = 2;
  string reply_to_message_id = 3;
  string thread_root_message_id = 4;
  repeated EncryptedAttachment attachments = 5;
}
```

The authority commits one event containing the same payload set. Station creates
one inbox item per entry. Group messages instead carry one MLS application
ciphertext and are delivered to all active member devices.

For direct messages, send fails closed before ratchet advancement unless every
active recipient device and every other active sender device has a ready
session. The Rust outbox transaction persists:

1. advanced ratchet states;
2. the complete command bytes;
3. an idempotency key.

Network submission replays the persisted command. A successful authority result
removes the outbox row. This prevents ratchet advancement without durable send.

## 6. Delivery, Replay, and Receipts

- DKX and committed events are durable and device-targeted.
- SSE is a latency path; `/envelope/resume` is the recovery path.
- Inbox deduplication uses `(recipient_ptid, recipient_device_id,
  idempotency_key)`.
- A device ACK acknowledges only its inbox item.
- Delivered means at least one recipient device ACKed.
- Read means a recipient actor submitted a read cursor from an active device.
- Sender UI derives aggregate receipt state from device/actor receipts without
  weakening per-device delivery truth.

## 7. Backup and Recovery

The recovery phrase is 24-word BIP39. Argon2id derives a backup key using a
random stored salt and explicit parameters. The backup contains:

- actor identity seed and trust metadata;
- device-independent conversation metadata;
- plaintext message history re-encrypted under the backup key;
- attachment decryption metadata;
- verified peer fingerprints.

It excludes:

- SPK/OPK private keys;
- Double Ratchet state;
- MLS epoch state;
- current device signing key.

On reinstall or new device:

1. authenticate to Station;
2. restore actor identity and history backup;
3. retain the fresh device identity already bound to the authenticated session;
4. publish a fresh bundle;
5. establish fresh direct sessions and MLS device leaves;
6. resume device-targeted new traffic.

An in-place restore retains the currently authenticated device identity so the
Station session remains valid. No old device ratchet or MLS session is restored.

## 8. Group Encryption

Each active device is one MLS leaf. Membership transitions are committed by the
conversation authority. Device add receives a Welcome; device revoke removes
the leaf. Group send is disabled until the local leaf is active at the current
membership/MLS epoch.

## 9. Failure Semantics

| Failure | Required behavior |
|---|---|
| Peer has no active bundle | Do not mutate ratchets; show device unavailable |
| Some active device lacks a session | Do not send; establish sessions first |
| SPK/OPK mismatch | Reject DKX; refresh exact device bundle; create new generation |
| Blank/mismatched device address | Reject at client and Station |
| Station unavailable after encryption | Replay persisted outbox bytes; never re-encrypt |
| Duplicate envelope | Idempotent ACK; no second ratchet advance |
| Decrypt gap within bound | Use skipped-key cache |
| Irrecoverable direct session | Device-targeted reset and fresh X3DH |
| Missing recovery phrase | History cannot be reconstructed; state this before reset |
| Backup integrity failure | Restore nothing; preserve current local state |

## 10. Forbidden Relationships

- Conversation ID as the sole direct-session key.
- Actor-wide DKX or actor-wide encrypted-message delivery.
- Selecting one arbitrary peer bundle for a multi-device actor.
- TypeScript storing private keys or authoritative ratchet state.
- Station storing plaintext, recovery phrase, or backup key.
- Advancing ratchets before an atomic durable outbox write.
- Coexisting legacy and tuple-aware crypto runtimes.
- Startup ordering, sleeps, retries, or UI polling as session correctness.

## 11. Architecture Gates

The architecture is proven only when visible native clients demonstrate:

1. concurrent startup in either order;
2. bidirectional exact plaintext;
3. two recipient devices receive independently decryptable copies;
4. offline resume and duplicate replay;
5. sender and receiver restart;
6. reinstall history restore with the recovery phrase;
7. revoked device receives no new ciphertext;
8. MLS group send, add, remove, restart, and recovery;
9. zero new decryption placeholders;
10. zero live references to conversation-keyed direct crypto.

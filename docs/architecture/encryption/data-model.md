# Chat Encryption - Data Model

> **Status**: active
> **Version**: 1.0.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-08
> **Owner**: Architecture Team

---

## 1. Endpoint Address

```protobuf
message CryptoEndpoint {
  string ptid = 1;
  string device_id = 2;
}
```

Both fields are required and validated. Numeric actor IDs are forbidden.

## 2. Direct Session Initialization

```protobuf
message DirectSessionInit {
  string session_id = 1;
  string conversation_id = 2;
  CryptoEndpoint sender = 3;
  CryptoEndpoint recipient = 4;
  bytes sender_identity_key = 5;
  bytes sender_ephemeral_key = 6;
  uint32 recipient_signed_pre_key_id = 7;
  optional uint32 recipient_one_time_pre_key_id = 8;
  uint32 protocol_version = 9;
  uint64 session_generation = 10;
}
```

Private-key lookup uses IDs and the recipient endpoint. Public-key bytes are not
used as database identifiers.

## 3. Device-Targeted Message Payload

```protobuf
message DeviceEncryptedPayload {
  string recipient_ptid = 1;
  string recipient_device_id = 2;
  string session_id = 3;
  bytes encrypted_envelope = 4;
}
```

For direct conversations, `SendMessageCommand.device_payloads` and
`MessageCommittedEvent.device_payloads` are non-empty. The old singular
`encrypted_payload` field is removed.

## 4. Local Persistence Keys

```text
crypto_identity:
  (self_ptid, self_device_id)

direct_session:
  (conversation_id,
   self_ptid, self_device_id,
   peer_ptid, peer_device_id,
   generation)

skipped_message_key:
  (direct_session_key, peer_ratchet_public, counter)

crypto_outbox:
  (command_id)
  -> command_bytes, ratchet_transaction_id, state

decrypted_message:
  (conversation_id, message_id)
  -> plaintext payload encrypted by SQLCipher
```

## 5. Direct Session State Machine

```text
absent
  -> fetching_bundle
  -> initializing
  -> init_queued
  -> ready
  -> reset_required
  -> initializing

Any state -> revoked
Any invalid address/key reference -> error (fail closed)
```

`ready` means both:

- local ratchet state is durably persisted;
- the device-targeted DKX envelope is durably accepted by Station.

## 6. Outbox State Machine

```text
prepared -> submitted -> authority_committed -> removed
    |           |
    +-> retry <-+
```

`prepared` is created in the same SQLCipher transaction as ratchet advancement.
Retry never regenerates ciphertext.

## 7. Backup Manifest

```protobuf
message BackupManifest {
  string backup_id = 1;
  string ptid = 2;
  uint64 revision = 3;
  bytes encrypted_blob = 4;
  bytes nonce = 5;
  bytes integrity_tag = 6;
  KdfParameters kdf = 7;
  int64 created_at_unix_ms = 8;
}
```

Station keys backup rows by `(ptid, revision)` and retains a bounded revision
window. It cannot decrypt any blob.

## 8. Invariants

- Every direct ciphertext has exactly one recipient endpoint.
- Every DKX has exactly one sender and recipient endpoint.
- Every direct committed event contains all required active-device payloads.
- A local device ignores envelopes addressed to another device.
- Ratchet advancement and outbox creation are atomic.
- Backup restore is all-or-nothing after integrity validation.

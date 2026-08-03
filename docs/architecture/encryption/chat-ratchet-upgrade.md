# Chat Ratchet Upgrade — Chain-Only → Double Ratchet

> Design document. **No code lands until this doc is reviewed.**
>
> Companion to `docs/architecture/encryption/e2e-encryption-architecture.md`,
> which defines the *target* E2E protocol stack. This document covers the
> specific upgrade path from the **currently shipped chain-only symmetric
> ratchet** to the Signal-equivalent **Double Ratchet**, including threat
> model, migration strategy, rollback, and the concrete blockers the
> upgrade unlocks (most notably E2EE message edit).

---

## 1. Document Scope

This document defines:

- The cryptographic gap between the **shipped** ratchet and what
  `e2e-encryption-architecture.md` §4.1 prescribed.
- The threat model that the upgrade resolves, framed against
  capabilities that are *already in production* (recall, edit,
  delete, multi-device, signaling envelope, voice/video).
- A staged migration plan that preserves wire compatibility with
  in-flight legacy sessions and never silently re-keys.
- A rollback procedure that does not strand encrypted history.
- The acceptance criteria for declaring the upgrade complete.

This document does **not** redefine:

- X3DH (already shipped per `crypto/mod.rs::x3dh.rs`).
- Identity key generation / OS keyring usage (already shipped).
- The signaling envelope (separate primitive — see
  `peers-chat/docs/architecture/realtime/event-stream.md` §2.7.2).
- Group ratcheting (Sender Keys live in their own follow-up doc).

---

## 2. Current State (Shipped)

`apps/desktop/src-tauri/src/domain/crypto/mod.rs` ships a **chain-only
symmetric ratchet** seeded from the X3DH shared secret:

```rust
pub struct RatchetState {
    pub chain_key: [u8; 32],
    pub counter:  u32,
}

// Per-message:
let MK = HKDF(chain_key, info=b"msg",   L=32+12)  // {enc_key, nonce}
chain_key = HKDF(chain_key, info=b"chain", b"advance", L=32)
counter  += 1
```

Two separate chains exist per session — `send_ratchet` and
`recv_ratchet` — derived from the same shared secret with directional
HKDF labels (`dir-a` / `dir-b`). The receive path enforces strict
counter equality (`msg.counter != recv_ratchet.counter` → reject).

### 2.1 What this gives us

| Property | Status |
|---|---|
| Confidentiality (Station-blind payload) | YES — AES-256-GCM, only chain participants hold the key. |
| Authenticity vs. tampering | YES — GCM tag covers the ciphertext. |
| Identity authentication on session establishment | YES — X3DH binds to long-term Ed25519 IK. |
| Per-message forward secrecy (within a chain) | PARTIAL — `chain_key` is one-way after each `next_message_keys`, so leaking the *current* chain key reveals only future messages, not past plaintexts whose `MK` was derived and dropped. |
| Sender-key forward secrecy across chain compromise | **NO** — anyone who learns `chain_key` at counter `n` decrypts every subsequent message until the session is torn down. The chain never "heals." |
| Post-compromise security (PCS) | **NO** — there is no DH ratchet step. A compromise is permanent for the lifetime of the session. |
| Out-of-order delivery tolerance | **NO** — strict counter equality. SSE delivery already preserves order today, but offline pull-back, multi-device echo, and any future SFU / relay introduces OOO. |
| Replay protection | YES (incidental) — counter mismatch rejects re-deliveries. |
| E2EE recall | YES — recall is metadata-only (clear `content` + `encrypted_payload`); no re-encryption needed. |
| **E2EE edit** | **NO** — see §3. |

### 2.2 Where the gap bites today

The currently *desktop-side UI-gated* "edit" feature (per
`ChatMessageArea.tsx`'s edit affordance) exists for plaintext friend
chats only. For E2EE conversations the UI is intentionally disabled
because there is no safe way to re-encrypt an existing message under
the chain-only ratchet:

- Reusing the original `MK` requires persisting every per-message key
  for the lifetime of the message — that defeats the only forward
  secrecy property the chain currently has.
- Deriving a fresh `MK` at counter `N+k` and overwriting the old
  ciphertext re-encrypts under a key the original recipient(s) **may
  no longer be able to reproduce** (e.g. the ratchet has advanced
  past `N` long ago for any device that already drained those keys).
- Introducing a separate "edit chain" seeded once at session start
  gives editing zero forward secrecy and zero PCS — it pushes the
  exact problem onto a parallel chain.

The same gap will block any future flow that needs to re-issue
ciphertext for an existing logical message: server-side moderation
re-keying, key-change re-broadcast, device-add backfill, etc.

---

## 3. Threat Model

We model the threat **specifically against the gaps in §2.1**, not
the full E2E threat model (which lives in the parent doc §3).

### 3.1 In-scope adversaries

| Adversary | Capability | Why current chain-only ratchet fails |
|---|---|---|
| **A1 — Single-message key extraction** | Reads `MK` for one message (e.g. via a memory-disclosure bug, a buggy keylog) | Acceptable in chain ratchet (only that message leaks). Acceptable in DR too. **No regression.** |
| **A2 — Chain-key snapshot** | Reads `chain_key` at counter `n` (e.g. SQLCipher key compromise + filesystem image) | Chain ratchet leaks every message ≥ `n` until session teardown. DR seals the leak after the next DH ratchet step (next round-trip). |
| **A3 — Long-term IK compromise without DR** | Learns the long-term identity private key after session establishment | X3DH means Ek was destroyed → past messages safe. But future chain leaks any time the chain-key is observed. DR resolves this on the next DH ratchet step. |
| **A4 — Out-of-order delivery** | Reorders or drops-then-replays messages on the wire | Chain ratchet rejects all OOO frames → liveness break. DR's skipped-key handling tolerates any reorder up to a configured horizon. |
| **A5 — Edit-channel oracle** | Observes that an "edited" message produces ciphertext that decrypts under a key derivable from session establishment material alone | Any naïve "edit chain" we ship today exposes this: an attacker who breaks the chain root *once* breaks every edit forever. DR keeps edits' message keys downstream of fresh DH outputs. |

### 3.2 Out of scope

- Endpoint compromise that can read decrypted plaintext (we never
  defended against this — see parent doc §3.1).
- Quantum adversaries against X25519 (tracked separately under
  `docs/architecture/encryption/pqc-roadmap.md`, not yet written).
- Coercion / legal compulsion of either party (unaffected by
  ratchet choice).

### 3.3 Security goals the upgrade must achieve

1. **PCS within `≤ 2` round-trips** of any sender→receiver direction
   change (Signal-grade).
2. **OOO tolerance** up to `MAX_SKIP = 1000` per chain, with skipped
   message keys cached and zeroized on use (matches Signal's default).
3. **Edit safety**: an edited message's ciphertext MUST be
   decryptable by every device that legitimately holds the active
   session, AND its encryption key MUST NOT be derivable from any
   chain state older than the most recent DH ratchet step that
   precedes the edit.
4. **No key reuse** across the same `(chain_key, counter)` pair —
   already true today; must remain true.
5. **Backward-compatible decrypt** for ciphertext produced by the
   current chain-only ratchet during the migration window.

---

## 4. Target Design — Double Ratchet

We adopt the **Signal Double Ratchet** as specified in
[Perrin & Marlinspike 2016](https://signal.org/docs/specifications/doubleratchet/),
with the following Peers-Touch-specific adaptations.

### 4.1 Algorithmic outline (recap)

```
Root key (RK) ──┬──> KDF_RK(RK, DH(self_eph_priv, peer_eph_pub))
                │      └── new RK', new sending CK
                │
                └── per direction-change: a fresh DH happens, RK is
                    advanced, both chains get fresh CKs

Chain key (CK) ──> KDF_CK(CK)
                    ├── next CK
                    └── message key MK = HKDF(CK, "msg", 32+12)  // enc + nonce
```

Each outbound message header carries:

```
DR-Header := {
    dh_pub:    [u8; 32],   // sender's current X25519 ratchet public key
    pn:        u32,        // # of messages in previous sending chain
    n:         u32,        // counter within current sending chain
}
```

`dh_pub` advances exactly when the sender starts a *new* sending
chain (i.e. immediately after receiving the peer's new `dh_pub`).

### 4.2 Wire format

The `EncryptedMessage` proto already on the wire is:

```
EncryptedMessage {
    bytes  ciphertext   = 1;
    uint32 counter      = 2;
    bytes  ephemeral_key = 3;   // optional, X3DH-only today
}
```

The upgrade extends this *without breaking the field numbers*:

```
EncryptedMessage {
    bytes  ciphertext   = 1;       // unchanged
    uint32 counter      = 2;       // = DR-Header.n
    bytes  ephemeral_key = 3;      // X3DH initial only — kept
    bytes  ratchet_pub  = 4;       // NEW — DR-Header.dh_pub (X25519 32B)
    uint32 prev_counter = 5;       // NEW — DR-Header.pn
    uint32 version      = 6;       // NEW — wire-format version (see §5)
    bytes  nonce        = 7;       // NEW — AES-256-GCM nonce (12B)
}
```

`version == 0` (or absent) means **legacy chain-only ratchet** — the
receiver MUST decrypt with the existing chain ratchet code path.
`version == 1` means **Double Ratchet**.

### 4.3 Per-session state

```rust
pub struct DoubleRatchetSession {
    session_id: String,
    peer_did:   String,

    // DH ratchet
    dh_self:    StaticSecret,           // current sending DH private
    dh_self_pub:[u8; 32],               // current sending DH public
    dh_peer:    Option<[u8; 32]>,       // peer's last advertised DH pub

    // Symmetric ratchets
    rk:         [u8; 32],               // root key
    cks:        Option<[u8; 32]>,       // sending chain key
    ckr:        Option<[u8; 32]>,       // receiving chain key
    ns:         u32,                    // sending counter
    nr:         u32,                    // receiving counter
    pn:         u32,                    // # msgs in previous sending chain

    // Skipped message keys for OOO
    skipped:    BoundedMap<(Vec<u8>, u32), [u8; 32]>, // key=(dh_peer, n)
}
```

`BoundedMap` enforces `MAX_SKIP_PER_CHAIN = 1000` and
`MAX_SKIPPED_TOTAL = 5000`. Eviction is FIFO, and evicted keys are
explicitly `Zeroize`d.

### 4.4 Editing under DR

Edit ciphertexts are produced under a **fresh `MK`** derived from
the *current* `cks` at the time the edit is sent — i.e. they sit at a
new counter `n' > n_original` in the same sending chain, just like
any other message. The original ciphertext is overwritten in-place
on Station; the edit envelope carries:

```
EditEnvelope {
    target_message_ulid: String;     // identifies which row to mutate
    new_ciphertext:      EncryptedMessage;  // a normal DR-encrypted body
}
```

This gives edits the same forward-secrecy and PCS properties as any
other message in the conversation — **the entire point of the
upgrade for edit safety**.

The `MessageMutation` SSE event (already shipped — see
`model/domain/realtime/event.proto` and the friend-chat /
group-chat handler.go publish paths) carries the `EditEnvelope`
ciphertext as opaque bytes. Station's contract is unchanged.

---

## 5. Wire-Format Versioning & Negotiation

The upgrade is rolled out per session, not per device. Each session
advertises its highest supported version in the X3DH key-bundle
exchange:

```
KeyBundle {
    ...existing fields...
    repeated uint32 supported_versions = 99;  // [0, 1] for DR-capable
}
```

At session establishment time both sides compute
`min(max(supported_self), max(supported_peer))`. Once a session has
been negotiated at version `v`, it stays at `v` for life — there is
no in-session upgrade or downgrade path. A version bump requires a
session reset (new X3DH).

This keeps the receive code path **deterministic**: the
`version` field on the wire is a *check*, not a *selector*. Mismatch
between session-negotiated `v` and on-wire `version` is a fatal
authentication failure (drop the message, surface to the user as a
session integrity warning).

Why no in-session upgrade: an attacker who can downgrade-negotiate
would otherwise be able to force a session back to chain-only and
then exploit A2/A3. Hard binding at X3DH time is the well-trodden
defense.

---

## 6. Migration Strategy

### Phase M0 — Telemetry only (1 release, no behavior change)

- Ship a metrics counter incremented every time a session decrypts
  with the chain-only path. No code changes to the ratchet.
- Goal: measure the population of *active* legacy sessions before
  flipping the default. Acceptance gate: at least 1 release-cycle
  of data.

### Phase M1 — Implement DR behind a kill switch

- Land the DR implementation in `domain/crypto/double_ratchet.rs`
  next to (not replacing) `mod.rs::RatchetState`.
- Add `KeyBundle.supported_versions` proto field.
- Newly established sessions still negotiate `v = 0` because the
  station-published bundle still says `[0]`.
- A `crypto.dr_enabled` setting in
  `docs/architecture/runtime/feature-flags.md` (to be created)
  gates publishing `[0, 1]` in the bundle.
- Internal QA only.

### Phase M2 — Opt-in for new sessions

- **Activated 2026-07-31.** The default for new sessions publishes `[0, 1]`,
  X3DH negotiates `v = 1` whenever both sides are M2+.
- `X3dhSessionInit` is carried as opaque material inside the existing
  `DIRECT_KEY_EXCHANGE` envelope so the recipient initializes its DR
  responder state before decrypting the first message.
- Session readiness is persisted only after the DKX envelope is accepted;
  failed handshakes block message sending.
- Existing sessions stay on `v = 0` indefinitely.
- Acceptance gate: zero new-bug regressions over 2 release cycles
  AND DR-vs-legacy decrypt success rate within `0.01%` parity.

### Phase M3 — Aggressive session refresh

- Add a UI affordance ("Upgrade encryption for this conversation")
  that tears down the current session and re-runs X3DH so the new
  session lands at `v = 1`.
- The affordance MUST be user-triggered, not silent — silent
  re-keying would defeat A5 (an attacker who can prompt re-keys
  could grind ratchet states).
- Old session ciphertext stays decryptable forever via the
  archived chain state held in SQLCipher.

### Phase M4 — Hard cutover for new installs

- A version-N+ release publishes only `[1]` in the bundle.
- M0–M3 continue to read legacy ciphertext (forever, via the
  archived chain state).
- Old peers (<M2) talking to new peers downgrade to `[0]` is
  **explicitly disallowed**: if the negotiated set is empty the
  session creation fails and the UI explains the version skew.
- Acceptance gate: ≥ 95% of sessions on `v = 1` per Phase-M0
  telemetry.

### Phase M5 — Remove legacy sender path

- Delete the legacy `RatchetState::next_message_keys` *send* path.
- Keep the legacy *receive* path indefinitely so historical
  ciphertext remains decryptable on local search / export.
- This is a one-way door — see §7.

---

## 7. Rollback

Rollback is asymmetric:

| Phase reached | Can roll back to | Cost |
|---|---|---|
| M0 / M1 | M0 trivially | None — only telemetry shipped. |
| M2 | M1 by clearing the `crypto.dr_enabled` flag | New sessions go back to `v = 0`. Sessions already at `v = 1` keep working — no decrypt loss. |
| M3 | M1 | Same as M2 + the upgrade-button must be hidden or no-oped. |
| M4 | M3 | Bundle must republish `[0, 1]`. Sessions already negotiated at `v = 1` continue. **No** session is force-downgraded. |
| **M5** | **No automated rollback** | Sender path deleted. Re-introducing it requires a code revert, and any messages produced under `v = 1` after rollback would *succeed* but must use the still-shipped legacy receive path. This is the deliberate one-way door. |

The "no force downgrade" rule is critical: under no rollback path do
we re-encrypt or re-key existing ciphertext. Each session carries its
chain state alongside the negotiated `version`, so downgrade is a
*publish-time* decision, never a *decrypt-time* one.

### 7.1 Rollback testing requirement

Before M2 ships, the migration test suite MUST include a synthetic
"flip-flop" run: a session repeatedly toggles between version `v = 0`
and `v = 1` *only at session-creation boundaries*, never mid-session.
The test asserts:

1. No mid-session re-keying ever happens.
2. Both peers' decrypt success rate stays at 100%.
3. Skipped-message-key store stays bounded under `MAX_SKIPPED_TOTAL`.

---

## 8. Storage & Persistence

### 8.1 SQLCipher schema additions

Augment `crypto_sessions` (currently holds `CryptoSessionState`):

```sql
ALTER TABLE crypto_sessions ADD COLUMN version           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crypto_sessions ADD COLUMN dr_root_key       BLOB;            -- RK
ALTER TABLE crypto_sessions ADD COLUMN dr_self_priv      BLOB;            -- StaticSecret
ALTER TABLE crypto_sessions ADD COLUMN dr_self_pub       BLOB;            -- 32 B
ALTER TABLE crypto_sessions ADD COLUMN dr_peer_pub       BLOB;            -- 32 B, nullable
ALTER TABLE crypto_sessions ADD COLUMN dr_send_chain_key BLOB;            -- CKs
ALTER TABLE crypto_sessions ADD COLUMN dr_recv_chain_key BLOB;            -- CKr
ALTER TABLE crypto_sessions ADD COLUMN dr_ns             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crypto_sessions ADD COLUMN dr_nr             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crypto_sessions ADD COLUMN dr_pn             INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS crypto_skipped_keys (
    session_id   TEXT NOT NULL,
    dh_peer_pub  BLOB NOT NULL,
    counter      INTEGER NOT NULL,
    message_key  BLOB NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (session_id, dh_peer_pub, counter)
);
```

All existing `send_chain_key` / `recv_chain_key` / `*_counter`
columns stay populated for `version = 0` rows. `version = 1` rows
populate the `dr_*` columns instead. A row never has both populated
simultaneously — enforced by an integrity check at write time, not by
a CHECK constraint (we don't want to block an emergency forensic
re-write).

### 8.2 Zeroization

Every `BLOB` listed above holds key material. Rust `Drop` paths MUST
`zeroize` before drop, and the SQLCipher write path MUST overwrite
the previous row's bytes before issuing the new write (we can't trust
SQLite's page reuse to zero stale pages). The latter is implementation
guidance, not a wire change.

---

## 9. Acceptance Criteria

The upgrade is "done" only when **all** are true:

1. **Functional parity**: every existing chat test (friend, group,
   recall, edit-of-plaintext, multi-device echo, cold-load slicing)
   passes against `v = 1` sessions.
2. **PCS test**: a simulated chain-key snapshot at counter `n` is
   shown to *not* decrypt any message past the next direction change
   in either direction.
3. **OOO test**: 1000 messages dispatched in randomized order all
   decrypt; the 1001st triggers a bounded-skip eviction warning, not
   a panic.
4. **Edit test**: an edit applied at counter `n + 50` against a
   message originally at counter `n` produces ciphertext that
   decrypts on every active recipient device, and the original
   ciphertext is overwritten on Station with no remaining cleartext
   in the row.
5. **Telemetry**: ≥ 95% of active sessions report `version = 1` in
   Phase-M0-style telemetry.
6. **Audit**: an external review of `double_ratchet.rs` against the
   Signal spec — at minimum a code-walk by someone outside the
   immediate authors.

---

## 10. Open Questions

These MUST be resolved during M1 before any wire goes out:

1. **MAX_SKIP value.** Signal uses 1000. Our SSE delivery is
   currently in-order, but a planned offline-pull-back batch may
   deliver hundreds of buffered messages at reconnection. Decide
   whether 1000 is enough or whether per-session config is needed.
2. **MLS interaction.** Group chat is independently encrypted with
   MLS under federated-im D-08. Welcome and Commit delivery use the
   typed Station envelope and do not depend on the direct-message
   ratchet version.
3. **Multi-device backfill.** Adding a new device to an existing
   actor today re-runs X3DH against every active peer. Under DR this
   is naturally a fresh session at the highest mutually negotiated
   version. The open question is whether old ciphertext should be
   *re-encrypted* under the new session for delivery to the new
   device. Design recommendation: **no** — historical ciphertext
   stays under its original session, and the new device gets it via
   the existing encrypted-export-import path on the source device.
4. **Pre-key replenishment under DR.** Same protocol as today; no
   change. Listed for completeness so reviewers don't ask.

---

## 11. Out of Scope (Tracked Elsewhere)

- **Quantum-safe ratchet** (PQ3-style hybrid) — `pqc-roadmap.md`
  (not yet written).
- **MLS migration** for groups — referenced in parent doc §4.1; not
  affected by this upgrade.
- **Server-side moderation re-keying** — explicitly disallowed by
  the threat model (Station is untrusted). Listed only to head off
  the question.

---

## 12. References

- Perrin & Marlinspike, *The Double Ratchet Algorithm*, 2016.
- `docs/architecture/encryption/e2e-encryption-architecture.md` —
  parent E2E architecture document.
- `peers-chat/docs/architecture/realtime/event-stream.md` §2.7.2 —
  sealed signaling envelope (separate primitive, not affected).
- `peers-chat/model/domain/realtime/event.proto` — `MessageMutation`
  wire contract.
- `peers-chat/apps/desktop/src-tauri/src/domain/crypto/mod.rs` —
  current chain-only ratchet implementation that this upgrade
  replaces (the legacy receive path is preserved indefinitely).

# Group Chat Sender Keys — Design

> **SUPERSEDED (2026-07-11) by federated-im decision D-08 (group E2EE → MLS,
> RFC 9420).** Sender Keys / SKDM are removed under the v1 IM unification. This
> document is retained for history only; do not build new work on it. Current
> group E2EE decision: [`../federated-im/decisions.md`](../federated-im/decisions.md) (D-08).
>
> Design document. **No code lands until this doc is reviewed.**
>
> Companion to `e2e-encryption-architecture.md` (parent E2E
> architecture) and `chat-ratchet-upgrade.md` (friend-chat ratchet
> upgrade). This doc covers the group-chat side of the encryption
> story, which is currently *not* end-to-end encrypted despite a
> misleading set of dead Tauri commands implying otherwise.

---

## 1. Document Scope

This document defines:

- The **current real state** of group chat encryption — which is
  "plaintext on the wire and at rest on Station, with a small set
  of unreachable Rust stubs that pretend otherwise."
- The target protocol: **Sender Keys** (the Signal Group v2 model),
  scoped to small/medium federation groups (≤ 1000 members per the
  parent doc's choice).
- Distribution model: piggy-back on the existing pairwise friend-chat
  E2E channel — a sender key is treated like a normal friend-chat
  message body whose plaintext happens to be a serialized SKDM.
- Wire format additions to `model/domain/chat/group_chat.proto`,
  with field numbers reserved for backward compatibility.
- Rotation triggers (member add / remove / leave / device add) and
  the rules that make rotation *unforgeable* by Station.
- Migration strategy from plaintext groups to Sender Keys, including
  mixed-mode (some members capable, some not) handling.
- Acceptance criteria and the explicit rollback story.

This doc does **not** redefine:

- X3DH and friend-chat session establishment (parent doc §5.1–5.2).
- The friend-chat ratchet (chain-only today, Double Ratchet upgrade
  tracked in `chat-ratchet-upgrade.md`). SKDM distribution will
  inherit whichever ratchet version the pairwise friend session is
  on at the time the SKDM is sent.
- MLS — explicitly deferred per the parent doc §4.1.
- Multi-device key sync for the *same* actor (separate workstream).

---

## 2. Current State (Shipped, Reality vs. Appearance)

### 2.1 What's actually on the wire

Group `SendGroupMessageRequest` carries both `content` (plaintext)
and `encrypted_payload` (bytes). Today **only `content` is
populated end-to-end**:

- `apps/desktop/src/store/socialChat.ts` builds the request with
  plaintext `content` and an empty `encrypted_payload`.
- `apps/station/app/subserver/group_chat/handler.go` stores
  `content` in PostgreSQL as plaintext, fans it out plaintext over
  SSE.
- The `MessageMutation` path (recall / edit / delete, just landed)
  treats `content` as the canonical body.

### 2.2 What pretends otherwise

`apps/desktop/src-tauri/src/domain/crypto/mod.rs` ships a
`GroupKeyState` primitive plus three Tauri commands —
`crypto_group_encrypt`, `crypto_group_decrypt`,
`crypto_group_rotate_key` — and a SQLite table `crypto_group_keys`
in `infrastructure/local_chat_store.rs` storing per-device keys.

These are **architecturally broken** and are **not registered in
`main.rs`'s `tauri::generate_handler!` invocation**, meaning:

1. Calling them from JS would fail at runtime with "command not
   found." There are no JS callers anyway (verified by grep).
2. Even if registered, `GroupKeyState::generate(group_id)` produces
   a *fresh random key per device* with **no distribution
   mechanism**. Two members would each generate their own
   independent key for the same group; neither could decrypt the
   other's ciphertext.
3. The `epoch` field rotates locally, never published.

This is not "incomplete encryption." This is a stub that will give
a reviewer the false impression that group E2EE is "almost done."
The first deliverable of the cleanup commit (sibling of this doc)
is to **delete all of it** so the next reviewer is not misled.

### 2.3 What this gap costs us today

| Capability | Friend chat | Group chat |
|---|---|---|
| Station-blind body | YES (chain-only ratchet) | **NO** — Station reads every message. |
| Forward secrecy on body | PARTIAL (chain advance) | **NO** |
| Recall / edit / delete (MessageMutation) | YES (just landed) | YES, but Station sees both before/after. |
| Identity-verified sender | YES (X3DH + IK) | NO — only the sender DID, no per-message signature today. |
| Member-add / member-remove key rotation | n/a (1-on-1) | NO — never had a group key to rotate. |

The combination of "Station reads everything" + "MessageMutation
is now real-time across devices" means a compromised Station can
silently substitute group message content with a near-zero
detection surface. Closing this is the goal.

---

## 3. Threat Model

Same trust model as the parent doc §3 (Station is untrusted, the
user device is trusted). Group-specific threats:

| Adversary | Capability | Mitigation |
|---|---|---|
| **G1 — Compromised Station, group fan-out path** | Reads / modifies group `content` and `encrypted_payload` in transit and at rest. | Sender Keys: Station only ever sees opaque ciphertext keyed under per-sender keys it does not hold. Per-message signature by sender's IK detects substitution. |
| **G2 — Removed member with cached SK** | After removal still holds last sender keys it received. | Forced rotation on remove. The post-remove epoch's SKs are distributed only to remaining members, encrypted under fresh pairwise channels. The removed member sees ciphertext it cannot decrypt going forward. |
| **G3 — Member device add (legitimate)** | The new device needs to join the keyed conversation without a server-side re-keying that exposes plaintext. | New device runs X3DH against every other group member (parent doc multi-device path, separate workstream) and waits for each member to send a fresh SKDM addressed to it. We do *not* re-encrypt history; the new device sees history as opaque starting from the rotation point. |
| **G4 — Forged SKDM injection** | Adversary publishes a `SenderKeyDistributionMessage` claiming to be from member X. | SKDM is delivered *inside* the sender's pairwise friend-chat E2E channel to each recipient — Station cannot inject one without first impersonating X over X3DH, which IK signature verification detects. |
| **G5 — Replay / OOO of sender messages** | Adversary reorders or replays group messages within a sender's chain. | Sender chain has a strictly-incrementing counter under AEAD AAD; receivers reject duplicate counters. Skipped-key tolerance up to `MAX_SKIP = 1000` per sender chain (matches DR). |
| **G6 — Cross-group key reuse** | Same member is in groups A and B, adversary tricks ciphertext from A into B. | Sender chain identifier includes the group ULID. AAD binds `(group_ulid, sender_did, sender_key_id, n)` so a swap fails AEAD verification. |

### 3.1 Out of scope

- Membership-list integrity beyond what GORM enforces today. A
  follow-up doc on group-state authentication (signed membership
  manifests) is tracked but separate.
- Anonymous group membership (always out — sender DID is part of
  the wire format on purpose for moderation).

---

## 4. Target Design — Sender Keys (Signal Group v2)

### 4.1 Per-sender state

For every `(group_ulid, sender_did)` pair each member maintains a
**SenderKeyState**:

```rust
pub struct SenderKeyState {
    group_ulid:    String,
    sender_did:    String,           // who owns this chain
    sender_key_id: u32,              // bumps on the owning sender's local rotation
    chain_key:     [u8; 32],         // hash-ratchet chain
    counter:       u32,              // strictly increasing
    sender_sig_pub: [u8; 32],        // Ed25519, used to verify each msg
    // Owner-only fields (Some when sender_did == self)
    sender_sig_priv: Option<SigningKey>,
}
```

The sender's chain ratchet is **hash-only** (no DH ratchet), same
as the existing chain-only friend ratchet:

```
MK_n  = HKDF(chain_key, info=b"sk-msg",   counter, L=32+12)
        // {enc_key, nonce}
chain = HKDF(chain_key, info=b"sk-chain", b"advance", L=32)
```

This is a deliberate trade-off — group chat does not get post-
compromise security on the *sender's own* chain compromise. We
gain it back via:

1. **Forced rotation** on member-set change.
2. **User-triggered rotation** ("Reset group encryption" UI affordance).
3. The friend-chat DR upgrade (separate doc) brings PCS to the
   *distribution* channel, which is what an attacker would need to
   exploit to inject a poisoned SKDM in the first place.

### 4.2 Per-message wire format

A new oneof body inside `GroupMessage.encrypted_payload`:

```protobuf
// Lives inside GroupMessage.encrypted_payload, NOT as a top-level
// message — Station treats encrypted_payload as opaque bytes today
// and we want that to stay true.
message GroupCiphertext {
    uint32 version       = 1;   // 1 = sender-keys v1; 0 means legacy plaintext-in-content (no row should ever set 0 here, it stays implicit by `encrypted_payload == empty`)
    string sender_key_id_owner = 2; // sender_did
    uint32 sender_key_id  = 3;
    uint32 counter        = 4;
    bytes  ciphertext     = 5;
    bytes  signature      = 6;   // Ed25519 over (group_ulid || sender_did || sender_key_id || counter || ciphertext)
}
```

AAD for AES-GCM:
```
AAD := group_ulid || 0x1F || sender_did || 0x1F || sender_key_id (4B BE) || 0x1F || counter (4B BE)
```

The `signature` field defends against a colluding co-member who
holds the same chain state as the sender — without a per-message
signature, a member could forge messages "as" another member by
re-using the sender's chain. Signal's spec calls this out
explicitly.

### 4.3 SenderKeyDistributionMessage (SKDM)

Owner of a chain, when starting it OR after a forced rotation,
must send each remaining group member:

```protobuf
message SenderKeyDistributionMessage {
    string group_ulid     = 1;
    string sender_did     = 2;
    uint32 sender_key_id  = 3;
    bytes  chain_key      = 4;   // 32 B, the seed of the hash chain
    uint32 counter        = 5;   // usually 0; non-zero on partial recovery
    bytes  sender_sig_pub = 6;   // 32 B Ed25519, used to verify each msg
    // (sender_sig_priv stays local — never on the wire)
}
```

Distribution mechanism: the SKDM is the *plaintext body* of a
**friend-chat message** addressed to the recipient, marked with a
control type so the recipient's friend-chat handler routes it to
the group SK store instead of rendering it.

This means SKDM rides on whatever encryption the pairwise friend
session has — which is X3DH-derived chain-only today, and X3DH +
DR after the chat-ratchet upgrade lands. We get for free:

- Identity authentication of the SKDM sender (X3DH bound to IK).
- Per-recipient delivery without Station learning the chain key.
- Replay / reorder protection from the friend-chat ratchet.

A new control type is added to friend chat:

```
FriendMessageType.SENDER_KEY_DISTRIBUTION = 50
```

The body is `bytes` containing the encoded `SenderKeyDistributionMessage`.
Receivers MUST drop these messages from the visible chat history
on the destination *before* persisting to the local SQLCipher
chat store.

### 4.4 Bootstrap flow (new group)

```
Creator                              Each member i
  │                                       │
  │── CreateGroup(...members) ───────────>│ (Station persists membership)
  │                                       │
  │── Generate SenderKeyState(self) ──────│
  │── For each member i (excluding self): │
  │     SKDM_i = SenderKeyDistributionMessage{...}
  │     Send via friend chat to i (control type SKD)
  │                                       │
  │                                       │── On receive SKD:
  │                                       │   verify signed_by sender,
  │                                       │   store SenderKeyState(remote)
  │                                       │── Generate own SenderKeyState(self)
  │                                       │── Send own SKDM to all other members
  │                                       │   (including the original creator)
```

This is `O(n²)` SKDMs at group creation — acceptable for ≤ 1000
members per the parent doc's bound. For a 50-member group,
`50 × 49 = 2450` friend-chat control messages, batched and
prioritized below user messages.

### 4.5 Send / receive flows

**Sending a group message:**

```
1. Look up SenderKeyState(self, group_ulid) — generate + distribute
   if missing.
2. (enc_key, nonce) = HKDF(chain_key, "sk-msg", counter)
3. ciphertext = AES-256-GCM(enc_key, nonce, plaintext, AAD)
4. signature  = Ed25519(sender_sig_priv, group_ulid || ... || ciphertext)
5. chain_key  = HKDF(chain_key, "sk-chain", "advance")
6. counter   += 1
7. Wire: GroupMessage{ encrypted_payload = encode(GroupCiphertext{...}), content = "" }
```

**Receiving a group message:**

```
1. Decode GroupCiphertext from encrypted_payload.
2. Verify signature against stored sender_sig_pub for that sender_key_id.
   Mismatch → drop, surface a warning ("possibly forged").
3. Look up SenderKeyState(sender_did, sender_key_id, group_ulid).
4. Fast-forward chain to ciphertext.counter — caching skipped MKs
   in a bounded skipped-key store (size MAX_SKIPPED_PER_SENDER = 1000).
5. AES-256-GCM decrypt with derived MK and same AAD.
6. Surface plaintext to UI; index in local FTS5 (parent doc §6.1).
```

### 4.6 Rotation triggers

| Trigger | Action |
|---|---|
| Member added | Every existing member generates a *new* SenderKeyState (sender_key_id += 1) and sends fresh SKDMs to all members **including the new one**. Old chain keys are zeroized. |
| Member removed / leaves | Same as above, but SKDMs are only sent to remaining members. Old chains are zeroized. The removed member retains historical SKs for messages they were entitled to read; future ciphertext is unreadable to them. |
| Owner-triggered "Reset group encryption" | Same as member-removed but no membership change. Used after suspected compromise. |
| **Not a trigger** — sender's local `MAX_COUNTER` reached | Treated as an internal hard error; message send fails with a "Reset group encryption" suggestion. We do NOT silently auto-rotate because that would create a covert channel for forged rotations. |

---

## 5. Migration Strategy

### Phase G0 — Telemetry only

- Counter on every group message that decrypts via the (new)
  `version=1` arm vs. `content`-as-plaintext.
- Goal: measure how fast Sender Keys penetrates in real groups
  before flipping any UI behavior.

### Phase G1 — Implement SK behind a kill switch

- Land `domain/crypto/sender_keys.rs`.
- Add `GroupCiphertext` proto field to `GroupMessage.encrypted_payload`
  schema (Station side stays opaque-bytes-pass-through, but the
  proto file documents the format).
- Add `SenderKeyDistributionMessage` and the
  `FriendMessageType.SENDER_KEY_DISTRIBUTION` control type.
- Send path stays plaintext by default; encryption is gated on a
  `crypto.group_sk_enabled` runtime flag.
- Receive path is dual-mode: if `encrypted_payload` is empty, decode
  as `content` plaintext; if not, decode as `GroupCiphertext`.
- Internal QA only.

### Phase G2 — Opt-in per group

- Group settings UI: "Enable end-to-end encryption for this group."
- Flipping it on triggers: every member's client generates SK and
  starts SKDM distribution. The setting is permanent for the group
  (no toggle-off — once a group ratchets up, history before the
  switch stays plaintext and history after stays SK).
- New groups created in G2+ default to E2EE on.
- Acceptance gate: zero net-new bug regressions over 2 release
  cycles AND no group with `encryption_enabled = true` falls back
  to plaintext silently (would surface as a station-side write
  rejection, see §6).

### Phase G3 — User-triggered re-key UI

- "Reset encryption" button per group, runs the rotation flow from
  §4.6.
- Required for post-compromise recovery and for repairing a group
  whose SKDM distribution failed for a subset of members.

### Phase G4 — Default-on for all new groups

- The "enable encryption" toggle disappears for newly created groups
  — they all start at SK-on.
- Existing plaintext groups stay plaintext until owner explicitly
  upgrades (one-way).

### Phase G5 — Deprecate plaintext send path

- Group `SendMessage` handler on Station rejects requests with
  `content != "" && encrypted_payload == empty` for groups whose
  membership manifest carries `encryption_enabled = true`.
- Receive path keeps reading legacy plaintext rows forever (so old
  history stays searchable).

---

## 6. Server-Side Constraints

Station MUST NOT:

- Decode `encrypted_payload` bytes (treat as opaque).
- Re-encrypt or modify ciphertext on rotation.
- Auto-rotate keys on membership change (rotation is client-driven).
- Leak `encrypted_payload` bytes via the search index — search is
  client-only on decrypted plaintext (parent doc §6.1).

Station MAY:

- Persist the `encryption_enabled` flag on the group row to inform
  the G5 reject-plaintext-send rule.
- Expose a per-group "members who have a recent SKDM from me"
  *count* for UI debugging — but not the SKDM bytes themselves.

---

## 7. Acceptance Criteria

The upgrade is "done" only when **all** are true:

1. **Functional parity**: every existing group test (send, list,
   recall, edit, delete, MessageMutation real-time fan-out)
   passes against `version=1` ciphertext.
2. **Substitution defense**: a unit test forges a `GroupCiphertext`
   with a swapped `signature` byte; receivers reject with a
   surfaced warning and do NOT fall back to plaintext.
3. **Cross-group AAD bind**: a unit test takes a valid
   `GroupCiphertext` from group A and replays it as group B's
   payload; AEAD decrypt fails.
4. **Rotation correctness**: a member-remove triggers fresh SKs on
   all remaining members; the removed member's last cached SK
   cannot decrypt anything sent post-rotation.
5. **OOO tolerance**: 1000 messages dispatched OOO from one sender
   all decrypt; the 1001st triggers a bounded-skip eviction
   warning, not a panic.
6. **No silent fallback**: a group with `encryption_enabled=true`
   never displays a plaintext message rendered from `content` —
   such a row surfaces as "format error, message hidden."
7. **Telemetry**: ≥ 95% of active group messages report
   `version=1` per Phase-G0 telemetry.

---

## 8. Rollback

Same shape as the chat-ratchet-upgrade rollback matrix: G0..G4 are
reversible by clearing the `crypto.group_sk_enabled` flag and
hiding the per-group toggle in UI. **G5 is the one-way door** —
once the Station-side reject-plaintext-send rule is enforced,
rolling back requires a Station release.

The "no silent fallback" rule (§7.6) is what makes rollback safe
at every other phase: a downgrade from G4 → G3 means new groups
can choose plaintext again, but groups already on SK stay on SK
forever. There is no path that silently re-keys an existing group.

---

## 9. Interaction With Other Workstreams

| Workstream | Interaction |
|---|---|
| Chat ratchet upgrade (DR) | SKDM rides on the pairwise friend-chat session. SKDM delivery uses whatever ratchet `version` the friend session negotiated. No code coupling, but the migration tests MUST cover "SKDM via v=0 friend session" AND "SKDM via v=1 friend session." |
| Multi-device key sync | A new device joining an existing actor must wait for fresh SKDMs from every group member — this is not a Station push, it's per-friend-channel delivery. The owner's other devices share their own SKs via a separate intra-actor sync channel (separate workstream). |
| MessageMutation (recall/edit/delete) | Mutations apply to the *row*, not the chain. Editing a SK message mints a new ciphertext at the current `counter`, just like any other send. No re-issuing of historical chain keys. |
| OSS attachments | Attachment bytes stay encrypted under a per-attachment AES key derived from the SK — see follow-up `oss-encryption.md` (not yet written). |

---

## 10. Open Questions

1. **`MAX_SKIP` per sender chain.** Default to 1000 (matches DR
   choice). Revisit if real-group telemetry shows we need higher.
2. **SKDM batching.** O(n²) at group creation can be smoothed by
   batching SKDMs into a single friend-chat envelope per recipient
   — design TBD, does not block G1.
3. **Membership manifest signing.** Today Station is the source of
   truth for group membership. A long-term goal is a signed
   manifest carried in-band; out of scope for this doc but
   referenced because it would close G4 fully.
4. **Local DB schema.** The dead `crypto_group_keys` table is
   removed in the cleanup commit. The new SK store needs schemas
   for `group_sender_keys` (per-chain state) and
   `group_skipped_message_keys` (OOO buffer); design pinned in G1
   PR review, not here.

---

## 11. Out of Scope (Tracked Elsewhere)

- MLS migration for very large groups — parent doc §4.1.
- Quantum-safe SK chain — `pqc-roadmap.md` (not yet written).
- Anonymous group membership — explicitly out (see §3.1).

---

## 12. References

- Perrin & Marlinspike, *The Sesame Algorithm*, 2017 (multi-device
  + group context for Signal).
- Signal Sender Keys background: <https://signal.org/docs/specifications/sesame/>
- `e2e-encryption-architecture.md` §4.1, §5.4 — parent E2E
  architecture.
- `chat-ratchet-upgrade.md` — friend-chat ratchet upgrade (the
  pairwise channel that SKDM rides on).
- `peers-chat/model/domain/chat/group_chat.proto` — current group
  message schema (`encrypted_payload` field already present at
  field number 14 / 8).
- `peers-chat/apps/desktop/src-tauri/src/domain/crypto/mod.rs` —
  the dead `GroupKeyState` primitive removed in the sibling
  cleanup commit.

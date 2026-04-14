# E2E Encryption & Storage Encryption Architecture

> End-to-end encryption and at-rest storage encryption for Peers-Touch chat.
> Defines cryptographic protocol, key hierarchy, implementation plan per layer, migration strategy, and operational constraints.

---

## 1. Document Scope

This document defines:

- Cryptographic protocol selection and rationale
- Key hierarchy (identity, session, ephemeral)
- Key lifecycle (generation, distribution, rotation, revocation)
- Encryption flow for friend chat (1-on-1) and group chat
- Storage encryption model (at-rest, in-transit, E2E)
- Implementation architecture per layer (Station Go, Desktop Rust, Desktop TS)
- Migration strategy from plaintext to E2E
- Threat model and trust boundaries

This document does not define:

- Transport-layer TLS configuration (already handled by reqwest/rustls and libp2p)
- OAuth2 token security (see `global/coding-guide/common/security.md`)
- Full cryptographic library implementation (we use audited libraries)

---

## 2. Problem Statement

### 2.1 Current State

| Layer | Status |
|-------|--------|
| Transport | HTTPS (rustls) for Desktop↔Station; libp2p/Noise for P2P transport |
| Station storage | **Plaintext** content in PostgreSQL (`content TEXT`) |
| Desktop storage | **SQLCipher L2** (encrypted SQLite), but key generation uses deterministic string, not CSPRNG |
| Wire format | **Plaintext** JSON over HTTPS. Proto reserves `encrypted_payload` but unused |
| Key management | No identity keypair per actor. `key_fingerprint` field in ActorProfile proto exists but is empty |
| E2E | **None**. Station sees all message content |

### 2.2 Design Goals

1. **Station-blind**: Station relays ciphertext. It cannot read message content.
2. **Forward secrecy**: Compromising a long-term key does not expose past messages.
3. **Post-compromise security**: After a key compromise, security is restored after a few message rounds.
4. **Multi-device ready**: Architecture supports future multi-device key synchronization.
5. **Searchable locally**: Client decrypts → indexes locally for search. Station cannot search content.
6. **Incremental migration**: System can operate in mixed mode (some conversations encrypted, others not) during rollout.

---

## 3. Threat Model

### 3.1 Trust Boundaries

```
┌─────────────────────────────────────────────────┐
│  TRUSTED ZONE (user's device)                   │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ Desktop App   │  │ Encrypted Local Store  │  │
│  │ (Rust + TS)   │  │ (SQLCipher L2)         │  │
│  │ - Private keys│  │ - Decrypted index      │  │
│  │ - Plaintext   │  │ - Key material         │  │
│  └───────┬───────┘  └────────────────────────┘  │
│          │                                      │
└──────────┼──────────────────────────────────────┘
           │ ciphertext only
┌──────────┼──────────────────────────────────────┐
│  UNTRUSTED ZONE (Station server)                │
│  ┌───────▼───────┐  ┌────────────────────────┐  │
│  │ friend_chat   │  │ PostgreSQL             │  │
│  │ group_chat    │  │ - encrypted_payload    │  │
│  │ (relay only)  │  │ - public keys          │  │
│  └───────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 3.2 Adversary Model

| Adversary | Capability | Mitigation |
|-----------|-----------|------------|
| Passive network observer | Read all traffic | TLS (already), E2E payload |
| Compromised Station | Read DB, modify relay | E2E: Station only sees ciphertext; signatures prevent tampering |
| Stolen device (locked) | Physical access, no unlock | SQLCipher L2 + OS keyring for key material |
| Stolen device (unlocked) | Full filesystem access | Key material in OS keyring (not filesystem); session timeout |
| Compromised long-term key | Impersonate user | Forward secrecy limits exposure; key rotation + revocation |

---

## 4. Cryptographic Protocol

### 4.1 Protocol Selection

| Chat Type | Protocol | Rationale |
|-----------|----------|-----------|
| Friend (1-on-1) | **X3DH + Double Ratchet** (Signal Protocol) | Proven, audited, perfect for 1-on-1. Forward secrecy + post-compromise security. |
| Group | **Sender Keys** (Signal Groups v2) | Simpler than MLS for moderate group sizes. Each member maintains a sender key distributed to group members via pairwise channels. |

**Why not MLS (RFC 9420)?** MLS is architecturally superior for large groups but adds significant complexity (tree-based key agreement, commit/proposal protocol). Sender Keys is sufficient for groups up to ~1000 members and can be upgraded to MLS later without changing the wire format.

### 4.2 Primitive Selection

| Primitive | Algorithm | Library |
|-----------|-----------|---------|
| Key agreement | X25519 (Curve25519 ECDH) | `x25519-dalek` (Rust) |
| Signing | Ed25519 | `ed25519-dalek` (Rust) |
| Symmetric encryption | AES-256-GCM | `aes-gcm` (Rust) |
| Key derivation | HKDF-SHA-256 | `hkdf` + `sha2` (Rust) |
| Hash | SHA-256 | `sha2` (Rust) |
| Random | OS CSPRNG | `rand` (Rust) |

### 4.3 Key Hierarchy

```
Identity Key (IK)
├── Ed25519 signing key (long-term, stored in OS keyring)
├── X25519 key agreement key (derived from IK)
│
├── Signed Pre-Key (SPK)
│   ├── X25519 keypair (rotated weekly)
│   ├── Signature by IK (proves ownership)
│   └── Uploaded to Station as public key bundle
│
├── One-Time Pre-Keys (OPK)
│   ├── X25519 keypairs (batch of 100, consumed on use)
│   └── Uploaded to Station, deleted after fetch
│
└── Session Keys (per conversation)
    ├── Root Key → Chain Key → Message Key (Double Ratchet)
    ├── Ratcheted on each DH exchange
    └── Stored in encrypted local DB
```

---

## 5. Protocol Flows

### 5.1 Key Registration (First Login / Key Rotation)

```
Desktop                        Station
  │                              │
  │── Generate IK (Ed25519) ────│
  │── Generate SPK (X25519) ────│
  │── Sign SPK with IK ────────│
  │── Generate 100 OPKs ───────│
  │                              │
  │── POST /keys/bundle ───────>│  Store: {did, ik_pub, spk_pub, spk_sig, opk_pubs[]}
  │<── 200 OK ──────────────────│
  │                              │
  │── Store IK private in       │
  │   OS keyring                 │
  │── Store SPK/OPK privates    │
  │   in encrypted local DB      │
```

### 5.2 Initial Key Exchange (X3DH) — Friend Chat

```
Alice (sender)                 Station                      Bob (receiver)
  │                              │                              │
  │── GET /keys/bundle/{bob} ──>│                              │
  │<── {IK_B, SPK_B, OPK_B} ───│                              │
  │                              │── Delete used OPK_B ────────│
  │                              │                              │
  │── X3DH:                      │                              │
  │   DH1 = DH(IK_A, SPK_B)     │                              │
  │   DH2 = DH(EK_A, IK_B)      │                              │
  │   DH3 = DH(EK_A, SPK_B)     │                              │
  │   DH4 = DH(EK_A, OPK_B)     │                              │
  │   SK = KDF(DH1‖DH2‖DH3‖DH4) │                              │
  │                              │                              │
  │── Init Double Ratchet(SK) ──│                              │
  │── Encrypt(msg, ratchet) ────│                              │
  │                              │                              │
  │── POST /friend-chat/message/send ─>│                       │
  │   {encrypted_payload, ek_pub,       │── Relay ────────────>│
  │    ik_fingerprint}                  │                       │
  │                              │                              │── X3DH(SK)
  │                              │                              │── Init Ratchet
  │                              │                              │── Decrypt(msg)
```

### 5.3 Subsequent Messages (Double Ratchet)

After X3DH establishes the shared secret, every message uses the Double Ratchet:

1. **Sending**: Ratchet forward → derive message key → AES-256-GCM encrypt → send `{ciphertext, nonce, ratchet_header}`
2. **Receiving**: Process ratchet header → derive same message key → decrypt
3. **DH Ratchet step**: On each reply direction change, a new DH exchange ratchets the root key forward (forward secrecy)

### 5.4 Group Chat (Sender Keys)

```
Creator                        Station                      Members
  │                              │                              │
  │── Create group ─────────────>│                              │
  │── For each member:           │                              │
  │   Generate SenderKey(SK_A)   │                              │
  │   Encrypt SK_A with pairwise │                              │
  │   session to each member     │                              │
  │── Send encrypted SK_A ──────>│── Distribute ──────────────>│
  │                              │                              │── Decrypt SK_A
  │                              │                              │── Store SK_A for Alice
  │                              │                              │
  │── Encrypt(msg, SK_A) ───────>│── Fan out ─────────────────>│
  │                              │                              │── Decrypt with SK_A
```

- Each member generates their own sender key and distributes it to all group members via pairwise E2E channels.
- When a member is removed, all remaining members rotate their sender keys.
- Sender keys are ratcheted forward (hash ratchet) for forward secrecy within a sender's chain.

---

## 6. Storage Encryption Model

### 6.1 Encryption Levels (Revised)

| Level | Scope | Protection | Implementation |
|-------|-------|-----------|----------------|
| **L0** | Public data, settings | None | Plain SQLite / JSON |
| **L1** | User preferences, UI state | App-level obfuscation | AES key from app secret |
| **L2** | Chat messages (local cache), keys | SQLCipher + CSPRNG key in OS keyring | **Fix**: replace deterministic key gen with `rand::rngs::OsRng` |
| **L3** | Message content on wire/server | E2E encrypted | Only conversation participants can decrypt |

### 6.2 Critical Fix: Key Generation

Current `generate_key_material` builds key bytes from a deterministic string:

```rust
// INSECURE — current implementation
let bytes = format!("pt:{}:{key_ref}:{key_version}:{ts}", Self::backend_name()).into_bytes();
```

**Required fix**:

```rust
use rand::RngCore;

fn generate_key_material(key_ref: &str, key_version: i32) -> KeyMaterial {
    let mut key_bytes = vec![0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key_bytes);
    KeyMaterial {
        key_id: key_ref.to_string(),
        key_version,
        key_bytes,
    }
}
```

### 6.3 Key Storage

| Key Type | Storage Location | Protection |
|----------|-----------------|-----------|
| Identity private key (Ed25519) | OS Keyring (`keyring` crate) | OS-level access control |
| Pre-key private keys | Encrypted local DB (L2) | SQLCipher |
| Session ratchet state | Encrypted local DB (L2) | SQLCipher |
| Decrypted message index | Encrypted local DB (L2, FTS5) | SQLCipher |

---

## 7. Implementation Architecture

### 7.1 Station Go — Key Distribution Server

**New subserver: `key_exchange`**

```
apps/station/app/subserver/key_exchange/
├── domain/
│   └── types.go          # KeyBundle, PreKey, IdentityKey
├── infrastructure/
│   └── repo.go           # GORM models for key storage
├── application/
│   └── service.go        # Key bundle CRUD, OPK consumption
├── handler.go            # HTTP handlers
└── subserver.go          # Registration
```

**API Surface:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/keys/bundle` | Upload key bundle (IK pub, SPK pub+sig, OPK pubs) |
| GET | `/keys/bundle/{did}` | Fetch key bundle for a DID (consumes one OPK) |
| POST | `/keys/replenish` | Upload additional OPKs when supply runs low |
| GET | `/keys/count` | Check remaining OPK count |

**DB Schema:**

```sql
CREATE TABLE identity_keys (
    actor_did       TEXT PRIMARY KEY,
    ik_public       BYTEA NOT NULL,
    key_fingerprint TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE signed_pre_keys (
    id              SERIAL PRIMARY KEY,
    actor_did       TEXT NOT NULL REFERENCES identity_keys(actor_did),
    spk_id          INTEGER NOT NULL,
    spk_public      BYTEA NOT NULL,
    spk_signature   BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    UNIQUE(actor_did, spk_id)
);

CREATE TABLE one_time_pre_keys (
    id              SERIAL PRIMARY KEY,
    actor_did       TEXT NOT NULL REFERENCES identity_keys(actor_did),
    opk_id          INTEGER NOT NULL,
    opk_public      BYTEA NOT NULL,
    consumed        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL,
    UNIQUE(actor_did, opk_id)
);
```

**friend_chat and group_chat changes:**

- `SendMessageRequest` proto already has `encrypted_payload` field
- Handler stores `encrypted_payload` instead of `content` when E2E is active
- Response returns `encrypted_payload` (client decrypts)
- `content` field becomes empty or contains a placeholder for non-E2E-capable clients

### 7.2 Desktop Rust — Crypto Engine

**New module: `crypto_engine`**

```
apps/desktop/src-tauri/src/domain/crypto/
├── mod.rs
├── identity.rs       # Identity key generation, storage, fingerprint
├── x3dh.rs           # X3DH key agreement
├── double_ratchet.rs # Double Ratchet implementation
├── sender_keys.rs    # Group chat sender key management
├── primitives.rs     # AES-GCM, HKDF, X25519 wrappers
└── session_store.rs  # Encrypted session state persistence
```

**New Cargo.toml dependencies:**

```toml
x25519-dalek = { version = "2", features = ["static_secrets"] }
ed25519-dalek = { version = "2", features = ["rand_core"] }
aes-gcm = "0.10"
hkdf = "0.12"
sha2 = "0.10"
rand = "0.8"
zeroize = { version = "1", features = ["derive"] }
```

**Tauri Commands:**

| Command | Description |
|---------|-------------|
| `crypto_generate_identity` | Generate and store identity keypair |
| `crypto_get_fingerprint` | Get own key fingerprint for verification |
| `crypto_verify_fingerprint` | Verify a peer's fingerprint |
| `crypto_encrypt_message` | Encrypt a message for a friend session |
| `crypto_decrypt_message` | Decrypt a received message |
| `crypto_init_group_sender_key` | Generate and distribute group sender key |

### 7.3 Desktop TS — UI Integration

**Encryption indicators:**

- Lock icon on encrypted conversations
- Key fingerprint display in ChatDetailPanel
- "Verify Identity" flow (compare fingerprints)
- Warning banner for unverified contacts

**Message flow change:**

```typescript
// Before (plaintext)
await api.friendChatSendMessage(sessionUlid, receiverDid, content, type);

// After (E2E)
const encrypted = await api.cryptoEncryptMessage(sessionUlid, content);
await api.friendChatSendMessage(sessionUlid, receiverDid, '', type, undefined, undefined, encrypted);
```

---

## 8. Migration Strategy

### Phase 1: Fix Storage Security (Week 1)

- [ ] Replace deterministic key gen with CSPRNG in `key_provider.rs`
- [ ] Add `zeroize` to sensitive key material in memory
- [ ] Audit keyring usage for proper key lifecycle

### Phase 2: Identity Key Infrastructure (Week 2-3)

- [ ] Add `key_exchange` subserver to Station
- [ ] Implement identity keypair generation in Desktop Rust
- [ ] Store IK private in OS keyring, public on Station
- [ ] Populate `key_fingerprint` on ActorProfile
- [ ] UI: show fingerprint in profile settings

### Phase 3: Friend Chat E2E (Week 4-6)

- [ ] Implement X3DH key agreement
- [ ] Implement Double Ratchet
- [ ] Add `encrypted_payload` path in friend_chat handler
- [ ] Desktop: encrypt before send, decrypt after receive
- [ ] Local FTS5 index from decrypted content
- [ ] Migration: new messages encrypted, old messages remain plaintext
- [ ] UI: encryption indicator on messages

### Phase 4: Group Chat E2E (Week 7-8)

- [ ] Implement Sender Keys distribution
- [ ] Key rotation on member add/remove
- [ ] Group message encrypt/decrypt path
- [ ] Same local indexing pattern as friend chat

### Phase 5: Verification & Hardening (Week 9-10)

- [ ] Safety number comparison UI
- [ ] Key change notification
- [ ] Session recovery after device reset
- [ ] Security audit of crypto implementation

---

## 9. Constraints

1. **No homebrew crypto** — Use audited libraries only (`*-dalek`, `aes-gcm`, `hkdf`)
2. **Key material never logs** — AGENTS.md: "Never log tokens, passwords, secret keys"
3. **Zeroize on drop** — All key material must implement `Zeroize`
4. **Station is untrusted** — Station must never have access to plaintext message content or private keys
5. **Backward compatible** — Unencrypted messages remain readable during migration
6. **Proto-first** — All new wire types defined in `model/domain/` proto files first

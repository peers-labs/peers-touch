# Post-Quantum Cryptography (PQC) Roadmap

> Roadmap document. **No wire or storage changes land until Phase 1 is
> explicitly approved and sequenced after the Double Ratchet upgrade.**
>
> Companion to `e2e-encryption-architecture.md`, `chat-ratchet-upgrade.md`
> (friend-chat X3DH negotiation + `EncryptedMessage` versioning), and
> `group-sender-keys.md` (Sender Keys, SKDM, `GroupCiphertext`). This doc
> tracks *when* and *how* Peers-Touch adopts NIST-standardized PQC
> (ML-KEM / ML-DSA / SLH-DSA) while preserving interoperability with
> classical peers during a long hybrid window.

---

## 1. Document Scope

This document defines:

- The **quantum-relevant threat model** for Peers-Touch (harvest-now,
  decrypt-later; Cryptographically Relevant Quantum Computer, CRQC).
- **Which plaintext surfaces remain vulnerable** while the stack stays
  purely classical, and why X25519 / Ed25519 / X3DH are not sufficient
  against a CRQC adversary.
- **Phased hybrid migration** from classical-only crypto to hybrid KEM
  + hybrid signatures, and eventually optional PQC-only policy.
- **Wire-format and storage hooks** already reserved versus gaps that
  require breaking proto or envelope changes.
- **Size and performance budgets** for ML-KEM-768 and ML-DSA-65 on
  mobile, desktop, and Station key-fetch paths.
- **Implementation and audit candidates** (Rust crates, WebCrypto
  constraints, FIPS-validated modules).
- **Trigger conditions** for starting Phase 1 engineering, including hard
  dependencies on the chat ratchet upgrade.

This document does **not** redefine:

- The Double Ratchet or chain-only friend ratchet (`chat-ratchet-upgrade.md`).
- Sender Keys message flows, rotation rules, or SKDM transport
  (`group-sender-keys.md`).
- MLS, OSS attachment encryption, or multi-device intra-actor sync.

---

## 2. Threat Model and Motivation

### 2.1 Harvest now, decrypt later

We model a **passive-but-patient state-level adversary** that records
ciphertext and public material *today* and retains it for years. When a
CRQC (or equivalent breakthrough) arrives, the adversary breaks **classical
public-key assumptions** and derives historical ECDH / ECDLP-style
secrets from recorded handshake transcripts.

Peers-Touch must assume such an adversary can capture:

- Long-lived **group archives** encrypted under Sender Keys: ciphertext
  in `GroupMessage.encrypted_payload` plus routing metadata.
- **1:1 chat history** protected by the friend-chat ratchet (chain-only
  today; Double Ratchet after `chat-ratchet-upgrade.md` lands): every
  `FriendChatMessage.encrypted_payload` frame transiting Station or
  federation relays.
- **Federation and relay envelopes**: server-to-server forwarding must
  be treated as an additional passive tap surface even though clients
  are client-unaware (see `peers-chat/docs/architecture/realtime/event-stream.md` §1.6).
- **Identity and pre-key bundles**: X25519 material uploaded via
  `FetchKeyBundleResponse` / `UploadKeyBundleRequest`
  (`key_exchange.proto`) and Ed25519 identity keys advertised to peers.

The goal of PQC migration is **not** to defeat endpoint compromise or
legal compulsion; it is to ensure that **recorded classical handshake
material + recorded ciphertext** does not reduce to bulk historical
plaintext decryption once CRQC becomes available.

### 2.2 Why classical X25519 / Ed25519 / X3DH fall short under CRQC

X3DH derives a shared secret from X25519 DH outputs. Shor-class attacks
break the **hidden logarithm** problem underlying X25519 given a large
quantum computer. Long-term **Ed25519 signatures** on bundles are
similarly vulnerable to forgery under the same class of attacks once
public keys and signatures are recorded.

Symmetric primitives (AES-256-GCM, SHA-256, HKDF) are not the weak
link: Grover search shaves effective symmetric strength roughly in half
(bit-for-bit), and our key sizes keep margin for that transition.

**NIST-standardized targets** (FIPS 2024 suite) anchor this roadmap:

| Standard | Algorithm family (informal) | Role in this roadmap |
|---|---|---|
| **FIPS 203 — ML-KEM** | Kyber-derived KEM | Hybrid key encapsulation at X3DH / session bootstrap |
| **FIPS 204 — ML-DSA** | Dilithium-derived signatures | Hybrid identity / SKDM signing |
| **FIPS 205 — SLH-DSA** | SPHINCS+-derived hashes + signatures | Optional ultra-conservative signing where statefulness is unacceptable |

Peers-Touch expects to lead with **ML-KEM + ML-DSA** in product code;
SLH-DSA remains a policy-driven option for specific deployments.

---

## 3. Hybrid Migration Phases

Each phase is **additive** where possible: old clients must fail closed
(negotiation mismatch) rather than silently downgrade to a weaker suite.

### Phase 0 — Now: classical crypto + agility only

- Ship only X25519 / Ed25519 / AES-GCM paths in production.
- **Agility hooks** must exist in design and code reviews even before PQ
  bytes appear:
  - Version fields on inner ciphertext structs (`GroupCiphertext.version`,
    `EncryptedMessage.version` per `chat-ratchet-upgrade.md` §4.2).
  - Session-negotiated ratchet version pinned at X3DH time (same doc §5).
  - String-versioned signaling HKDF `info` / AAD prefixes
    (`peers-touch:signaling:v1`, `signaling:v1|` in
    `peers-chat/docs/architecture/realtime/event-stream.md` §2.7.2).
- **No** PQ key material is published; Station and clients store only
  classical bundles.

**Wire:** unchanged from classical. **Storage:** no PQ columns. **UI:** no
user-visible toggle.

### Phase 1 — Hybrid KEM at X3DH / initial shared secret

- Combine **X25519 DH outputs** with **ML-KEM-768** encapsulation so the
  root input to HKDF is derived from *both* classical and PQ shared
  secrets.
- Concrete sketch (normative bytes TBD in a future crypto spec PR):

```
SS_classical ← X3DH-style DH aggregation (as today)
SS_pq        ← ML-KEM-768 decaps/KEM output
IKM          ← SS_classical || SS_pq   (ordering fixed; domain-separated)
RK           ← HKDF-SHA256(IKM, salt=<session bind>, info=<peers-touch:pq-hybrid-kem:v1>)
```

- **Identity signatures remain Ed25519-only** in Phase 1 to limit scope;
  forged bundle attacks bounded by existing X3DH binding still require PQ
  migration of signatures in Phase 2.
- **Double Ratchet root** consumes `RK` produced above; symmetric DR
  steps stay classical unless/until a PQ hybrid ratchet (PQ3-style) is
  adopted later **after** DR is stable.

**Wire:** extend key-bundle fetch/upload messages with ML-KEM public key
+ ciphertext fields (new proto fields with reserved numbers; see §4).
`EncryptedMessage.version` bumps only when both peers negotiated hybrid
KEM for that session.

**Storage:** SQLCipher session rows gain optional PQ columns (ephemeral
ML-KEM secrets zeroized like DH secrets).

**UI:** none by default; optional developer / admin flag to publish PQ
keys early for interop testing.

### Phase 2 — Hybrid signatures (Ed25519 || ML-DSA-65)

- **Identity bundles**: each published IK is signed with a dual stack:

```
sig_hybrid ← (Ed25519_sig, ML-DSA-65_sig) over the same canonical
             pre-hash of bundle fields
```

- **SKDM integrity**: `SenderKeyDistributionMessage` today relies on the
  pairwise friend channel for authentication; Phase 2 adds an optional
  **explicit ML-DSA signature** over the SKDM payload (or over its hash)
  so future designs can prove SKDM origin even if transport assumptions
  change.

**Wire:** `SenderKeyDistributionMessage` grows signature arm(s) OR the
  outer friend message adds a PQ signature field — requires a **version
  bump or new proto field** (see §4.2 gap).

**Storage:** Station persists PQ public keys alongside classical keys in
key-exchange tables; clients cache larger bundles.

**UI:** settings may surface "quantum-ready identity" badges once both
  peers publish Phase-2 bundles.

### Phase 3 — PQC-only fallback (policy-driven)

- Activated only when **NIST**, a regulator, or **Peers-Touch
  security policy** retires classical algorithms for a given deployment
  tier.
- Sessions that cannot negotiate ML-KEM + ML-DSA **fail closed**; there
  is no silent classical fallback.
- Sender Keys and DR symmetric chains remain mostly unchanged unless a
  PQ-only ratchet variant is mandated; that is a **separate spec** from
  this roadmap.

**Wire:** `supported_versions` / `GroupCiphertext.version` /
`EncryptedMessage.version` carry PQ-only regime identifiers.

**Storage:** legacy classical-only rows remain decrypt-only archived
state; new sessions omit classical bytes.

**UI:** hard upgrade prompts analogous to `chat-ratchet-upgrade.md` Phase
M4, but driven by compliance mode.

---

## 4. Wire-Format Hooks and Gaps

### 4.1 Hooks already aligned with algorithm agility

| Surface | Mechanism | Notes |
|---|---|---|
| **Group ciphertext** | `GroupCiphertext.version` (`uint32`, **field 1**) in `group_chat.proto` | Bumps if AAD, chain KDF labels, or sig cover changes. |
| **Per-message auth** | Ed25519 `GroupCiphertext.signature` | Hybrid sig semantics gated by future `version`. |
| **Friend ratchet** | `EncryptedMessage.version` **= 6** (`chat-ratchet-upgrade.md` §4.2) | v0 chain-only vs v1 DR; hybrid KEM binds via session negotiation. |
| **Session negotiation** | `KeyBundle.supported_versions = 99` (§5 same doc) | Fixed at X3DH; blocks mid-session downgrade. |
| **Signaling** | HKDF info `peers-touch:signaling:v1`, AAD `signaling:v1|` | String bump, not a proto `version` field. |
| **Realtime** | `StreamEvent` adds `oneof` arms only (`peers-chat/docs/architecture/realtime/event-stream.md` §2.3) | Outer envelope unchanged; inner ciphertext may grow. |

### 4.2 Gaps — versioning missing or only documentary

| Surface | Issue | Likely remediation |
|---|---|---|
| **`SenderKeyDistributionMessage`** | Has fields `group_ulid`..`sender_sig_pub` (**1–6**) but **no `version` uint32**. | Add `uint32 version = 7` (or reserved gap) in `group_chat.proto` before Phase 2 signing semantics ship. |
| **Station key-exchange API** | `FetchKeyBundleResponse` exposes classical strings only; **no `supported_versions` repeated field** yet. | Extend `key_exchange.proto` plus upload request with PQ fields + version vectors. |
| **`FriendChatMessage` / `MessageEnvelope`** | Outer `bytes encrypted_payload` has **no alg-id wrapper**; semantics live entirely inside the serialized inner message. | Acceptable *if* inner `EncryptedMessage` always prefixes parse; ensure all new parsers reject unknown `version` early. |
| **`MessageEnvelope.signature`** | Typed as `string` without algorithm identifier. | Any PQ signature needs either a structured `oneof` or a domain-separated sub-framing inside the string (breaking change risk). |
| **Federation handshake** | Client-unaware model defers PQ negotiation to stations. | Missing today: **capability advertisement** between homeservers (see §6.3). |

---

## 5. Performance and Size Budget

### 5.1 ML-KEM-768 (NIST IPD / FIPS 203 parameters)

Representative sizes (implementation-dependent by a few bytes):

- **Ciphertext:** ~1088 B
- **Public key:** ~1184 B

A classical friend **X25519-heavy bundle** is ~96 B of X25519 public
material (order-of-magnitude; excludes JSON/base64 encoding overhead).
Adding ML-KEM-768 **inflates each published bundle by ~1.2 KiB raw**
before encoding.

**Impact:**

- **Station key-fetch (`FetchKeyBundleResponse`)** — cold-start
  multiplies download size for N concurrent peers. Lazy fetching and
  CDN-style edge caching (if introduced) must be PQ-aware.
- **Local caches / SQLCipher** — bundle rows grow; budget GC of stale
  OPKs becomes more I/O heavy.

**Mitigations:**

- **Lazy fetch:** do not prefetch PQ-expanded bundles for contacts the
  user never messages.
- **MLS-style key packages** pattern: immutable PQ key packages cached
  server-side with content-hash addressing (future design; not a
  Phase 1 requirement but relieves churn).
- **ML-KEM-512** variant for severely constrained mobile peers when Phase
  1 lands — revisit after telemetry on CPU + battery impact.

### 5.2 ML-DSA-65 signatures

Representative **signature size ~3309 B** per signed artifact.

**SKDM batch math (illustrative):**

- Classical SKDM proto is hundreds of bytes;
  adding ML-DSA-65 pushes toward **~3.5 KiB per SKDM**.
- A 100-member group rotation fan-out ⇒ **~350 KiB** of SKDM payloads
  over pairwise friend channels (sequenced / chunked). This remains
  below practical WebRTC datachannel MTUs for unrelated features but is
  **not free** for mobile radios.

**Mitigations:** batch SKDMs per recipient, compress protobuf where safe,
prioritize control messages below user-visible traffic, and rate-limit
mass rotations triggered by admin bots.

---

## 6. Open Questions (Not Yet Decided)

### 6.1 Hybrid duration and policy triggers

NIST guidance through roughly **2030** favors **hybrid** classical + PQC
for many deployments. Peers-Touch should track updated statements
quarterly and encode a **machine-readable minimum hybrid policy** in
Station config rather than hard-coding dates in clients.

### 6.2 Sender Keys — chain secrecy vs. distribution secrecy

Harvest-now risk simultaneously suggests **PQ SKDM transport** (who
introduced which `chain_key`) and **PQ sender-chain material** (archived
group bodies). We have **not** ranked which dominates our enterprise
threat profile. Phase 1 still prioritizes **session bootstrap** (X3DH +
DR) because edit safety and PCS regressions are the immediate shipping
blockers without DR.

### 6.3 Federation capability negotiation

Open design space: `.well-known` manifests, federation handshake fields
(`supported_pq_kem`, `supported_pq_sig`), or **block non-PQ peers** policy
for regulated tenants. **None shipped** today.

### 6.4 Mobile secure hardware vs. software PQ

**iOS Secure Enclave** PQ APIs are still limited; Phase 2 on mobile may
require **software PQ keys** (Data Protection / app-bound) or **hybrid
KEM-only sessions** until hardware catches up — needs product-security
sign-off per platform.

---

## 7. Library and Implementation Candidates

### 7.1 Rust (desktop / station crypto workers)

- **`pqcrypto-*` crates** (`pqcrypto-mlkem`, `pqcrypto-mldsa`, etc.)
  wrapping PQClean reference implementations — fast to integrate, broad
  platform support, but **not FIPS-validated** by themselves.
- **`liboqs` via FFI** — many algorithms, heavier dependency surface;
  useful for experiments / algorithm agility beyond the NIST triad.

Pick one stack per repo; review decaps timing side channels.

### 7.2 Browser and Web surfaces

**WebCrypto** lacks ML-KEM / ML-DSA. Pure browser builds need **WASM PQ**
or a **native bridge** — gate product surfaces accordingly.

### 7.3 Audit and compliance posture

PQClean refs ≠ FIPS modules. **FIPS-validated PQ** (e.g., wolfCrypt PQ)
may carry **license / build** constraints — decide per SKU (regulated
vs. community) before linking.

---

## 8. Decision: When to Start Phase 1

### 8.1 Trigger conditions (any-of)

- Updated **NIST / NSA / ENISA** guidance materially lowers recommended
  hybrid timelines for our sector.
- **Regulated customers** mandate PQC in RFIs we cannot defer.
- **Competitive communications products** ship interoperable hybrid KEM
  for 1:1 messaging at scale, creating market pressure.

### 8.2 Hard prerequisites

- **`chat-ratchet-upgrade.md` Phases M0–M1 must ship first.** Phase 1
  piggybacks on stable `EncryptedMessage.version` semantics and
  `KeyBundle.supported_versions` plumbing. Attempting to land hybrid
  KEM atop the legacy chain-only ratchet creates overlapping migrations
  and ambiguous failure attribution.
- Sender Keys G1+ should be **feature-complete enough** that SKDM tests
  run in CI under DR sessions (`group-sender-keys.md` §9 interaction
  table).

### 8.3 Effort outlook

Calendar planning assumption: **one full engineering quarter**
(calendar quarter, not story points) from charter → internal dogfood for
Phase 1 (hybrid KEM only, desktop + station), *given* M1 already landed.
Mobile parity + Phase 2 signatures typically add **a second quarter**
unless platform crypto blockers compress scope.

**Cross-check:** `chat-ratchet-upgrade.md` defers quantum adversaries and
PQ3-style hybrid ratchets here. `group-sender-keys.md` defers quantum-
safe SK chains here (Phase 2–3 signatures / `GroupCiphertext.version`;
deeper chain-KDF TBD after hybrid bootstrap).

---

## 9. References

- NIST FIPS 203 (ML-KEM), 204 (ML-DSA), 205 (SLH-DSA).
- `docs/architecture/encryption/chat-ratchet-upgrade.md` — DR,
  `EncryptedMessage`, `KeyBundle.supported_versions`.
- `docs/architecture/encryption/group-sender-keys.md` — Sender Keys,
  SKDM, `GroupCiphertext`.
- `peers-chat/model/domain/chat/group_chat.proto` — field numbers.
- `peers-chat/model/domain/key_exchange/key_exchange.proto` — bundles.
- `peers-chat/docs/architecture/realtime/event-stream.md` §2.7.2 —
  signaling AAD / HKDF `info` scheme.

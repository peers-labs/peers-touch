# Secure Content - Security Contract

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-13 | **Updated**: 2026-09-14
> **Owner**: Architecture Team

---

## 1. Threat Model

Protected against:

- anonymous and authenticated callers outside the domain grant;
- callers holding valid Post, Comment, upload, or object IDs;
- compromised Station databases, logs, and OSS buckets;
- ciphertext, object, envelope, actor, device, plan, generation, and audience
  substitution;
- replay under another command, resource, recipient slot, or expiry;
- revoked devices requesting new endpoint envelopes;
- recovered devices requesting content no longer authorized by Social.

Not protected against:

- an authorized recipient copying, exporting, photographing, or modifying their
  own client;
- compromise of an authorized device while plaintext or root keys are available;
- traffic analysis over ciphertext size, timing, audience class, recipient count,
  object count, and delivery activity;
- compromise of the actor recovery phrase, which intentionally restores historical
  actor-authorized content.

## 2. Cryptographic Suites

| Purpose | Suite |
|---|---|
| Private payload | AES-256-GCM |
| Object chunks | AES-256-GCM, fixed 1 MiB plaintext chunks |
| Endpoint/recovery key envelope | RFC 9180 HPKE: X25519 + HKDF-SHA256 + AES-256-GCM |
| Payload/object commitments | SHA-256 |
| Key derivation | HKDF-SHA256 |
| Envelope/command signature | existing Actor Device Ed25519 key |
| Randomness | OS CSPRNG |

Implementations use maintained cryptographic libraries. Custom curve conversion,
AEAD, HPKE, or signature implementations are forbidden.

## 3. Content Keys

Every private Post and Comment generates an independent random 256-bit root key.
The root key derives a payload key:

```text
K_payload = HKDF-SHA256(
  K_content,
  authorization_snapshot_sha256,
  protocol_version || owner_domain || content_id || generation || payload_kind
)
```

Attachment object keys and base nonces are independently random and exist only
inside the encrypted payload. Root keys are never used directly for payload or
object AEAD.

## 4. One-Time Content PreKeys

Key Exchange owns two non-interchangeable pools:

| Pool | Scope | Private-key location | Purpose |
|---|---|---|---|
| Endpoint Content PreKey | `ActorDeviceRef` | Native secure storage | normal delivery to one active device |
| Actor Content Recovery PreKey | actor + recovery epoch | deterministically derived from recovery secret | trusted new-device historical recovery |

Properties:

- every public PreKey is 32-byte X25519 material with a unique typed key ID;
- under accepted `SC-D15`, every published PreKey is signed by the authenticated active
  device over a dedicated domain-separated canonical signing input that binds
  the publisher, signing-key ID, publisher profile version, and expected/new
  pool epochs;
- Key Exchange resolves the verified signing key through Actor Identity and
  revalidates signature and publisher eligibility before publication and before
  a new claim exposes stored material; an Actor Identity-owned row fence holds
  the exact device key/profile/revocation state through the Key Exchange
  transaction commit;
- endpoint and recovery key IDs occupy separate namespaces;
- plan claim is exact-once and irreversible when public material is disclosed;
- retries with the same plan ID return the same claimed key;
- another plan cannot claim or reuse it;
- low inventory is replenished through a dedicated Key Exchange flow;
- expired/abandoned plans consume keys but never make them reusable;
- recipient slots expose only one-time public material, preventing cross-plan
  endpoint fingerprinting;
- sender-visible recipient count remains an explicit metadata leakage.

The issuer signature authenticates the device that published the public key and
prevents database substitution from becoming claimable material. It does not
prove that an actor-recovery private key was derived from the recovery phrase.
A compromised currently authorized device may rotate or replenish that actor's
recovery pool while authorized, but revocation makes its unclaimed keys
ineligible for future content. Completed claims remain replayable because their
public material was already exposed.

`SC-D16` replaces the previous underspecified recovery formula with one
byte-exact transcript. The accepted 24-word BIP39 phrase must first pass the
maintained BIP39 library's wordlist, NFKD, and checksum validation and decode to
exactly 32 bytes of entropy. The KDF itself receives only those entropy bytes,
not the phrase text:

```text
master_context =
  u32be(len(actor_ptid)) || actor_ptid || u64be(recovery_epoch)

K_sc_recovery = HKDF-SHA256(
  ikm  = BIP39_mnemonic_entropy,
  salt = SHA-256(
    "peers-touch:secure-content:recovery-master-salt:v1\0"
    || master_context
  ),
  info = "peers-touch:secure-content:recovery:v1\0",
  L    = 32
)

prekey_context =
  master_context || u32be(len(key_id)) || key_id

K_recovery_prekey = HKDF-SHA256(
  ikm  = K_sc_recovery,
  salt = SHA-256(
    "peers-touch:secure-content:recovery-prekey-salt:v1\0"
    || prekey_context
  ),
  info = "peers-touch:secure-content:recovery-prekey:v1\0"
         || prekey_context,
  L    = 32
)
```

This derivation is independent of the existing per-revision Argon2id archive key,
whose random salt intentionally changes for every backup. The initial trusted
device stores `K_sc_recovery` wrapped by platform secure storage so it can
replenish the public pool without retaining the phrase.
Each typed recovery PreKey ID deterministically derives one X25519 private key.
A recovered device derives the same master after explicit phrase entry. The
recovery phrase, recovery master, and derived private keys are never uploaded.
Private publish fails before encryption when any required recipient lacks a
claimable recovery PreKey.

`actor_ptid` and `key_id` are UTF-8 encoded exactly as their canonical protocol
identifiers; this KDF performs no Unicode normalization. Inputs must already be
non-empty, unchanged by trimming, NUL-free, and within their protocol byte
limits. Lengths are unsigned 32-bit big-endian and the epoch is unsigned 64-bit
big-endian. Each domain above includes the shown terminal NUL. The per-key
32-byte output is passed to the maintained X25519 implementation, which owns
RFC 7748 scalar clamping; there is no retry branch. Native rejects a derived
public key that differs from the claimed recovery PreKey before HPKE open.

## 5. Exact Envelope Binding

The deterministic `ContentKeyEnvelopeBinding` includes:

```text
format_version
plan_id
plan_sha256
resource_ref(owner_domain, content_id, generation)
recipient_slot_id
recipient_key_kind
recipient_key_id
principal_binding_sha256
authorization_snapshot_sha256
payload_ciphertext_sha256
object_descriptor_set_sha256
plan_expires_at
sender ActorDeviceRef
sender_signing_key_id
```

The canonical binding bytes are:

- HPKE `info`;
- HPKE AEAD associated data;
- the input to the author device Ed25519 signature;
- hashed into the exact Social/Conversation submit command.

Station validates the plan signature, slot mapping, one-time claim receipt,
binding hash, sender signature, payload hash, object descriptor set, expiry,
resource, and generation before commit. The recipient repeats binding, signature,
and ciphertext checks before releasing plaintext.

No free-form `binding_sha256` without canonical source fields is accepted.

## 6. Recovery Flow

For each recipient actor, prepare claims:

- one Endpoint Content PreKey for each required active device;
- one Actor Content Recovery PreKey.

The sender seals the same resource root key independently to every endpoint and
recovery slot. Station stores the recovery envelope under the recipient actor and
the immutable domain grant.

After trusted actor recovery:

1. Recovery restores the actor identity and recovery epoch.
2. Social lists recoverable private resources through a paginated, currently
   authorized query.
3. Native derives the claimed recovery private key from the recovery secret and
   typed key ID.
4. Native opens the recovery envelope, verifies the resource binding, and stores
   the root key in its encrypted local catalog.
5. Native fetches and decrypts ciphertext through the domain-owned object route.

This works for content never opened on the previous device. Blocked, deleted, or
otherwise revoked resources are not returned by the recovery query. Recovery
pagination is cursor-bound and does not embed one key per resource in the
whole-archive revision.

## 7. Metadata Boundary

Station may retain:

- author, resource ID, timestamps, audience kind, snapshot/version commitments;
- recipient actor/device grants;
- ciphertext/object sizes and hashes;
- private poll opaque option IDs and vote facts;
- signed mention-routing recipients;
- audit and retry metadata.

Station must not retain:

- private text, option labels, link preview content, location, alt text, filename,
  real MIME type, object key, nonce, plaintext hash, or decrypted bytes;
- author-visible stable recipient wrapping public keys;
- full recipient/envelope lists in ordinary read responses.

## 8. Authentication And Authorization

- Missing credential on public-capable GET means anonymous public lookup only.
- Any supplied invalid, expired, malformed, or revoked credential returns `401`.
- Private access requires canonical actor plus active device.
- Social applies frozen grant and current block/delete/relationship policy.
- Conversation applies its immutable authority grant.
- Domain routes authorize before reading ciphertext or envelopes.
- Object IDs and ciphertext possession never imply access.
- Unauthorized private resources use a uniform not-found response.

## 9. Secret Handling

- Root keys, object keys, nonces, recovery secrets, prekey private material, and
  plaintext never enter URL, logs, metrics, traces, Acceptance evidence, or Web
  storage.
- Native secret-bearing structs zeroize on drop where supported.
- Temporary decrypted files are account-scoped, permission-restricted, and
  atomically removed on revoke, logout, account switch, or integrity failure.
- Crash recovery may retain ciphertext/checkpoints, never partial plaintext.

## 10. Required Security Evidence

- fixed known-answer vectors across every Rust consumer and Go descriptor validator;
- envelope substitution matrix over every binding field;
- one-time PreKey signature, publisher-key/profile binding, exact-claim, replay,
  conflict, revocation race, persisted-tamper, epoch CAS, and replenishment proof;
- anonymous/invalid-token/wrong-actor/wrong-device/wrong-object negative corpus;
- Station DB/log/trace/evidence recursive secret scan;
- never-opened-content trusted recovery and revoked-resource denial;
- recipient-slot cross-plan unlinkability test;
- ciphertext/hash/AEAD corruption with zero partial plaintext;
- tree-wide absence of Social signaling-envelope and duplicate chunk-cipher code.

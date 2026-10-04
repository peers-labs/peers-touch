# Secure Content - Architecture Decisions

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-09-13 | **Updated**: 2026-10-03
> **Owner**: Architecture Team

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| `SC-D01` | Secure Content is a shared contract/kernel, not a business authority | accepted |
| `SC-D02` | Portable Rust Core is the single client crypto implementation | accepted |
| `SC-D03` | Station reuse is a stateless kernel; object planes remain domain-owned | accepted |
| `SC-D04` | Every private resource has an independent root content key | accepted |
| `SC-D05` | HPKE envelopes use separate one-time endpoint and recovery PreKeys | accepted |
| `SC-D06` | Private recipient and endpoint sets freeze at publish | accepted |
| `SC-D07` | Ordinary responses expose only the caller endpoint envelope | accepted |
| `SC-D08` | Public-readable APIs use strict optional authentication | accepted |
| `SC-D09` | One-time actor recovery PreKeys restore never-opened content | accepted |
| `SC-D10` | Legacy private plaintext and bespoke crypto are removed by hard cut | accepted |
| `SC-D11` | Public and private content retain separate physical persistence | accepted |
| `SC-D12` | Plans expose opaque slots backed only by one-time public keys | accepted |
| `SC-D13` | The business domain owns the outer object/grant transaction | accepted |
| `SC-D14` | Private subtype and routing wires are bounded and canonical | accepted |
| `SC-D15` | Content PreKey publication is device-authenticated and epoch-fenced | accepted |
| `SC-D16` | Recovery PreKey derivation uses one canonical HKDF transcript | accepted |
| `SC-D17` | Social private prepare and submit use durable records and distinct routes | accepted |
| `SC-D18` | Social encrypted objects use typed control messages and bounded raw-byte routes | accepted |
| `SC-D19` | Durable content proofs use current-key attestations for retained Station public keys | accepted |
| `SC-D20` | Content PreKey maintenance uses canonical Key Exchange client routes | accepted |
| `SC-D21` | Product evidence uses production-delegating barriers and owner-controlled runtime continuation | accepted |
| `SC-D22` | Development proof uses one owner-produced multi-service runtime manifest | accepted |
| `SC-D23` | Development private-state reset is allowlisted, journaled, and public-preserving | accepted |
| `SC-D24` | Canonical private schema activation precedes private-content Journeys | accepted |
| `SC-D25` | A fresh authorized source may supersede only a PREPARED reset | accepted |
| `SC-D26` | A reviewed source defect may replace one closed post-commit reset boundary through an immutable predecessor link | accepted |
| `SC-D27` | Recovery replacement separates admission proof from append-only execution provenance | accepted |
| `SC-D28` | Runtime services separate canonical schema identity from live connection routing | accepted |
| `SC-D29` | Audience targets are typed and v1 private expansion remains locally enumerable | accepted |

---

## SC-D01: Secure Content Is Not A Business Authority

**Status**: accepted
**Date**: 2026-09-13

### Context

Social owns audience rules and Conversation owns membership/event truth. Moving
either policy into a generic encryption component would create another authority.

### Decision

Secure Content owns shared cryptographic formats and stateless validation/state
transition kernels. Calling domains own opaque object lifecycle, grants,
transactions, routes, audit, GC, recipient resolution, and authorization.

### Rationale

Mechanics can be reused without flattening distinct business models.

### Alternatives Considered

- One global ACL service: rejected because it must duplicate Social and
  Conversation state.
- Social importing Conversation: rejected as a direct domain dependency.

### Consequences

Every domain adapter must implement the shared repository conformance contract.
No Secure Content record or service exists outside a domain-owned resource.

---

## SC-D02: One Portable Rust Crypto Core

**Status**: accepted
**Date**: 2026-09-13

### Context

Chat has tested attachment crypto in `messaging-core`; Social duplicates chunk
crypto in Desktop `oss.rs`, and Mobile parity would add another implementation.

### Decision

Extract domain-neutral payload, HPKE-envelope, object crypto, descriptor
validation, and transfer FSM into `packages/secure-content-core`. Desktop,
Mobile, and `messaging-core` consume it.

### Rationale

One implementation and one known-answer corpus prevent algorithm and AAD drift.

### Alternatives Considered

- Let Social depend on `messaging-core`: rejected because Social is not Chat.
- Keep duplicate per-client implementations: rejected as a security silo.
- Put crypto in TypeScript: rejected because keys and durable state belong to the
  Native runtime.

### Consequences

Chat's generic algorithm/FSM implementation moves behind a domain adapter, while
its protobuf wire, routes, tables, Direct/MLS and message state remain unchanged.
The implementation extraction must be atomic.

---

## SC-D03: Stateless Shared Kernel, Domain-Owned Object Planes

**Status**: accepted
**Date**: 2026-09-13

### Context

Conversation currently owns a mature object transfer stack; Social uses generic
OSS public visibility. Duplicating the Conversation stack under Social would
preserve two implementations.

### Decision

Introduce one internal stateless Go kernel for descriptor validation, transfer
state transitions, policy limits, typed errors, and repository conformance.
Conversation and Social retain separate routes, UOWs, tables, grants, audit, GC,
and object workers. Both use the same kernel and storage backend interface.

`MP-D23` remains unchanged: Conversation continues to own its attachment object
plane and `/conversation/attachments/*`.

### Rationale

Integrity and transition logic are reused without moving state or transaction
ownership out of either bounded context.

### Alternatives Considered

- Make `/conversation/attachments/*` the Social implementation: rejected because
  it makes Social depend on Conversation.
- Use raw OSS public ciphertext: rejected because possession of an object ID
  becomes sufficient to download bytes.
- Duplicate the stack in Social: rejected because fixes and limits would drift.
- Add a stateful `/secure-content/*` subserver: rejected because it conflicts with
  accepted Conversation ownership and creates a cross-domain transaction owner.

### Consequences

Conversation routes/tables and accepted ownership remain intact. Social adds its
own domain-owned object adapter/tables. Shared transition logic must not fork.

---

## SC-D04: Independent Root Key Per Private Resource

**Status**: accepted
**Date**: 2026-09-13

### Context

Reusing a Post root key for comments would let every Post recipient decrypt any
comment ciphertext they obtain, even when interaction visibility excludes them.
Returning the exact comment recipient list to its author would leak relationship
metadata.

### Decision

Each private Post and Comment has its own random 256-bit root content key. Social
prepares the required recipient endpoints as opaque slots. The author seals one
envelope per slot without learning the slot-to-actor mapping. Payload subkeys are
HKDF-derived from the resource root key and immutable content binding. Attachment
object keys remain random and exist only inside the encrypted resource payload.

### Rationale

Cryptographic access matches Post and interaction visibility, while every
encrypted resource has an independent AEAD key domain.

### Alternatives Considered

- Reuse the Post key for comments: rejected because filtered comment ciphertext
  would remain decryptable by every Post reader.
- Return recipient PTIDs to each commenter: rejected because authorization to
  comment does not grant audience-enumeration permission.
- Use one resource root key directly for every payload/object: rejected because
  nonce/key-domain safety becomes fragile.
- Derive object keys from the root key: rejected because independent resumable
  object lifecycle and selective cleanup benefit from random object keys.

### Consequences

Envelope generation cost grows with the recipient endpoint set and must be
bounded. Opaque recipient slots and Station-side exact coverage validation add a
prepare/submit round trip.

---

## SC-D05: HPKE Envelopes Use One-Time Content PreKeys

**Status**: accepted
**Date**: 2026-09-13

### Context

Social currently reuses a WebRTC signaling sealed box. Its context and lifecycle
are not a durable content-key protocol.

### Decision

Use RFC 9180 HPKE with X25519/HKDF-SHA256/AES-256-GCM to wrap a resource root key.
Key Exchange claims a distinct one-time Content PreKey for each required active
endpoint and a distinct one-time recovery PreKey for each recipient actor. The
author device signs the exact plan/envelope binding with its existing device
signing key.

### Rationale

HPKE is a standard single-recipient primitive. Separate one-time pools avoid
cross-plan endpoint fingerprinting and do not consume Chat Direct prekeys.

### Alternatives Considered

- Signaling envelope: rejected because it is owned by unordered WebRTC signaling.
- Double Ratchet/MLS for every audience: rejected because Moments are immutable
  shared content, not an ordered conversation.
- Stable endpoint wrapping key: rejected because an author could correlate the
  same recipient device across otherwise opaque plans.
- Actor-wide static envelope: rejected because it is linkable and weakens
  endpoint lifecycle diagnostics.

### Consequences

PreKey exposure is irreversible, so abandoned plans consume capacity and require
replenishment. Recovery-secret compromise still exposes actor-recovery envelopes;
this is an explicit non-claim.

---

## SC-D06: Recipient Snapshot Freezes At Publish

**Status**: accepted
**Date**: 2026-09-13

### Context

Dynamic FOLLOWERS/FRIENDS membership cannot add historical decryption access
without an authorized device rewrapping the root key.

### Decision

Social resolves and freezes the recipient actor set and required endpoint set in
an expiring publish plan. Submit requires exact envelope coverage and unchanged
audience revisions. New followers, friends, Circle members, Group members, or
devices do not automatically gain old content.

### Rationale

The cryptographic recipient set and Station delivery truth remain identical.

### Alternatives Considered

- Evaluate only current relationship at read time: rejected because authorization
  could grant content without a corresponding key.
- Let Station rewrap: rejected because Station would need the content key.
- Publish to a partial endpoint set: rejected because user intent would be
  silently narrowed.

### Consequences

Historical access for a new device uses the actor recovery PreKey envelope
defined by `SC-D09`; no author rewrap fallback is required.

---

## SC-D07: Viewer-Scoped Envelope Projection

**Status**: accepted
**Date**: 2026-09-13

### Context

The current Post wire shape embeds all recipient envelopes and custom recipient
PTIDs.

### Decision

Ordinary Post responses contain only an audience summary and, for private
content, at most the current endpoint's envelope. Author audience administration
uses a separate endpoint and never returns sealed key bytes for other devices.

### Rationale

Authorization to read content is not authorization to enumerate its audience or
device topology.

### Alternatives Considered

- Return all envelopes and filter in UI: rejected because the API has already
  crossed the confidentiality boundary.
- Encrypt the whole envelope list to every recipient: rejected because each
  recipient could still enumerate it after decryption.

### Consequences

The Station must resolve actor and device identity on every private read.

---

## SC-D08: Strict Optional Authentication

**Status**: accepted
**Date**: 2026-09-13

### Context

Public resources require anonymous access, while current required-JWT middleware
rejects missing credentials and current Social point reads parse no token.

### Decision

Add a shared optional-JWT middleware: missing header continues anonymously;
supplied valid token injects a canonical subject; supplied malformed, expired, or
revoked token returns `401`.

### Rationale

Public and authenticated private reads can share one route without silently
discarding identity or weakening invalid-token handling.

### Alternatives Considered

- Duplicate public/private GET routes: rejected as API duplication.
- Parse JWT in Social handlers: rejected as another auth implementation.
- Treat invalid tokens as anonymous: rejected because it hides credential
  failure and can change response semantics.

### Consequences

The core auth adapters need HTTP and Hertz parity plus session-validation tests.

---

## SC-D09: One-Time Actor Recovery PreKeys

**Status**: accepted
**Date**: 2026-09-13

### Context

New devices cannot open envelopes addressed to old device private keys. A
recovery archive containing one root key per Post/Comment grows without bound and
cannot restore content the old device never fetched.

### Decision

The recovery secret derives a domain-separated actor Content Recovery master.
Devices publish a pool of one-time X25519 recovery public keys through Key
Exchange. A content plan claims one recovery key per recipient actor, and the
sender stores a recovery envelope beside endpoint envelopes. After trusted
recovery, a new device derives the claimed private key from the recovery secret
and key ID, then requests currently authorized recovery envelopes through Social.

### Rationale

This restores never-opened historical content without backing up device private
keys or building an unbounded per-content key catalog archive.

### Alternatives Considered

- Back up device private keys: rejected because revocation and endpoint identity
  would be cloned.
- Archive every acquired root key: rejected because it misses never-opened content
  and grows whole-archive revisions without a bound.
- Require the author to rewrap: rejected as unreliable product behavior.
- Store root keys at Station: rejected as plaintext-key escrow.

### Consequences

Key Exchange gains a separate exact-once recovery-PreKey pool. Recovery-secret
compromise exposes authorized historical recovery envelopes, matching the
existing recovery trust boundary. Current Social authorization still gates every
recovery-envelope and ciphertext read.

---

## SC-D10: Hard Cut Legacy Private Content

**Status**: accepted
**Date**: 2026-09-13

### Context

Existing private rows contain plaintext and bespoke media envelopes. A server
cannot convert them to true E2EE without becoming the key owner.

### Decision

New private content uses only the Secure Content contract. Existing private
development Post, Comment, envelope, delivery, and private-media rows are deleted
through one explicitly authorized, scope-bound reset. Public Social content is
preserved and verified before and after the reset.

No server-side key escrow, dual read/write, route alias, signaling-envelope
fallback, or permanent legacy schema remains.

### Rationale

A clean security boundary cannot be built on a hidden plaintext fallback.

### Alternatives Considered

- Encrypt old rows with a Station key: rejected because it is at-rest encryption,
  not E2EE.
- Author-device migration: rejected for the current development dataset because
  it would add a temporary migration protocol, runtime, and recovery owner before
  any production-data retention promise exists.
- Keep legacy reads indefinitely: rejected as split security semantics.

### Consequences

Execution cannot begin destructive cleanup without fresh explicit authorization
and exact private/public row-count and public-content hash evidence.

---

## SC-D11: Preserve Public/Private Physical Separation

**Status**: accepted
**Date**: 2026-09-13

### Context

Encryption does not replace authorization or blast-radius isolation.

### Decision

Public Post/Comment data remains in public tables. Private Post/Comment
ciphertext, audience snapshots, envelopes, objects, and grants remain in
Social-owned private tables that public queries cannot access. Conversation
keeps its existing Conversation-owned attachment tables.

### Rationale

Physical separation prevents a public query defect from exporting private
ciphertext metadata and keeps future federation paths simple.

### Alternatives Considered

- One table with an `encrypted` flag: rejected because query mistakes cross the
  privacy boundary.
- Rely only on E2EE: rejected because metadata and ciphertext availability still
  matter.

### Consequences

Public and private repositories remain separate, but private repositories lose
all plaintext body columns.

---

## SC-D12: Opaque Recipient Slots

**Status**: accepted
**Date**: 2026-09-13

### Context

A private Comment may be visible to fewer actors than its parent Post. The
comment author needs public wrapping keys to encrypt for those recipients but is
not entitled to enumerate the complete interaction-visible actor/device set.

### Decision

Every prepare plan returns random per-plan recipient slot IDs, one-time wrapping
public keys, typed one-time key IDs, and plan-specific principal-binding
commitments. Profile/recovery epochs and actor/device identities remain inside
the Station mapping. Submit envelopes name slots; Station resolves them inside
the commit transaction. Ordinary responses expose only the caller's resolved
endpoint or recovery envelope.

### Rationale

The author can produce complete endpoint ciphertext without receiving a reusable
recipient/device directory.

### Alternatives Considered

- Return recipient PTIDs and device IDs: rejected as unnecessary metadata
  disclosure.
- Let Station encrypt the root key: rejected because Station cannot own content
  keys.
- Reuse the parent Post key: rejected because it weakens comment-level
  interaction visibility after ciphertext disclosure.

### Consequences

Plans are stateful, expiring, and single-use. Slot mapping and exact coverage
must be transactionally verified and included in the plan signature/hash.

---

## SC-D13: Domain-Owned Outer Transaction

**Status**: accepted
**Date**: 2026-09-13

### Context

A separate object/grant transaction can commit while its Post, Comment, or
Conversation event fails, creating an orphan authority fact or visible object
without matching business truth.

### Decision

The Social or Conversation UOW owns the only commit boundary. It supplies its
transaction-bound object/grant repository to the stateless Secure Content kernel.
The kernel validates and returns mutations but cannot begin, commit, retry, or
roll back a transaction. PreKey claims are separately exact-once and irreversible;
the same plan ID replays the same claims after an outer transaction retry.

### Rationale

Business fact, envelopes, deliveries, object attachment, and grants commit
together without introducing a cross-domain transaction coordinator.

### Alternatives Considered

- Shared Secure Content transaction owner: rejected because it cannot own Social
  or Conversation facts.
- Eventual grant reconciliation: rejected because it creates a window where
  committed content and object access disagree.
- Distributed two-phase commit with Key Exchange: rejected because irreversibly
  consuming an exposed PreKey is safer and simpler than reusing it.

### Consequences

Each domain keeps its own object persistence adapter and must pass the shared
kernel conformance suite. Abandoned PreKey claims consume inventory and require
bounded replenishment.

---

## SC-D14: Bounded Private Subtype And Routing Wires

**Status**: accepted
**Date**: 2026-09-14

### Context

W1 cannot generate one cross-language contract substrate while encrypted video
variants, rendered repost snapshots, signed mention-routing facts, and the
prepare/submit/read response shapes remain undefined. Inferring those fields in
code would turn generated output into the architecture source and make later
wire correction a breaking migration.

### Decision

The Social private-content proto defines:

- bounded encrypted video variants, each referencing its own opaque object
  descriptor through encrypted attachment metadata;
- one non-recursive rendered-source snapshot for a private repost;
- one canonical signed mention-routing bundle per private resource;
- complete typed prepare, submit, point-read, comment-list, vote, and
  recovery-list request/response messages.

The prepare plan commits a non-zero Social subtype through a generic domain
binding hash, and recovery entries carry a typed Post or Comment locator. The
rendered snapshot excludes REPOST from its body union. Mention facts expose only
actor identity and a commitment to the canonical encrypted-payload mention.
The commitment is a domain-separated HMAC keyed by a random per-resource salt
that remains inside the encrypted payload. The signature binds the resource,
authorization snapshot, complete encrypted-payload hash, sorted facts, sender
device, and signing-key ID. Prepare, submit, and vote commands hash dedicated
canonical input messages that represent every transport field with
deterministic repeated-field ordering. The same command and request hash returns
the original result; the same command with another hash is terminal conflict.
Private reads return a viewer-safe verification projection with the signed
routing bundle, Station-signed commit proof, and applicable visible subtype
authority. The commit proof is finalized and persisted in the same Social UOW
and exact receipt. Repost authority discriminates PUBLIC canonical-Post proof
from private source-resource/commit proof. PUBLIC proof uses a dedicated
immutable, non-recursive snapshot that excludes mutable/viewer fields and keeps
public media source-owned while retaining canonical typed mention offsets. Both
proof classes bind source author, locator, and a salted, domain-separated
rendered-snapshot HMAC so recipients can detect fabricated quoted content
without exposing an enumerable plaintext-derived hash.

### Rationale

The bounded non-recursive model is portable across prost, Go protobuf, and
protobuf-es, prevents attacker-controlled recursive decode depth, and retains
the complete encrypted presentation needed by Desktop and Mobile. A signed
commitment lets Station route mention notifications without receiving private
text or mention offsets.

### Alternatives Considered

- Free-form rendered-source bytes: rejected because type/version validation
  would diverge across clients.
- Recursive `PrivateMomentContent`: rejected because malicious nesting creates
  unbounded decode and validation depth.
- Station-visible mention offsets or text: rejected by metadata minimization.
- Unsigned actor-only mention routing: rejected because routing facts could be
  detached from the author command or substituted across resources.
- Separate subtype endpoints: rejected because they split the atomic prepared
  command and duplicate replay semantics.

### Consequences

Video variants are limited to eight, private polls to twenty options, comment
and recovery pages to one hundred resources, and rendered reposts flatten one
source snapshot. Distinct occurrences may mention the same actor. Native
validates plaintext and decrypted subtype/authority equality, subtype limits,
exact mention commitments, and repost source/snapshot equality. Station
validates signatures, frozen-grant
membership, pre-claim poll/repost authority, repost audience subsets,
subtype/domain binding, request bounds, replay identity, recovery locator
identity, and object descriptor coverage without reading private payload fields.
Private poll reads expose only opaque option results, and recovery reuses
bounded Post/Comment point-read routes. Rendered repost media remains
source-owned and source-authorized; it is not copied into the repost object
plane, so source deletion or revocation cannot be bypassed by the snapshot.
Accepting this decision unblocks W1; rejecting it requires another complete
typed wire design before implementation can resume.

---

## SC-D15: Content PreKey Publication Is Device-Authenticated And Epoch-Fenced

**Status**: accepted
**Date**: 2026-09-14

### Context

`ContentOneTimePreKey` carries `issuer_signature`, but the accepted contract does
not define the signed bytes, verification key, or authority for advancing an
actor-recovery epoch. Checking only signature length would allow arbitrary
public material to enter a recovery pool and would make the field decorative.

### Decision

Add a dedicated proto-first `ContentPreKeySigningInput`. The publisher signs a
domain-separated canonical projection:

```text
"peers-touch:secure-content:prekey:v1\0"
|| canonical(ContentPreKeySigningInput)
```

The signing input binds format version, kind, key ID, X25519 public key, exact
endpoint or recovery principal, new pool epoch, expected prior pool epoch,
publisher `ActorDeviceRef`, publisher signing-key ID, and publisher profile
version. It is built fresh from validated semantic fields and encoded by the
Secure Content project canonical encoder. The transport encoding is not itself
the signature surface.

Key Exchange resolves the exact verified signing key through the Actor Identity
capability. Before creating a pool, advancing an epoch, retiring old keys, or
inserting key material, it requires the authenticated publisher, signing-key
ID, publisher profile version, active status, and Ed25519 signature to match.
The Key Exchange transaction then invokes an Actor Identity-owned persistence
fence that locks the exact `actor_devices` row and compares active status,
signing-key ID, public key, and profile version against the resolved snapshot.
The lock remains held through the Key Exchange commit. Key Exchange neither
defines the Actor Identity query nor becomes a second owner of device-key truth.

- Endpoint keys must name the authenticated `ActorDeviceRef`, and their epoch
  must equal that endpoint's current Actor Identity profile version.
- Recovery keys must name the authenticated actor. Key Exchange owns a
  compare-and-swap recovery-pool epoch: initial publication is `0 -> 1`, equal
  epoch replenishes the current pool, and rotation is exactly `N -> N+1`.
  Stale expected epochs and jumps fail before mutation.
- Exact publication replay requires the same key ID, principal, epoch, public
  key, signature, expected prior epoch, publisher, signing-key ID, and publisher
  profile version. Consumed or retired keys never become available again.
- Signature verification failure is typed invalid material and occurs before
  any pool or key mutation.
- Before a new claim exposes public material, Key Exchange resolves the
  publisher again through Actor Identity, revalidates the stored signed fields,
  and holds the same Actor Identity-owned row fence through claim commit.
  Unclaimed keys from a revoked, rotated, stale, or invalid publisher are not
  claimable. A completed exact claim receipt remains replayable because its
  material was already irreversibly exposed.
- Unknown fields are rejected recursively before semantic normalization.
  Duplicate singular fields, field order, and non-minimal varints are handled
  at any future raw-wire publish boundary by canonical decode/re-encode
  equality; the in-process W3 capability accepts only reconstructed typed
  signing inputs.

The signature proves which active actor device published the public material.
It does not prove that a recovery key was derived from the recovery phrase;
that derivation remains a Native responsibility and an explicit security
non-claim. A compromised active device can deny or retain only access already
available to that actor while it remains authorized; revocation prevents its
unclaimed recovery keys from protecting future content.

### Rationale

This gives `issuer_signature` one portable meaning, keeps Actor Identity as
device-key truth, detects database substitution before exposure, and lets Key
Exchange protect irreversible claim inventory without learning recovery
secrets.

### Alternatives Considered

- Accept any non-zero 64-byte signature: rejected because forged recovery
  material could advance the pool epoch and retire valid keys.
- Verify endpoint keys but not recovery keys: rejected because recovery is the
  higher-impact long-lived path.
- Canonicalize `ContentOneTimePreKey` after clearing its signature: rejected
  because the signed publisher and compare-and-swap epoch are not fields of
  that message.
- Let Recovery own the pool epoch: rejected because it creates a circular
  Key Exchange/Recovery mutation dependency; Recovery consumes the accepted
  epoch but does not own Key Exchange inventory.
- Read Actor Identity tables as Key Exchange truth: rejected because verified
  device keys and lifecycle are Actor Identity-owned capabilities.

### Consequences

W3 must extend the proto contract and regenerate all declared consumers, add one
cross-language canonical signing vector, resolve verified publisher keys through
Actor Identity, add its transaction-local row-fence helper, and replace synthetic
signatures with valid Ed25519 vectors. Claim tests must cover
revocation and key rotation before exposure, persisted tampering, epoch CAS and
completed-receipt replay after revocation. The Owner accepted this decision on
2026-09-14.

---

## SC-D16: Recovery PreKey Derivation Uses One Canonical HKDF Transcript

**Status**: accepted
**Date**: 2026-09-14

### Context

The accepted recovery design defines `K_sc_recovery` but only states that each
typed recovery PreKey ID deterministically derives an X25519 private key. Without
an exact transcript, Desktop and Mobile can derive different keys for the same
actor, epoch, and key ID, making never-opened recovery non-interoperable.

### Decision

The maintained BIP39 implementation first applies the BIP39-required NFKD
normalization, validates the English word list and checksum, and returns
exactly 32 entropy bytes for the accepted 24-word phrase. The KDF receives only
those bytes, never mnemonic text.

`actor_ptid` and `key_id` are encoded as their exact canonical UTF-8 bytes. The
KDF performs no Unicode normalization: the caller must supply identifiers that
are non-empty, unchanged by trimming, NUL-free, and bounded to 255 and 128
bytes respectively. `recovery_epoch` is in `1..2^63-1`. Lengths are unsigned
32-bit big-endian and the epoch is unsigned 64-bit big-endian.

The existing recovery master transcript is made explicit:

```text
master_salt_input =
  u32be(len(actor_ptid)) || actor_ptid || u64be(recovery_epoch)

K_sc_recovery = HKDF-SHA256(
  ikm  = BIP39_mnemonic_entropy,
  salt = SHA-256(
    "peers-touch:secure-content:recovery-master-salt:v1\0"
    || master_salt_input
  ),
  info = "peers-touch:secure-content:recovery:v1\0",
  L    = 32
)
```

Each recovery PreKey seed is:

```text
prekey_context =
  u32be(len(actor_ptid)) || actor_ptid
  || u64be(recovery_epoch)
  || u32be(len(key_id)) || key_id

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

`K_recovery_prekey` is passed to the maintained X25519 library as the 32-byte
static-secret input; the library owns RFC 7748 scalar clamping. There is no
retry/counter branch. The derived public key must equal the claimed
`ContentOneTimePreKey.x25519_public_key` before an envelope is opened.

The portable Rust core owns this implementation and zeroizes the master,
per-key seed, and private key. Go and Station never derive or receive the
private material. Fixed master, private-seed, public-key, and envelope-open
vectors are required.

The normative derivation vector is:

```text
BIP39 entropy = 0b repeated 32 times
actor_ptid = "ptid:v1:actor:peers:p:alice:key"
recovery_epoch = 7
key_id = "recovery-prekey-0001"

master_context =
0000001f707469643a76313a6163746f723a70656572733a703a616c6963653a6b65790000000000000007
master_salt =
0d42446c4a58ccdc74013ffd21ab0023c9c18813cd06f24a8395d3ffa25d4023
K_sc_recovery =
57064757d05c45ddfe290541243c801fa07a8e90b7248b3a5989fae496e155aa
prekey_context =
0000001f707469643a76313a6163746f723a70656572733a703a616c6963653a6b65790000000000000007000000147265636f766572792d7072656b65792d30303031
prekey_salt =
a204ff97065160b31b68d86f3dd6ac9d2071e6c5bec45cfca9593368ec8e09f7
K_recovery_prekey =
07fd2947dd56b405f1139f053cbbc13fa9b29c8ef323731b9f3a73a9b28022ac
X25519 public key =
7de402b631f5f1a0f4f0b2b0d1b063a8a4e3fe7212f28b3bc6202197274bb43a
```

The envelope-open vector uses this key pair, the existing
`ContentKeyEnvelopeBinding` canonical bytes as both HPKE `info` and AEAD AAD,
and content key `42` repeated 32 times:

```text
canonical binding =
080112127265636f766572792d706c616e2d303030311a201111111111111111111111111111111111111111111111111111111111111111221b080212157265636f766572792d636f6e74656e742d3030303118012a127265636f766572792d736c6f742d3030303130023a147265636f766572792d7072656b65792d30303031422012121212121212121212121212121212121212121212121212121212121212124a201313131313131313131313131313131313131313131313131313131313131313522014141414141414141414141414141414141414141414141414141414141414145a20151515151515151515151515151515151515151515151515151515151515151562060880a8d6b9076a390a23121f707469643a76313a6163746f723a70656572733a703a616c6963653a6b6579200112126465766963652d617574686f722d30303031721773656e6465722d7369676e696e672d6b65792d30303031
encapsulated key =
393cf2465b8465c277dc0dd9d19664a2d54150b6cc8eb2cb97d155ca7e7cc761
ciphertext =
6e006d72d0034b5791aac1c22a46a8bcc6876222d27e0a9974a3b2c36fda11bae7ed9601871a07e989ea8003bc3e210b
```

### Rationale

Length-prefixing removes concatenation ambiguity, explicit domains prevent
cross-protocol reuse, and binding actor, epoch, and key ID makes the mapping
portable and deterministic without adding a server-side recovery-key catalog.

### Alternatives Considered

- Use the key ID directly as HKDF info without actor or epoch: rejected because
  it permits accidental cross-actor or cross-epoch reuse if a master is
  mishandled.
- Derive from the mnemonic string: rejected because BIP39 normalization and
  locale representation would become part of this protocol.
- Retry until a library reports a valid scalar: rejected because X25519 clamps
  the 32-byte input and a counter would create another cross-client branch.

### Consequences

W5 must update the existing master vector, add per-key private/public vectors,
prove wrong actor/epoch/key ID divergence, and open a real HPKE envelope with a
derived recovery key. Any future transcript change requires a new version and
cannot silently reinterpret existing recovery PreKey IDs.
The Owner accepted this decision on 2026-09-14.

---

## SC-D22: Development Proof Uses One Owner-Produced Multi-Service Runtime Manifest

**Status**: accepted
**Date**: 2026-09-17

### Context

The remaining W7-W12 product Journeys cannot execute from the current
Development runtime contract without weakening their claims:

- the plan text still names profile `one` and slot `0`, while the authoritative
  machine binding and work-item contracts use profile `four`, slot `5`, and the
  existing secondary profile `fiveArm`;
- the current Development manifest accepts only `native-tauri` Desktop and
  Browser clients and requires one top-level profile;
- Mobile has generated Secure Content contracts but no private Social Native
  runtime, product actions, or attachable iOS/Android client kinds;
- W8 has API/static observations but no receiver-visible `social-expansion`
  implementation for its declared slices;
- W2D/W10 require Desktop and Mobile Chat attachment drivers across two
  Stations, but the scenario layer cannot own provisioning or infer service
  topology;
- the recorded W7/W8 API-only checks and W11 source/deploy checks do not satisfy
  the accepted product runtime cells.

The Local Dev Control Plane owns workspace/profile/slot/lease truth, platform
provisioners own process and client lifecycle, and `SC-D21` already requires
attach-only scenarios. A second manifest or scenario-owned launcher would
create parallel runtime authority.

### Decision

#### Canonical profiles and controller binding

The Secure Content hard-cut uses the existing approved Development profiles:

- primary: `four`, deploy environment `station-four`;
- secondary: `fiveArm`, deploy environment `station-five-arm`;
- canonical workspace binding before and after a run: profile `four`, slot `5`.

Profile `one`, slot `0`, `station-one-social-private`, and every client ID
containing `-one-` are superseded for this plan. A runtime owner may temporarily
select the already approved `fiveArm` profile only while holding its declared
deployment resources. It must publish the resulting service attestation and
restore the canonical `four`/slot `5` binding before finalizing the manifest.
The scenario runner never changes a profile.

#### Development Runtime Manifest v2

One platform/runtime owner publishes one immutable, private, external
`secure-content-development-runtime-v2` manifest. It reuses the Acceptance
Framework's canonical service map and client `service_bindings` semantics
without turning Development output into formal Acceptance evidence.

The manifest binds:

- canonical worktree, workspace ID, clean source commit, and worktree-set
  digest;
- controller binding `four`/slot `5`;
- every required Station service by stable service ID, profile ID, deployment
  environment, endpoint, live commit, protocol digest, runtime identity, and
  immutable attestation reference;
- every client by stable client ID, actor-role digest, runtime kind, isolated
  storage identity digest, boot identity, session generation, automation
  session reference, required service roles, and exact service bindings;
- fixture-manifest digest, lifecycle observer capability, creation time, and
  manifest digest.

The supported Development client kinds are exactly:

```text
native-tauri
browser
tauri-ios-simulator
tauri-android-emulator
```

Physical-device runtime kinds remain owned by formal Mobile Acceptance and are
not introduced by this decision.

Top-level singular Station/profile topology is removed from v2. CLI
`--profile` or `--profiles` values are only expected selectors and must equal
the manifest's service profile set exactly. Client bindings select services by
stable role and service ID; order, profile defaults, endpoint guessing, and
business constants are forbidden.

The runtime owner creates, starts, restarts, and tears down clients. The
scenario runner only validates and attaches to already-running sessions.
Missing client kinds, service closure, live identity, source equality,
attestation, fixture capabilities, or attachment support returns a typed
`BLOCKED/UNPROVEN` result before product actions.

#### Product Journey and evidence boundaries

Each workstream has one non-substitutable receiver-visible boundary:

| Workstream | Required Development product boundary |
|---|---|
| W7 | Desktop `desktop-pilot` plus Browser `browser-private-boundary` on `four` |
| W8 | Desktop `social-expansion` slices for audience, Comment, object, subtype, delete/block, and bounds semantics on `four` |
| W9 | both iOS Simulator and Android Emulator execute publish/read/deny, recovery, subtype, object, lifecycle, and bounds cases on `four`, including iOS-to-Android and Android-to-iOS receiver paths |
| W2D/W10 | Desktop, iOS Simulator, and Android Emulator execute the unchanged `MP-J11` Chat attachment corpus against the manifest-bound `four` and `fiveArm` services |
| W11 | the W7-W10 product matrix reruns on the exact hard-cut checkpoint; source scans, deployment health, API status, and earlier results cannot substitute |
| W12 | the complete W11 matrix reruns after each accepted reset target reaches post-audit |

`SOC-SEC-AS01..AS16` retain exactly the meanings in
`docs/architecture/social/acceptance-matrix.md`. Chat uses `MP-G13`/`MP-J11`;
UOW failpoints and reset checks keep their `sc-dj-*` Development identities.
No plan may relabel a Chat or infrastructure result as a Social acceptance ID.

Development results are immutable per scenario/runtime/platform variant and
bind the runtime-manifest digest. An aggregate workstream result is PASS only
when every required child result is current and PASS. API-only, static,
Harness-only, source-only, old-checkpoint, or single-platform evidence remains
explicitly partial.

### Rationale

One manifest gives every scenario the same source, service, client, and runtime
identity truth while preserving existing owners. Reusing canonical service
bindings avoids a Secure Content-specific topology language. Explicit Mobile
client kinds make the platform claim executable without allowing the business
runner to provision Appium, Tauri, Station, storage, or actors.

Separating Social, Chat, and infrastructure evidence identities prevents a
passing low-level check from being promoted into an unrelated product claim.

### Alternatives Considered

- Keep profile `one` in the Markdown plan while executing `four`: rejected
  because reviewed commands and live authority would disagree.
- Use one mutable manifest per platform: rejected because source/service/client
  truth could drift between scenarios.
- Let the runner launch Desktop/Mobile or switch profiles: rejected because it
  bypasses platform and Local Dev Control Plane ownership.
- Treat generated Mobile contracts or Mobile Chat crypto as private Social
  parity: rejected because neither exercises the Social product path.
- Preserve API-only W7/W8 results as `FUNCTIONAL_PASS`: rejected because they
  do not observe the required sender/receiver products.
- Use physical devices in Development by default: rejected because formal
  Mobile Acceptance already owns physical-device leases and proof semantics.

### Consequences

- W7 and W8 return to `FUNCTIONAL_NOT_RUN` until their real Desktop/Browser
  Journeys pass on the current source.
- W9 must implement the private Social Mobile Rust/store/worker and mobile-web
  projection/actions before any Mobile parity claim.
- W2D must land before W10, and W10 must preserve `MP-J11` without changing
  Conversation wire, routes, tables, UOW, grants, or behavior.
- Development manifest v1 is removed atomically when v2 lands; no alias,
  fallback, or dual reader remains.
- Production debug telemetry to fixed external endpoints is forbidden and must
  be removed before W9 source closure.
- W11 remains source/deploy complete but functionally unproven until the full
  product matrix reruns.

### Review And Reversal Conditions

Review this decision if the Acceptance Framework replaces its canonical
service/client binding model or a platform can no longer expose an attachable
owner-controlled automation session. Any replacement must retain one immutable
topology truth, exact-source/live-identity validation, attach-only business
scenarios, and platform-specific evidence. A mutable manifest, scenario-owned
runtime, or weaker evidence class is not a valid reversal.

The Owner accepted this decision on 2026-09-17 at checkpoint
`bd8dad8b3a5e95c4f3bf002c244d605461c3517d`.

---

## SC-D23: Development Private-State Reset Is Allowlisted, Journaled, And Public-Preserving

**Status**: accepted
**Date**: 2026-09-17

### Context

W12 currently authorizes named reset scopes but does not define the physical
targets or transaction semantics. The risk is material:

- `social_private_posts` is no longer wholly legacy. The existing table name is
  reused by the accepted encrypted `SocialPrivateContentPost`, while migrated
  deployments may retain plaintext-era columns and rows.
- canonical Secure Content uses fourteen `social_private_*` tables and a
  Social-owned object backend; old private media used generic OSS metadata and
  blobs.
- old plaintext Comment/Reaction/Delivery rows live in shared Social tables.
- a prefix-based table drop, best-effort object deletion, or count-only public
  check could delete canonical private schema or public/shared objects.

The reset is a Development-only hard cut, not a production migration. It must
prefer a complete private-state reset over preserving mixed historical private
data.

### Decision

#### Exact authorization

W12 may target only:

| Profile | Deploy environment | Destructive scope |
|---|---|---|
| `four` | `station-four` | `station-four-social-private` |
| `fiveArm` | `station-five-arm` | `station-five-arm-social-private` |

The workspace returns to profile `four`, slot `5` after each target. Profile
`one` and `station-one-social-private` are not authorized aliases. Production
profiles, other databases, other object namespaces, and cross-profile reset
are forbidden.

#### Reset unit

For each profile, the reset deletes all Development private Social state,
including canonical encrypted rows created during earlier iterations. The
post-reset product matrix recreates only canonical data. Public Social,
Conversation, Identity, Key Exchange, Recovery, Federation, and unrelated OSS
state are retained.

The database allowlist is:

1. clear all rows from exactly these fourteen canonical tables:

```text
social_private_content_plans
social_private_content_plan_slots
social_private_command_receipts
social_private_posts
social_private_comments
social_private_audience_snapshots
social_private_recipient_grants
social_private_content_envelopes
social_private_delivery_intents
social_private_object_uploads
social_private_object_parts
social_private_objects
social_private_object_grants
social_private_commit_proofs
```

2. delete `social_comments` rows where `post_class = 'private'`;
3. delete `social_reactions` rows where `post_class = 'private'`;
4. clear `social_moment_deliveries`;
5. drop only the retired `social_private_audience_grants` table when present;
6. rebuild `social_private_posts` to the canonical
   `SocialPrivateContentPost` schema after its rows are cleared, removing only
   these retired columns when present:

```text
id
author_id
type
audience_kind
audience_target_id
audience_base_kind
audience_key_envelopes_json
text_body
attachments_json
mentions_json
link_preview_json
reactions_count_json
repost_of_ref
views_count
edited_at
```

Shared canonical columns such as `comments_count`, `created_at`, `updated_at`,
and `deleted_at` remain. No other table, row predicate, column, index, schema,
bucket, or object key is mutable.

`CLEAR_TABLE` means an exact `DELETE` inside the reset transaction; unqualified
`TRUNCATE`, `TRUNCATE ... CASCADE`, wildcard DDL, and schema-wide drop are
forbidden. The dependency order is:

```text
legacy social_reactions(post_class='private')
legacy social_comments(post_class='private')
social_moment_deliveries
social_private_object_grants
social_private_objects
social_private_object_parts
social_private_object_uploads
social_private_delivery_intents
social_private_content_envelopes
social_private_recipient_grants
social_private_comments
social_private_audience_snapshots
social_private_commit_proofs
social_private_command_receipts
social_private_content_plan_slots
social_private_content_plans
social_private_audience_grants (drop table)
social_private_posts (clear and canonical rebuild)
```

The implementation must discover and reject an unexpected foreign-key edge
before mutation rather than widening the delete.

#### Object allowlist

Before database mutation, the reset owner freezes an immutable object deletion
manifest containing:

- every canonical Social-private `storage_key` referenced by
  `social_private_object_parts`, `social_private_object_uploads`, or
  `social_private_objects`;
- every legacy generic-OSS `(owner_ptid, key)` derived from the plaintext-era
  private Post rows' recognized attachment JSON and author identity;
- the source row identity, object owner, backend, expected metadata digest,
  expected blob digest, and reference classification for each target.

Unknown attachment shapes, missing owners, digest mismatches, or any target
referenced by public Social, Conversation, canonical non-target state, or
another OSS owner block the reset before mutation. Generic OSS deletion goes
through the OSS owner. Shared CAS bytes remain when another live file metadata
row references the blob; the private metadata reference must still disappear.
Canonical Social-private bytes are deleted through the Social object adapter.
Direct filesystem, S3, or OSS-table deletion by the reset script is forbidden.

#### Public snapshot and reset journal

The pre-audit writes canonical sorted SHA-256 snapshots for:

- every `social_public_posts` row and schema;
- `social_comments` and `social_reactions` rows with
  `post_class = 'public'`;
- every public Social OSS metadata row plus its content/blob digest;
- the complete database/object target allowlist and all out-of-scope table
  names.

The reset then records a durable, immutable manifest and a monotonic journal:

```text
PREPARED
  -> DATABASE_SCHEMA_COMMITTED
  -> OBJECTS_DELETED
  -> STATION_DEPLOYED
  -> POST_AUDIT_PASSED
  -> COMPLETE
```

The `station.reset` lease is held across pre-audit, Station quiescence,
database mutation, object deletion, canonical deployment, health readback, and
post-audit. The database mutation and canonical table rebuild are one database
transaction where the backend supports transactional DDL. Object deletion is
idempotent and journaled because it cannot share that transaction. A failure
after `DATABASE_SCHEMA_COMMITTED` never rolls back to a legacy reader or starts
Station; a retry must present the same manifest digest and continue the first
incomplete journal transition. A different manifest or target is rejected.

Post-audit requires:

- byte-equal public snapshot hashes and counts;
- zero remaining reset-target rows, retired columns/table, private OSS metadata
  references, and canonical private object bytes;
- exact canonical private schema and indexes;
- no production reader/writer for a retired shape;
- Station health and live source identity equal the reset manifest.

Only `POST_AUDIT_PASSED -> COMPLETE` is success. Cancellation, timeout, lease
loss, deployment failure, object-delete failure, or audit mismatch is a typed
partial failure and cannot be reported as a successful reset.

### Rationale

A full private Development reset removes the need to distinguish recoverable
encrypted test data from plaintext-era data inside a reused table. Exact
allowlists and owner-mediated object deletion prevent a broad name pattern from
crossing into public or Conversation state. The journal makes unavoidable
database/object non-atomicity resumable without restoring a legacy path.

### Alternatives Considered

- Drop every `social_private_*` table: rejected because thirteen names are
  canonical Secure Content state and `social_private_posts` is reused.
- Delete only rows with missing `post_id`: rejected because it preserves mixed
  private state and leaves legacy columns/constraints.
- Preserve canonical private rows during schema rebuild: rejected because W12
  is an authorized Development reset and mixed-schema preservation adds a
  second migration problem.
- Delete object keys parsed from JSON directly: rejected because shared/public
  references and backend ownership would be bypassed.
- Best-effort object cleanup after Station restart: rejected because a partial
  hard cut would become live.
- Treat pre/post row counts as sufficient: rejected because equal counts do not
  prove equal public content or objects.

### Consequences

- W12 must implement `schema_audit` and `reset` from this contract before any
  destructive command is legal.
- The reset command requires the exact W12 declaration, profile/scope
  authorization, live `station.reset` lease, clean source, immutable manifest,
  and explicit environment guard.
- W12 data loss is intentional and limited to private Social Development state
  on the two named profiles.
- Key Exchange claims consumed by deleted Social plans remain consumed; reset
  does not reactivate or delete one-time keys.
- The plan, work-item scopes, commands, and evidence paths must be amended only
  after this decision passes review and receives explicit Owner acceptance.

### Review And Reversal Conditions

Review this decision if production migration becomes required, if
`social_private_posts` stops reusing its historical table name, or if Social
and OSS gain one atomic cross-backend deletion transaction. Any replacement
must retain exact target authorization, public hash preservation, owner-mediated
object deletion, resumable partial failure, and no compatibility path.

The Owner accepted this decision and authorized the exact Development reset
scopes `station-four-social-private` and
`station-five-arm-social-private` on 2026-09-17 at checkpoint
`bd8dad8b3a5e95c4f3bf002c244d605461c3517d`.

---

## SC-D24: Canonical Private Schema Activation Precedes Private-Content Journeys

**Status**: accepted
**Date**: 2026-09-19

### Context

Exact-source W7 execution at checkpoint
`ec5c5150501d78d61b7bdf78eb9ba7657dc5d9d5` passes private prepare, Content
PreKey claim validation, envelope signature verification, and commit-proof
construction, then fails on the first canonical `SocialPrivateContentPost`
insert.

The live `four` PostgreSQL schema retains plaintext-era columns `id`,
`author_id`, `type`, and `audience_kind` as `NOT NULL` without defaults. The
canonical encrypted model intentionally does not populate them. SC-D23 assigns
their removal to the W12 reset after W11, but W7 and W11 require canonical
private writes before W12. The accepted target state is therefore unreachable
under the current dependency order.

### Decision

#### One reset owner and one implementation

SC-D23 remains the complete mutation, allowlist, public-snapshot, object-owner,
lease, journal, and failure contract. No second migration or schema mutator is
introduced.

SC-D24 supersedes only SC-D23's task-timing clauses
`W12 may target only` and `the reset command requires the exact W12
declaration`. They become: only a Plan-declared reset task with one closed reset
intent may target the two already accepted SC-D23 scopes. SC-D23's target
profiles, destructive scopes, database/object allowlists, dependency order,
public snapshot, journal, failure behavior, and final W12 evidence meaning
remain unchanged.

The reset path has exactly three owners:

- Local Dev Control Plane authenticates the workspace, plan/task, exact
  destructive scope, source HEAD, and live `station.reset` lease.
- The Secure Content Development reset owner creates and verifies the immutable
  reset manifest, quiesces the selected Station, invokes owner operations, and
  advances the journal.
- A non-public Station maintenance entrypoint composes Social's database reset
  service and OSS's object-deletion service.

The maintenance entrypoint is an OS-authenticated CLI reached only through the
reviewed remote deploy transport. The local SSH transport process is a direct
child of the generic `machine-dev` reset-lease wrapper. It exposes no HTTP/RPC
route. The wrapper holds the inherited advisory-lock descriptor for the
complete remote command, while the reset owner revalidates binding,
declaration, source, profile, scope, and process identity after lease
acquisition and before every remote stage.

Each remote attempt receives one canonical `SecureContentResetInvocationV1`
over SSH stdin. The CLI validates its compiled source commit, deployment
environment, destructive scope, reset intent, reset-manifest digest,
declaration digest, and bounded expiry, then acquires a database advisory lock
keyed only by deployment environment and destructive scope. The journal records
the accepted invocation ID and digest. Exact invocation replay returns the
current journal state; a conflicting digest for the same invocation ID, a
different reset manifest for an active journal, an expired invocation, a
closed SSH control channel before an irreversible boundary, or missing local
lease possession fails closed.

Cancellation before the database transaction commits rolls back and leaves the
journal at `PREPARED`. Cancellation or transport loss after a durable
transition leaves Station quiesced and resumes only from the same reset
manifest with a fresh invocation ID. The remote command never advances
past the last durable journal state on timeout or disconnect. The Development
runner never executes SQL, DDL, storage deletion, OSS-table mutation, or the
maintenance CLI directly.

#### Two separately authorized reset intents

The same reset implementation may execute with one of two closed intents:

```text
SCHEMA_ACTIVATION
FINAL_CUT
```

`SCHEMA_ACTIVATION` runs once per approved profile and exact source/runtime
checkpoint before any canonical private Social product Journey. It performs
the complete SC-D23 reset and publishes a
`CanonicalPrivateSchemaAttestationV1` only after `COMPLETE`. Source, runtime,
service-attestation, or schema drift invalidates that attestation and requires
a fresh authorized activation.

`FINAL_CUT` runs after the hard-cut regression source and product matrix are
ready. It performs a fresh complete SC-D23 reset, then the final product matrix
repopulates only canonical state. An activation result cannot satisfy the final
cut or W12 `FUNCTIONAL_PASS`.

Each reset run requires a fresh reset ID, immutable manifest, declaration,
exact scope authorization, and lease. Retry attempts preserve that reset ID
and manifest but use fresh invocation IDs. A completed activation journal does
not authorize or substitute for a final-cut journal.

#### Runtime admission

Every Development Runtime Manifest that admits a private Social Journey must
bind one current `CanonicalPrivateSchemaAttestationV1` for each referenced
Station service. The attestation binds:

- source commit, workspace, profile, deployment environment, destructive
  scope, Station service ID, Station peer ID, runtime identity, and exact
  service-attestation digest;
- reset intent `SCHEMA_ACTIVATION` or `FINAL_CUT`;
- reset-manifest and completed-journal digests;
- canonical private schema digest and retired-column absence;
- post-audit public snapshot digest.

Missing, stale, wrong-source, wrong-profile, non-complete, or schema-mismatched
attestation returns `CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE` before the first
private product action. Admission revalidates the current Station service
identity and canonical private schema through the OS-authenticated maintenance
owner. The public snapshot remains immutable reset-time provenance; legitimate
post-activation public or private product writes do not invalidate it.

### Rationale

Canonical writers cannot run against a mixed schema without either fabricating
retired plaintext fields or weakening legacy constraints. Both create a
compatibility path and violate SC-D10 and SC-D23. Reusing the exact SC-D23 reset
owner before W7 activates the already accepted target schema while preserving
the final post-W11 cut as an independent destructive proof.

### Alternatives Considered

- Populate `id`, `author_id`, `type`, or `audience_kind` from canonical writes:
  rejected because retired plaintext fields would remain a live write contract.
- Make retained legacy columns nullable or add defaults until W12: rejected as
  a temporary compatibility layer without a distinct truth owner.
- Create a second canonical private-post table and swap later: rejected because
  it creates parallel Social private truth and a second migration.
- Point W7 at an undeclared fresh database or profile: rejected because runtime
  topology and destructive scope would escape the approved control plane.
- Move the existing final W12 result wholesale before W7: rejected because its
  post-reset complete product matrix cannot run before W7-W11 implementation.

### Consequences

- A plan amendment must add a schema-activation reset task before W7 while
  retaining the final-cut reset and complete matrix after W11.
- The reset maintenance entrypoint and attestation contract must be implemented
  before either destructive invocation is legal.
- Both `four` and `fiveArm` lose all private Social Development state during
  activation and again during final cut; public and non-Social state remain
  byte-equal under SC-D23.
- Key Exchange one-time claims remain consumed across both resets.
- W7 stays `UNPROVEN` until SC-D24 is mechanically planned and both profile
  attestations are current.

### Review And Reversal Conditions

Review this decision if production migration becomes required, if canonical
private writes move to a new table name, or if SC-D23's owner/allowlist/journal
contract changes. Any replacement must remove the dependency cycle without a
compatibility writer, undeclared profile, direct database mutation, or weaker
public-preservation proof.

The review passed and the Owner accepted this decision on 2026-09-19, based on
review checkpoint `83f5f24d53a6a50f5dd59c1820832ab09ecf4346`. The acceptance
authorizes the mechanical execution-plan amendment. It does not itself
authorize implementation, destructive reset execution, W7 `FUNCTIONAL_PASS`,
push, pull-request creation, or history rewrite.

---

## SC-D25: A Fresh Authorized Source May Supersede Only A PREPARED Reset

**Status**: accepted
**Date**: 2026-09-20

### Context

W12A activation generation
`72804854cdd45c1b5927610aa53987b8aeb00a8e` persisted reset
`2e325290257b47949a3852a4b92a5a8c` at `PREPARED`, then its transactional
schema rebuild failed and rolled back before `DATABASE_SCHEMA_COMMITTED`.
Correcting that source defect requires a fresh source checkpoint and reset
identity under SC-D24, but the existing journal model treats every
non-`COMPLETE` reset as active and defines no legal way to retire a
source-invalidated `PREPARED` identity.

Deleting the old journal would erase audit truth. Resuming it with a different
compiled source would violate manifest/source binding. Treating a recorded
failure as terminal would let transient failures silently unlock the scope.

### Decision

`SUPERSEDED` is a terminal, non-successful reset journal state. The only legal
supersession transition is:

```text
PREPARED -> SUPERSEDED
```

The Station reset store performs this transition atomically while accepting the
first invocation for a fresh manifest. Supersession is allowed only when:

- the new invocation has already passed declaration, Plan task, source,
  profile, deployment environment, destructive scope, lease, process, intent,
  manifest, and expiry validation;
- the old journal is exactly `PREPARED`;
- the old and new manifests bind the same workspace, profile, deployment
  environment, destructive scope, and reset intent;
- the source commits differ; and
- both immutable manifest digests remain valid.

The same transaction locks every active journal for the scope, appends the
old journal's `PREPARED -> SUPERSEDED` transition, records
`RESET_SOURCE_SUPERSEDED`, admits the already-audited fresh manifest, and
inserts its invocation and `PREPARED` journal. Any same-source manifest
conflict, post-commit state, identity mismatch, or concurrent change rolls back
the whole admission and remains `RESET_MANIFEST_CONFLICT`.

A `SUPERSEDED` journal:

- remains durable with its manifest, accepted invocations, object targets,
  transition history, and failure record;
- is excluded from active-scope conflict checks;
- cannot resume, advance, emit a schema attestation, satisfy an activation or
  final-cut child, or count as successful evidence; and
- does not imply that database rows, schema, or object bytes were mutated.

### Rationale

The new activation admission is already the only point holding the exact
source-bound declaration, reset lease, remote advisory lock, and fresh
manifest. Atomic supersession there prevents an unauthenticated cleanup
command, preserves one reset owner, and guarantees that the scope is never
observed without either the old active journal or the new `PREPARED` journal.

### Alternatives Considered

- Delete the old manifest and journal: rejected because reset identities and
  attempts are immutable audit records.
- Ignore journals carrying a failure code: rejected because retryable failures
  must preserve the same manifest and remain active.
- Resume the old manifest with the corrected binary: rejected because the
  compiled source would differ from the immutable manifest source.
- Add a standalone cleanup command: rejected because it creates a second
  admission path and a gap between releasing the old scope and creating the
  new journal.
- Supersede any non-complete state: rejected because every state after
  `PREPARED` may already include irreversible mutation and must resume only
  from the same manifest.

### Consequences

- Journal validation and aggregation must recognize `SUPERSEDED` as terminal
  non-success without adding it to the successful linear chain.
- W12A must prove atomic supersession, same-source rejection, identity
  mismatch rejection, and refusal after `DATABASE_SCHEMA_COMMITTED`.
- Existing incomplete reset directories remain immutable and cannot be
  relabelled as successful children.
- No schema version bump is required because `current_state` and transition
  values are already closed string fields within `ResetJournalV1`; the
  accepted value set is extended without changing field layout.

### Review And Reversal Conditions

An independent findings-first architecture review on 2026-09-20 found no
remaining ownership, security, data-loss, replay, or evidence-boundary
finding. Review this decision if reset admission moves away from the Station
advisory-lock transaction or if any mutation is allowed before `PREPARED`.

---

## SC-D26: A Reviewed Source Defect May Replace One Closed Post-Commit Reset Boundary Through An Immutable Predecessor Link

**Status**: accepted
**Date**: 2026-09-20

### Context

W12A reset `8c11416373ea428e9eb871def7cee86d` committed the database
reset, deleted its object targets, deployed source
`1e66d535b4c35cc09fffda9dc6be99226c9b2422`, and then failed canonical
schema post-audit with `RESET_SCHEMA_TARGET_UNREVIEWED`.

The failure exposed one source contradiction. The canonical
`SocialPrivateContentPlan` model omitted the four durable prepare-binding
columns then in scope, while a second private GORM model wrote those columns into the same
`social_private_content_plans` table:

```text
audience_bytes
audience_sha256
subtype_prepare_authority_bytes
subtype_prepare_authority_sha256
```

The database state is not legacy data and cannot be rolled back. The failed
journal cannot resume under corrected source because its immutable manifest
binds the old source. SC-D25 correctly forbids treating a post-commit reset as
an unexecuted `PREPARED` reset, but the reset state machine has no source-safe
way to finish the hard cut after a post-deploy source defect.

### Decision

#### One canonical plan model

`SocialPrivateContentPlan` is the only schema owner for
`social_private_content_plans`. The four SC-D26 prepare-binding columns move
into that model and are written with the initial `PREPARING` insert. SC-D29
later adds canonical Group-recipient-snapshot bytes/hash to the same owner, for
six durable prepare-binding columns in the current schema. The shadow
table-mapping model is deleted. Replay may project a `PrivatePrepareBinding`
from the canonical row, but that projection does not own schema or persistence.

#### One narrow recovery boundary

Add terminal non-success state:

```text
OBJECTS_DELETED -> RECOVERY_REPLACED
STATION_DEPLOYED -> RECOVERY_REPLACED
```

This transition is legal only while admitting the first invocation for a fresh
manifest whose immutable `recovery_predecessor` binds:

- predecessor reset ID and manifest digest;
- predecessor pre-transition journal digest;
- predecessor state `OBJECTS_DELETED` or `STATION_DEPLOYED`;
- replacement reason `RESET_SOURCE_SUPERSEDED` for an unfailed
  `OBJECTS_DELETED` handoff, or the retained
  `RESET_SCHEMA_TARGET_UNREVIEWED` failure for `STATION_DEPLOYED`.

The Station reset owner derives this record from the locked durable journal and
manifest. The caller cannot nominate, override, or omit an eligible
predecessor.

The old and fresh manifests must bind the same workspace, profile, deployment
environment, destructive scope, reset intent, and database identity. Their
source commits and reset IDs must differ. The fresh pre-audit public snapshot
must be byte-equal to the predecessor manifest's public snapshot.

The Station store locks every active journal for the scope and performs the
predecessor transition plus fresh `PREPARED` journal creation in one database
transaction under the existing deployment-environment/scope advisory lock.
The predecessor manifest, object targets, invocation history, transition
history, and any original failure remain intact. An `OBJECTS_DELETED`
predecessor records `RESET_SOURCE_SUPERSEDED` at replacement.
`RECOVERY_REPLACED` cannot resume, advance, emit an attestation, satisfy a
child result, or count as success.

The fresh reset executes the complete SC-D23 allowlist from its current
database/object inventory. Already absent rows or bytes remain an idempotent
empty target; no previous mutation is claimed as fresh success. Before the
fresh reset may pass post-audit, it also loads every predecessor object target
from the complete, bounded predecessor chain's immutable Station target ledgers
and asks the original Social or OSS owner to prove that target remains deleted.
A cycle, excessive depth, missing or altered ledger, ambiguous target, or live
predecessor target fails closed. Only the fresh reset's own
`POST_AUDIT_PASSED -> COMPLETE` transition may emit the canonical schema
attestation.

#### Fail-closed exclusions

Recovery replacement is rejected when:

- no exact predecessor link is present;
- the predecessor is `PREPARED`, `DATABASE_SCHEMA_COMMITTED`,
  `POST_AUDIT_PASSED`, `COMPLETE`, `SUPERSEDED`, or already
  `RECOVERY_REPLACED`;
- an `OBJECTS_DELETED` predecessor already has a failure, or a
  `STATION_DEPLOYED` predecessor lacks
  `RESET_SCHEMA_TARGET_UNREVIEWED`;
- identity, database, public snapshot, manifest digest, journal digest, source
  difference, or reset-ID difference does not match;
- more than one active journal exists for the scope; or
- the predecessor changes between fresh audit and invocation admission.

SC-D25 remains the only source replacement rule before mutation:
`PREPARED -> SUPERSEDED`. SC-D26 does not generalize arbitrary post-commit
supersession. If a `PREPARED` reset already carries a recovery predecessor and
SC-D25 replaces that uncommitted reset, the fresh manifest inherits the exact
same predecessor link; the uncommitted reset itself is not added to the chain.

### Rationale

The fresh manifest is the only durable place that can declare why a new reset
is allowed to follow irreversible old work. Binding the exact pre-transition
journal makes the recovery chain reviewable and race-sensitive. Performing the
old terminal transition and new journal creation atomically preserves one
active reset owner without deleting history or creating a standalone cleanup
command.

Moving the four columns into the canonical model removes the split schema
authority that caused the incident. Re-executing the complete reset keeps the
success claim local to one source, one manifest, and one complete journal.

### Alternatives Considered

- Resume the old journal with corrected source: rejected because it violates
  immutable source binding.
- Mark the old journal `COMPLETE`: rejected because post-audit failed and no
  attestation exists.
- Extend SC-D25 to every post-commit state: rejected because arbitrary partial
  failures may require different recovery and could hide data loss.
- Delete or rewrite the old journal/evidence: rejected because it destroys
  audit truth.
- Add the four columns to the reset validator only: rejected because the
  shadow GORM model would remain a second schema owner.
- Mutate the database directly and continue: rejected because it bypasses the
  reset owner, public snapshot, journal, and exact-source proof.

### Consequences

- Reset manifest schema remains `1`; `recovery_predecessor` is optional and
  absent manifests retain byte-identical canonical JSON and digests.
- Journal validation adds `RECOVERY_REPLACED` as a terminal non-success branch,
  not as part of the successful linear chain.
- W12A must prove canonical model ownership, exact predecessor validation,
  public/database identity equality, atomic replacement, race rejection,
  terminal replay, predecessor object-target absence, and refusal for every
  non-approved state/failure.
- The current failed reset and its local artifacts remain immutable. The next
  four-profile activation uses a fresh reset ID and source generation, then
  fiveArm proceeds serially.

### Review And Reversal Conditions

The design is valid only while reset admission and journal mutation remain in
one Station transaction under the existing advisory lock. Review it if a
post-deploy failure other than `RESET_SCHEMA_TARGET_UNREVIEWED` needs recovery,
if public writes are allowed while Station is quiesced, or if reset state moves
outside the Station database.

An independent findings-first review on 2026-09-20 initially found that a
successor could lose proof of predecessor object deletion after business rows
were cleared. The owner-mediated predecessor target-ledger verification above
resolved that finding; the re-review returned `DESIGN_REVIEW_PASS`.

---

## SC-D27: Recovery Replacement Separates Admission Proof From Append-Only Execution Provenance

**Status**: accepted
**Date**: 2026-09-21

### Context

W12A exposed two contracts that SC-D26 did not model:

1. after `OBJECTS_DELETED`, a deployment handoff may record
   `RESET_PARTIAL_FAILURE` even though the database transaction and every
   owner-mediated object deletion already completed;
2. a recovery successor may reach `STATION_DEPLOYED` and expose a
   source defect while validating its inherited predecessor chain as
   `RESET_JOURNAL_STATE_CONFLICT`.

The implementation also attempted to recompute the predecessor's
pre-transition journal digest after changing the predecessor to
`RECOVERY_REPLACED`. That is invalid because replacement changes the terminal
state and may replace the mutable failure projection. The original digest is
an optimistic concurrency token for admission, not a value derivable from the
later terminal row.

### Decision

The Station reset store owns an append-only recovery-replacement receipt. One
receipt binds:

- predecessor reset ID, manifest digest, pre-transition journal digest, state,
  and original failure code;
- the initial successor reset ID and manifest digest;
- the replacement reason and replacement timestamp.

The predecessor link in the immutable successor manifest authorizes admission
and carries the compare-and-swap digest. The replacement receipt proves that
the comparison and state transition executed. The receipt, predecessor
`RECOVERY_REPLACED` transition, fresh `PREPARED` journal, and first accepted
successor invocation commit or roll back in one transaction under the existing
scope advisory lock.

The closed recovery matrix is:

| Predecessor boundary | Original failure | Replacement reason | Additional proof |
|---|---|---|---|
| `OBJECTS_DELETED` | absent | `RESET_SOURCE_SUPERSEDED` | none |
| `OBJECTS_DELETED` | `RESET_PARTIAL_FAILURE` | `RESET_SOURCE_SUPERSEDED` | the state proves database and object mutation completed before the deployment handoff |
| `STATION_DEPLOYED` | `RESET_SCHEMA_TARGET_UNREVIEWED` | `RESET_SCHEMA_TARGET_UNREVIEWED` | none |
| `STATION_DEPLOYED` | `RESET_JOURNAL_STATE_CONFLICT` | `RESET_SOURCE_SUPERSEDED` | the predecessor manifest already carries a recovery link and its complete bounded chain validates under the admission transaction |

No other state/failure tuple is eligible. A fresh reset still executes the
complete SC-D23 allowlist and verifies every inherited object target during
post-audit.

The predecessor journal retains its original `failure_code` and `failure_at`.
`replacement_reason` exists only in the append-only receipt. Terminal chain
validation requires exactly one matching receipt, exact manifest identities,
the legal terminal transition, bounded acyclic continuity, and equal
workspace/profile/environment/scope/intent/database/public identities. It
does not reconstruct the admission digest from the terminal row.

SC-D25 may supersede a `PREPARED` recovery successor. The replacement receipt
continues to name the first successor that admitted the predecessor, while
later successors inherit the byte-identical predecessor link and validate
against that same receipt.

The already-created W12A recovery chain predates the receipt table. W12A may
run one owner-controlled migration over an explicitly enumerated immutable
manifest/journal tuple. The migration runs under the same advisory lock,
proves exact set equality between legacy `RECOVERY_REPLACED` transitions and
new receipts, and records whether the original failure was established by an
exact digest reconstruction or by the reviewed source eligibility matrix.
Unknown, extra, or ambiguous rows fail closed. The migration path must be
removed before the final W12A source freeze; normal runtime never falls back
when a receipt is absent.

### Rationale

The state machine already proves that `OBJECTS_DELETED` follows committed
database mutation and successful owner-mediated object deletion. A later
deployment-handoff failure therefore does not weaken the fresh reset's duty to
repeat the full operation. An ancestry-qualified journal conflict is also safe
to replace because admission validates the complete predecessor chain first,
and the fresh reset can earn success only by validating that chain and its
object ledgers again.

Separating authorization from execution provenance preserves one truth for
each concern. It avoids reconstructing historical state from a row that was
intentionally terminalized and avoids conflating an original failure with the
reason a newer source replaced it.

### Alternatives Considered

- Keep recomputing the old digest from the terminal row: rejected because the
  old failure projection may no longer be recoverable.
- Accept every `RESET_PARTIAL_FAILURE` or `RESET_JOURNAL_STATE_CONFLICT`:
  rejected because those codes are too broad without the exact state and
  ancestry constraints above.
- Rewrite or delete the existing journals: rejected because it destroys audit
  truth and bypasses the reset owner.
- Keep a permanent legacy fallback when a receipt is missing: rejected because
  it creates a second validation path and allows incomplete provenance to
  survive the hard cut.

### Consequences

- The reset control schema gains one append-only replacement-receipt table.
- Recovery admission and terminal validation gain explicit receipt checks and
  full-chain validation under the transaction lock.
- W12A requires one bounded migration checkpoint, followed by deletion of the
  migration path and fresh final-source activation on both profiles.
- Existing manifests and journal state values remain immutable; no API or
  reset-manifest schema version changes.

### Review And Reversal Conditions

Review this decision if recovery admission and terminalization stop sharing
one transaction, if a new post-commit state or failure needs recovery, or if
the reset journal moves outside the Station-owned database.

An independent findings-first review on 2026-09-21 required the append-only
receipt, original-failure preservation, exact eligibility matrix, transactional
ancestry validation, SC-D25 initial-successor semantics, and bounded migration
fence. The amended decision includes each requirement; re-review returned
`DESIGN_REVIEW_PASS`.

---

## SC-D28: Runtime Services Separate Canonical Schema Identity From Live Connection Routing

**Status**: accepted
**Date**: 2026-09-21

### Context

W7 exact-source execution at checkpoint
`15c0a78583650b1b5470773cd84cb8c506edd9f6` proved that one Runtime Manifest v2
service currently overloads `endpoint` with two incompatible identities:

- the runtime service attestation and client Harness correctly bind the
  owner-created connection endpoint, which may be an ephemeral local SSH
  tunnel; and
- the W12A `CanonicalPrivateSchemaAttestationV1.service_attestation_digest`
  binds the canonical deployment endpoint recorded by the approved profile.

The runtime owner validates the schema attestation against the canonical
profile endpoint before launch, but then publishes only the tunnel endpoint.
Manifest admission therefore recomputes the schema-attestation digest from the
tunnel and rejects valid exact-source activation evidence. Replacing the live
endpoint with the canonical endpoint would make client connection and Harness
identity false.

### Decision

`DevelopmentRuntimeManifestV3` supersedes v2 in one hard cut. Every Station
service carries two required,
closed endpoint fields:

- `endpoint` is the runtime-owner-created connection endpoint consumed by
  clients, scenario transports, the live service attestation, and Harness
  identity validation. It may be an ephemeral loopback tunnel.
- `schema_attestation_endpoint` is the profile-owned canonical deployment
  endpoint used only when reconstructing the service-attestation binding
  digest referenced by `CanonicalPrivateSchemaAttestationV1`. It is copied
  from the reviewed profile that authorized W12A activation.

Both fields are validated as endpoints and are digest-bound by the runtime
manifest. They may be equal when the live connection uses the canonical route,
but they are never inferred from each other. A service attestation artifact
must still match `endpoint`. The schema-attestation binding projection copies
the service identity fields but replaces the projection's `endpoint` member
with `schema_attestation_endpoint`; the live `endpoint` is excluded from that
digest. A canonical schema attestation must match that exact projection.
Client identity and scenario transport continue to consume only `endpoint`.

The runtime owner is the sole writer of both fields. Business scenarios,
clients, and manifest readers cannot replace either endpoint, fall back from
one to the other, or derive a canonical endpoint from a service ID, profile
name, environment, CLI order, or network address.

Missing, malformed, substituted, or cross-boundary endpoint data fails before
the first private product action:

- missing service fields or a malformed live connection `endpoint` returns
  `SERVICE_CLOSURE_MISMATCH`;
- a malformed `schema_attestation_endpoint`, or a valid endpoint whose
  reconstructed digest mismatches the canonical schema attestation, returns
  `CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE`; and
- a valid live endpoint whose service attestation or Harness observation
  mismatches returns `SOURCE_ATTESTATION_MISMATCH` or
  `STALE_CLIENT_IDENTITY`.

### Rationale

Connection routing and deployment attestation answer different questions. A
local tunnel proves how this runtime reaches the Station; the canonical
profile endpoint proves which reviewed deployment W12A activated. Encoding
both identities explicitly preserves one manifest owner and keeps each
validator bound to the source it actually proves.

### Alternatives Considered

- Replace `endpoint` with the canonical profile URL: rejected because clients
  and Harness would no longer bind the connection they actually use.
- Recompute the W12A digest from the tunnel endpoint: rejected because it would
  relabel activation evidence for a different service-attestation identity.
- Skip the schema service-attestation digest check: rejected because it weakens
  exact-deployment admission.
- Infer the canonical endpoint from `profile_id` or
  `deployment_environment`: rejected because it creates a second topology
  source outside the runtime owner.
- Add fallback validation that accepts either endpoint: rejected because it
  creates ambiguous dual truth and hides substituted topology.

### Consequences

- Runtime Manifest v3 is the only accepted reader/writer contract. Version `2`
  is removed from admission, and no alias, migration reader, or fallback is
  retained.
- W7, W8, W9, W10, W11, and W12 runtime owners must publish both endpoints
  wherever they reuse the shared service payload.
- Existing W12A activation artifacts remain immutable history. The source
  amendment requires a fresh source freeze and fresh FOUR/FIVEARM activations
  before product execution resumes.
- No Station API, product contract, profile, tunnel lifecycle, or reset schema
  changes.

### Review And Reversal Conditions

Review this decision if deployment attestations stop binding endpoint identity
or if the Local Dev Control Plane introduces one cryptographically stable
service locator that is simultaneously the canonical deployment identity and
the actual client connection route. Any replacement must preserve strict
separation until those identities are demonstrably identical.

An independent findings-first review on 2026-09-21 required a v3 hard cut,
owner-specific endpoint errors, the complete closed service shape, and an
explicit canonical digest projection. The amended decision includes each
requirement; re-review returned `DESIGN_REVIEW_PASS`.

---

## SC-D29: Audience Targets Are Typed And V1 Private Expansion Remains Locally Enumerable

**Status**: accepted
**Date**: 2026-09-24

### Context

W8 exact-source execution proved three connected gaps:

1. Social `Audience.target_id` is one `uint64` used for both numeric Social
   Circle IDs and canonical string Conversation IDs.
2. `CUSTOM_DENY(PUBLIC)` has no finite, revision-bound federated Actor set that
   can be frozen into the immutable recipient/envelope snapshot required by
   `SC-D06`.
3. The W8 runtime owner starts only `station-four` and provides no
   owner-produced identity for a real remote recipient, so the accepted
   unsupported cross-Station boundary cannot be proved.

### Decision

`Audience.target_id` is retired in one hard cut. The canonical proto uses one
discriminated target:

```protobuf
oneof target {
  uint64 circle_id = 2;
  string group_conversation_id = 6;
}
```

The old field name `target_id` and the historical field number `5` remain
reserved. A CIRCLE audience requires only `circle_id`; a GROUP audience
requires only `group_conversation_id`; every other kind rejects either target.
Generated Go, Rust, Desktop TypeScript, and Mobile TypeScript consumers move to
the typed fields in the same source generation.

Conversation exposes one narrow in-process query capability with two explicit
operations:

```go
PrepareSnapshot(ctx, conversationID, authorPTID)
WithSubmitFence(ctx, expectedSnapshot, commit)
```

`PrepareSnapshot` reads through the Conversation UOW. `WithSubmitFence` opens a
Conversation-owned read-only transaction, locks the canonical Conversation row,
validates the expected snapshot, invokes a Social commit callback that receives
only the verified snapshot, and releases the fence after the callback returns.
Conversation membership mutations acquire the same row lock and never acquire
Social locks. The provider:

- validates a live Group conversation and active author membership;
- returns active members with their Home Station, membership epoch, and
  authority head hash; and
- exposes no Conversation repository or mutation capability to Social.

This read fence is legal only in the co-located Station process with one RDS
identity; otherwise GROUP private publish is unavailable. Social never imports
Conversation persistence and Conversation never mutates Social state. The
global lock direction is Conversation fence then Social UOW. The callback
cannot access Conversation persistence, and no reverse Social-to-Conversation
call is allowed from inside the Social commit.

Social filters blocked actors, excludes the author from recipient grants, and
binds the Conversation ID, membership epoch, authority head hash, ordered
member PTIDs, and Home Station identities into its audience snapshot. Prepare
and submit both use the Conversation-owned capability; submit requires byte-for-
byte equality with the prepared snapshot while holding the read fence through
Social commit.

Before any Content PreKey claim, the Actor Identity port resolves the canonical
Home Station of every recipient produced by FRIENDS, FOLLOWERS, CIRCLE, or
CUSTOM rules; GROUP uses Conversation's member Home Station projection. The
locality projection is bound into the authorization snapshot. Actor Home
Station is immutable for a canonical PTID in v1, so submit verifies that stored
commitment rather than opening an Actor Identity mutation transaction. The
read adapters cannot call Social. One remote recipient rejects the whole
publish as `PRIVATE_UNSUPPORTED`; no recipient is silently removed.

`CUSTOM_DENY` accepts only `FOLLOWERS` as `base_kind` in v1.
`CUSTOM_DENY(PUBLIC)` is rejected as `PRIVATE_UNSUPPORTED` before encryption.
No implementation may approximate PUBLIC with local accounts, cached profiles,
known peers, followers, or existing Conversation members.

The Actor Identity fixture provisioner creates and acknowledges a fiveArm-only
Actor. The W8 runtime owner attaches both `four` and `fiveArm` plus the
provisioner-issued opaque `remote-private-recipient` handle to the immutable
runtime manifest. The scenario obtains the remote PTID only through that
owner-controlled action and proves rejection, zero Content PreKey claims, and
absence of partial Social rows. This is negative boundary evidence, not
cross-Station private-sharing support.

### Rationale

Typed targets preserve each domain's canonical identity instead of coercing a
Conversation ID into a Social numeric namespace. Restricting v1 private
recipient expansion to enumerable same-Station authorities keeps the frozen
cryptographic recipient set equal to Social delivery truth. A real secondary
Station fixture proves the deferred federation boundary without synthetic
identities or accidental partial delivery.

### Alternatives Considered

- Convert Conversation IDs to numeric aliases: rejected because Social would
  create a second Conversation identity authority and collision lifecycle.
- Change the shared target to an untyped string: rejected because Circle and
  Group validation would remain ambiguous and every consumer would need
  runtime string interpretation.
- Enumerate locally known Actors for `CUSTOM_DENY(PUBLIC)`: rejected because
  the set is incomplete, unversioned, and not federated PUBLIC truth.
- Silently drop remote Group members: rejected because it narrows user intent
  and violates exact recipient coverage.
- Use a fabricated remote PTID in W8: rejected because it cannot prove the
  production identity and Station boundary.

### Consequences

- The Social Audience wire and all generated consumers change in one source
  generation; field `5` remains reserved and no compatibility reader or writer
  is retained.
- W12A is reopened through the Plan's source-invalidation policy. The new source
  generation invalidates prior W7/W8 evidence and requires fresh `four` and
  `fiveArm` schema activation before replay.
- W12A pre-freeze checks cover Conversation and Social, generated Go/Rust/
  Desktop/Mobile contract parity, and zero references to the retired Audience
  target field or compatibility aliases.
- `GROUP` remains required for same-Station private Moments. Federated Group
  private delivery and `CUSTOM_DENY(PUBLIC)` require later product and
  architecture decisions.
- W8 runtime declarations now require both approved profiles and Station
  connections, while destructive reset scope remains owned only by W12A/W12.

### Review And Reversal Conditions

Review the v1 locality restriction only after Actor Identity or Social owns a
complete, revision-bound federated recipient authority and remote Content
PreKey delivery has receiver-side product evidence. Replacing the typed oneof
requires a new wire decision and a hard-cut consumer inventory.

The Owner authorized this choice on 2026-09-24 after W8 exact-source evidence
exhausted the previous contract.

**2026-10-03 successor note**: the same-Station restriction remains the current
implementation guard until the Native Desktop cross-Station plan completes.
Its removal is governed by `CSS-D02..CSS-D09` in
`docs/architecture/cross-station-social/decisions.md`. The typed Audience,
Conversation-owned Group snapshot and submit fence, frozen recipient set,
`CUSTOM_DENY(PUBLIC)` rejection and no-partial-publish requirements remain
unchanged. `CSS-D09` supersedes only the locality rejection for verified
same-Federation remote Group members and adds the canonical Federation ID to
the existing Conversation snapshot.

---

## SC-D21: Product Evidence Uses Production-Delegating Barriers And Owner-Controlled Runtime Continuation

**Status**: accepted
**Date**: 2026-09-16

### Context

W7S checkpoint `6590d0997` passes its focused source checks, but the W7
`desktop-pilot` and `browser-private-boundary` journeys still cannot prove the
required lifecycle without inventing behavior in the scenario layer.

Four semantics are missing:

1. deterministic observation at `persisted-before-send`,
   `sent-before-response`, and `response-before-local-commit`;
2. acknowledgement and continuation across a runtime-owner process restart;
3. a terminal boundary for network capture while WebSocket/SSE connections
   remain long-lived;
4. owner-provisioned inputs for account switch, Station switch,
   publisher-device revocation, and historical recovery epoch.

The production Native store, transport, Social/Actor/Recovery authorities, and
machine runtime control plane already own those facts. A scenario-owned
parallel implementation would create false evidence. Sleep, quiet-period, and
timeout assertions would make the result nondeterministic.

### Decision

#### Production-delegating lifecycle barriers

Acceptance-enabled builds expose one local observation controller around the
production operation. The controller has exactly three barrier kinds:

```text
persisted-before-send
sent-before-response
response-before-local-commit
```

The production owner emits each barrier only after its named fact is true and
before the next production-owned mutation begins. A barrier record contains:

- schema version, scenario run ID, operation ID, barrier kind, and ordinal;
- source checkpoint and runtime-manifest digest;
- Native boot identity and session generation;
- bounded production state name plus opaque command/request/state digests;
- one random release token and creation time.

The external scenario may await and release the exact token once. It cannot
create a barrier, mutate store state, supply a response, or skip an ordinal.
Unknown, duplicated, stale-generation, wrong-boot, wrong-operation, or
out-of-order tokens fail closed. The controller is compiled and registered only
for the acceptance feature; production builds have no controller surface.

One process admits at most one armed operation per client/run and keeps no
unbounded waiter queue. Controller disconnect, cancellation, shutdown, or
budget expiry never auto-releases a barrier. The production operation aborts
before the next mutation when cancellation is still possible; otherwise its
existing unknown-outcome state is durably recorded for normal reconciliation.
Other windows cannot arm or release the operation because the process-owned
controller validates the run, operation, boot, and session identities.

The three facts remain owned by production:

- the encrypted Native store proves durable private material, command bytes,
  command state, and send lease before `persisted-before-send`;
- the production transport proves dispatch acceptance before
  `sent-before-response`;
- the production response validator proves a trusted response exists before
  `response-before-local-commit`, while the production store remains the only
  owner allowed to commit `PUBLISHED`, root keys, or per-key state.

Barrier output is evidence metadata only. It contains no plaintext, key,
signature, token, raw request/response, PTID, device ID, or storage path.

#### Runtime-owner restart continuation

A scenario never launches, stops, restarts, deploys, resets, or releases a
product runtime. When a restart is required it:

1. writes an immutable source-bound resume artifact containing the completed
   barrier/result digests and expected continuation;
2. submits a typed restart request to the W7 runtime owner;
3. returns retryable `BLOCKED_RUNTIME_ACTION_REQUIRED`.

The runtime owner validates the request, acquires the required machine-control
lease, preserves only the declared client storage, restarts the selected
process, and publishes a new immutable runtime manifest. The child manifest
must bind:

- parent manifest digest and restart request ID;
- unchanged source checkpoint, profile, client identity, and retained-storage
  identity digest;
- a new Native boot identity;
- a non-regressing session generation;
- the runtime-owner acknowledgement and lease evidence reference.

Continuation attaches only through the child manifest, validates the resume
artifact, requires the changed boot identity, and consumes the restart request
once. The old manifest is invalid for post-restart actions. Any mismatch is
`RUNTIME_CONTINUATION_IDENTITY_MISMATCH`, not a retry against a recaptured
baseline.

#### Deterministic WebSocket/SSE capture termination

The Browser observer assigns one monotonic observer sequence to HTTP requests
and WebSocket/SSE open, frame, error, and close events. After the production
action returns its typed result, the acceptance bridge enqueues a terminal
marker on the same observer event loop. The marker records the capture ID,
action ID, final observer sequence, open-stream identities, and a digest of the
persisted interval.

The capture interval is closed only after the marker itself is persisted.
Events sequenced after the marker belong to another interval even when the
same socket remains open. Socket closure, elapsed quiet time, sleep, polling
silence, process exit, and timeout are never successful terminal evidence.
Missing terminal support returns `STREAM_TERMINAL_BARRIER_UNAVAILABLE`.

#### Owner-provisioned fixture handles

The runtime manifest references one immutable fixture manifest. Each input is
an opaque handle produced by its truth owner:

| Input | Provisioner/authority | Required acknowledgement |
|---|---|---|
| account switch | Actor/session provisioner | both sessions and account-scoped storage identities exist |
| Station switch | environment/runtime provisioner | both approved Station identities and bindings exist |
| publisher-device revocation | Actor Identity provisioner | revocation/profile revision committed |
| historical recovery epoch | Recovery + Key Exchange provisioner | historical epoch and authorized recovery envelope exist |

The scenario may invoke only typed fixture actions declared by those handles.
It may not insert database rows, fabricate actors/PTIDs/devices, mint profiles,
derive an unprovisioned epoch, or substitute in-memory authority. Secret
material is delivered directly to the owning Native runtime through a
run-scoped secret channel and is excluded from manifests, logs, barrier output,
and evidence. Missing fixture capability returns a typed
`FIXTURE_CAPABILITY_UNAVAILABLE` blocker.

### Rationale

The decision makes evidence deterministic while preserving every existing
owner. Production components state when their own facts become true; the
scenario only coordinates and records them. Runtime mutation remains with the
machine-control lease owner, and business fixtures remain with their domain
provisioners.

Manifest lineage and boot identity distinguish real restart continuation from
a second invocation against stale state. An event-loop terminal marker closes
one finite observation interval without pretending a long-lived stream ended.

### Alternatives Considered

- Scenario-side mock store, transport, or authorization state: rejected because
  it proves the harness rather than production behavior.
- Sleep or quiet-period assertions: rejected because scheduler and network
  timing are not commit facts.
- Close WebSocket/SSE to end capture: rejected because stream lifecycle is a
  production runtime concern and closure changes the behavior under test.
- Let the scenario restart Desktop or Station directly: rejected because it
  bypasses `station.deploy`, local-slot, and runtime ownership.
- Reuse the pre-restart manifest after process replacement: rejected because it
  cannot prove new boot identity or retained-storage continuity.
- Let scenarios create actors, revocations, or recovery epochs directly in the
  database: rejected because it bypasses the owning domain state machines.
- Return fixture secrets in the manifest: rejected because manifests and
  evidence are durable, inspectable control-plane artifacts.

### Consequences

- W7S must implement the acceptance-only observer/controller by calling the
  production store, transport, response-validation, and Browser observer paths;
  it cannot add a parallel business implementation.
- The Development runner must support immutable resume artifacts, restart
  requests, child-manifest lineage, one continuation, and the typed fail-closed
  outcomes defined above.
- W7 runtime ownership must provide restart acknowledgement and fresh manifest
  publication while preserving the declared client storage.
- Domain/Provisioner owners must supply the four fixture handles before their
  corresponding journey branch can run. Their absence parks only that branch.
- W7S and W7 remain blocked on Owner acceptance of this decision. Acceptance
  of `SC-D21` authorizes planning and implementation; it does not establish
  `FUNCTIONAL_PASS`, formal Acceptance, deploy/reset authority, or W8 scope.

### Review And Reversal Conditions

Review this decision if the production store or transport can no longer expose
the three boundaries without changing business semantics, if the machine
control plane replaces immutable runtime manifests, or if Browser observation
moves to a sequenced protocol with its own canonical terminal acknowledgement.
Any replacement must preserve production ownership, fail-closed evidence,
secret exclusion, and deterministic ordering. A convenience-only test API,
quiet-period fallback, or scenario-owned runtime action is not a valid
reversal trigger.
The Owner accepted this decision on 2026-09-16.

---

## SC-D20: Content PreKey Maintenance Uses Canonical Key Exchange Client Routes

**Status**: accepted
**Date**: 2026-09-15

### Context

`SC-D15` defines authenticated Content PreKey publication, inventory, epochs,
signatures, replay, quotas and claim-time validation. W3 implements those rules
behind `ContentPreKeyCapabilities`, but that capability intentionally registers
no public route. W7 therefore cannot build a real Native publisher,
replenishment worker or recipient path without inventing a client boundary.

The existing generated contract already contains the publish and inventory
messages. The missing architecture is the route ownership, command-level
unknown-outcome recovery, canonical transport, typed error projection,
authentication boundary and Native private-key lifecycle.

### Decision

Key Exchange exposes exactly two client-facing support capabilities:

| Capability ID | Method and path | Request / response |
|---|---|---|
| `key_exchange.content_prekey.publish` | `POST /key-exchange/content-prekeys/publish` | `PublishContentPreKeysRequest` / `PublishContentPreKeysResponse` |
| `key_exchange.content_prekey.inventory` | `POST /key-exchange/content-prekeys/inventory` | `GetContentPreKeyInventoryRequest` / `GetContentPreKeyInventoryResponse` |

Both routes are Key Exchange-owned and use only `application/protobuf`. They
accept no query alternative, JSON representation, route alias or public
`/secure-content/*` facade. Publish has a 128 KiB body limit and inventory has
a 4 KiB body limit, both enforced before allocation through the shared server
transport. Each request completes synchronously within the shared request
timeout; no handler-local queue is added.

The shared server layer adds one reusable canonical-protobuf handler mode. It:

1. rejects every non-protobuf content type and any query data;
2. reads no more than the route-specific body limit;
3. rejects recursive unknown fields and duplicate singular or oneof fields;
4. decodes and deterministically re-encodes the message;
5. requires exact equality with the received bytes, rejecting non-minimal
   varints, explicit default encodings and non-canonical field order.

For publication, the Key Exchange application additionally requires the
repeated PreKeys to be in ascending canonical `key_id` order before applying
the existing `SC-D15` semantic normalization. Transport canonicality does not
silently reorder a signed mutation.

`PublishContentPreKeysRequest` adds a bounded canonical `command_id`; its
response adds `exact_replay`. Both publish and inventory requests add a
`ContentPreKeyClientProof`. The proof signs:

```text
"peers-touch:secure-content:client-command:v1\0"
|| canonical(ContentPreKeyClientSigningInput)
```

The input binds format version, capability ID, authenticated publisher
`ActorDeviceRef`, canonical Station peer ID, authenticated JWT session ID,
current signing-key ID and profile version, command/request ID, SHA-256 of the
canonical request with the proof cleared, a 32-byte nonce and issued-at time.
Station resolves the active device signing key through Actor Identity, requires
the signed actor/device to equal both the JWT subject and `X-Device-ID`,
requires the signed Station/session to equal the local Station identity and
`Subject.SessionID`, permits at most 60 seconds of clock skew, and verifies the
signature before accessing inventory or publication state. The route rejects a
JWT without a non-empty validated session ID. JWT authenticates the actor and
session; the device-possession proof, not the caller-controlled header,
authenticates the device. Station/session binding prevents a proof captured on
one Station or login session from authorizing another.

Publication command identity is deterministic:

```text
publication_payload =
  canonical(PublishContentPreKeysRequest fields 1..5)

command_id =
  "cpk-pub-v1-" || lowercase_hex(SHA-256(publication_payload))
```

The server recomputes and requires this exact value. The request hash bound by
the possession proof and receipt is the canonical request containing fields
1..6 with `proof` cleared. Identical signed publication material therefore has
one command ID; arbitrary command IDs cannot amplify receipt state. Because a
first-time command must insert at least one new immutable key row, receipt
growth is no greater than published-key growth. A new command whose entire
batch already exists rolls back its pending receipt and returns
`REPLAY_CONFLICT`; only the original command may replay an all-existing batch.

Key Exchange persists one
`key_exchange_content_prekey_publication_receipts` row keyed by
`(publisher_ptid, publisher_device_id, command_id)`. The row binds the exact
canonical proof-free command bytes/hash, response bytes/hash and completion
time in the same transaction as pool/key mutation. The stored response always has
`exact_replay=false`; an exact retry returns a verified clone with
`exact_replay=true`. Reusing the command ID with another request hash is a
terminal conflict.

The publication transaction first inserts or locks the command-key receipt.
Concurrent requests for the same command therefore serialize before either can
inspect or mutate pool state. A `PENDING` receipt carries the immutable request
bytes/hash; the owning transaction changes it to `COMPLETED` with the response
bytes/hash only after all key and pool mutations succeed. Transaction rollback
removes the reservation and every mutation together. A waiter with the same
hash returns the completed response, while a different hash conflicts. There
is no check-then-insert window in which two callers can both own the command.

After a fresh possession proof establishes the same active endpoint, receipt
lookup precedes revalidation of the historical per-key signing-key/profile
fields. This lets the same active device resolve a response lost before a later
profile rotation without re-authorizing a new mutation. A revoked endpoint
cannot create the fresh proof accepted by Actor Identity and receives the exact
typed authorization failure. If no receipt exists, the transaction did not
commit either the receipt or any key rows; the request is evaluated as a new
mutation against current state.

Completed publication receipts are retained for the lifetime of the publisher
endpoint and are not independently garbage-collected. After acknowledged
endpoint/account destruction, Key Exchange may remove response bytes but
retains the non-secret command/request hash tombstone for as long as any
corresponding immutable key row remains; the destroyed endpoint is no longer
authorized to replay it.

The additive proto projection is:

```protobuf
message PublishContentPreKeysRequest {
  // Existing fields 1..5 remain unchanged.
  string command_id = 6;
  ContentPreKeyClientProof proof = 7;
}

message PublishContentPreKeysResponse {
  ContentPreKeyInventory inventory = 1;
  bool exact_replay = 2;
}

message GetContentPreKeyInventoryRequest {
  // Existing fields 1..2 remain unchanged.
  string request_id = 3;
  ContentPreKeyClientProof proof = 4;
}

message ContentPreKeyClientSigningInput {
  uint32 format_version = 1;
  string capability_id = 2;
  string station_peer_id = 3;
  string session_id = 4;
  peers_touch.model.actor.v1.ActorDeviceRef publisher = 5;
  string publisher_signing_key_id = 6;
  uint64 publisher_profile_version = 7;
  string request_id = 8;
  bytes request_sha256 = 9;
  bytes nonce = 10;
  google.protobuf.Timestamp issued_at = 11;
}

message ContentPreKeyClientProof {
  ContentPreKeyClientSigningInput input = 1;
  bytes signature = 2;
}
```

`command_id` and `request_id` are non-empty, trim-stable, NUL-free identifiers
of at most 128 UTF-8 bytes. Exact publication retry may carry a fresh proof
while preserving the same proof-free command bytes/hash.

Both routes require a valid Bearer JWT, `X-Device-ID` and valid device-possession
proof. Their canonical PTID and device ID form the authenticated publisher only
after all three agree. The request publisher must equal that endpoint. An
endpoint-pool target must equal the same endpoint; a recovery-pool target must
equal the same actor. Actor Identity remains the device activity,
signing-key and profile-version authority, and its existing transaction fence
remains held through publication.

Publication preserves the existing `SC-D15` contract:

- one request contains 1 through 100 keys for exactly one principal and epoch;
- endpoint epoch equals the current publisher profile version;
- recovery epoch permits only `0 -> 1`, `N -> N` or `N -> N+1`;
- exact same signed material replays successfully;
- any changed identity, epoch, key, public material or signature conflicts;
- consumed or retired public material never becomes available again.

Inventory is self-scoped. A missing pool returns not found; Native treats that
as an initial publication with expected epoch zero. Otherwise the response
returns the accepted current epoch, available count, capacity, replenishment
threshold and `needs_replenishment`. `ClaimContentPreKeys` and
`ValidateContentPreKeyClaims` remain internal capabilities used only by
domain-owned prepare/submit workflows.

Failures use the shared `peers_touch.model.error.v1.ErrorResponse` from
`model/domain/error/error.proto`. That enum adds stable Content PreKey codes for
forbidden endpoint, invalid material, pool not found, stale epoch, replay
conflict, pool depleted, payload too large, quota exceeded and dependency
unavailable. The body carries only the stable code and bounded generic message;
it contains no free-form server cause, credential, identity, key material or
stack text. Retry timing uses the HTTP `Retry-After` header, with a maximum of
300 seconds, rather than a second domain error envelope.

```protobuf
ERROR_CODE_CONTENT_PREKEY_FORBIDDEN = 30201;
ERROR_CODE_CONTENT_PREKEY_INVALID_MATERIAL = 30202;
ERROR_CODE_CONTENT_PREKEY_POOL_NOT_FOUND = 30203;
ERROR_CODE_CONTENT_PREKEY_STALE_EPOCH = 30204;
ERROR_CODE_CONTENT_PREKEY_REPLAY_CONFLICT = 30205;
ERROR_CODE_CONTENT_PREKEY_POOL_DEPLETED = 30206;
ERROR_CODE_CONTENT_PREKEY_PAYLOAD_TOO_LARGE = 30207;
ERROR_CODE_CONTENT_PREKEY_QUOTA_EXCEEDED = 30208;
ERROR_CODE_CONTENT_PREKEY_DEPENDENCY_UNAVAILABLE = 30209;
```

Success and failure responses both use `application/protobuf`, including
transport and authentication failures emitted before the application handler.
The canonical handler owns those route-matched error bodies; JWT and device
wrappers return structured errors to it instead of writing JSON directly.
Router-level unmatched-route `404` and method-level `405` responses are outside
this two-route protobuf guarantee.

The HTTP/code mapping is:

| Condition | HTTP | `ErrorResponse.code` | Native action |
|---|---:|---|---|
| missing/invalid/revoked JWT or missing device header | `401` | `ERROR_CODE_UNAUTHORIZED` | refresh or end the session; never retry anonymously |
| invalid/missing possession proof, wrong Station/session/capability/device, or inactive/revoked endpoint | `403` | `ERROR_CODE_CONTENT_PREKEY_FORBIDDEN` | terminal for the current session generation |
| unsupported content type or missing body | `415` / `400` | `ERROR_CODE_INVALID_REQUEST_BODY` | terminal; send the declared protobuf body |
| query data on either POST route | `400` | `ERROR_CODE_INVALID_QUERY_PARAMETERS` | terminal; remove the alternate input |
| body read failure or timeout before decode | `400` / `408` | `ERROR_CODE_FAILED_TO_READ_BODY` | retry the same command payload with a fresh proof only after timeout |
| malformed or non-canonical request | `400` | `ERROR_CODE_INVALID_PROTOBUF` | terminal; do not retry |
| invalid per-PreKey issuer signature or X25519 public material | `400` | `ERROR_CODE_CONTENT_PREKEY_INVALID_MATERIAL` | terminal; delete only an uncommitted pending batch |
| inventory pool not yet published | `404` | `ERROR_CODE_CONTENT_PREKEY_POOL_NOT_FOUND` | create an initial publication with expected epoch zero |
| stale epoch | `409` | `ERROR_CODE_CONTENT_PREKEY_STALE_EPOCH` | query inventory and build a newly signed command |
| reused command/key identity with different bytes | `409` | `ERROR_CODE_CONTENT_PREKEY_REPLAY_CONFLICT` | terminal; never rewrite the original command |
| depleted pool | `409` | `ERROR_CODE_CONTENT_PREKEY_POOL_DEPLETED` | surface unavailable readiness and await owner-device replenishment |
| body too large | `413` | `ERROR_CODE_CONTENT_PREKEY_PAYLOAD_TOO_LARGE` | terminal; reduce to the declared batch bound |
| pool/batch quota exceeded | `429` | `ERROR_CODE_CONTENT_PREKEY_QUOTA_EXCEEDED` | honor `Retry-After` and bounded backoff |
| Actor Identity or persistence dependency unavailable | `503` | `ERROR_CODE_CONTENT_PREKEY_DEPENDENCY_UNAVAILABLE` | retry the same command payload with a fresh proof and bounded backoff |
| unclassified internal failure | `500` | `ERROR_CODE_INTERNAL_SERVER_ERROR` | preserve unknown outcome and reconcile before retry |

Native owns one supervisor keyed by
`(station_peer_id, actor_ptid, device_id, session_generation)`, not one worker
per UI window. It queries endpoint and recovery inventory after authenticated
session bootstrap, foreground resume and a bounded periodic wakeup. Only one
maintenance operation per principal is in flight. When inventory is absent or
at/below threshold, Native replenishes toward the declared capacity with a
bounded batch and applies retry backoff; it never busy-polls.

Before any publication request, Native atomically stores the private material,
exact canonical proof-free command bytes/hash and command state in its encrypted
per-account store. Command states are `PENDING_PUBLICATION`, `IN_FLIGHT`,
`UNKNOWN_COMMIT` and `PUBLISHED`. The supervisor persists a
session-generation-fenced send lease before moving `PENDING_PUBLICATION` to
`IN_FLIGHT`. A timeout moves that command to `UNKNOWN_COMMIT`. On bootstrap,
every `IN_FLIGHT` command, and every `PENDING_PUBLICATION` command without its
matching live send lease, is conservatively reclassified as
`UNKNOWN_COMMIT`. The next matching session retries the same canonical
proof-free command bytes and command ID with a fresh possession proof before
generating replacement material. A typed stale response is a proven rejection
only after the exact receipt lookup reports no committed command.

An exact replay response is commit proof, not current inventory truth. Native
marks the command `PUBLISHED`, then immediately performs a fresh inventory
request. It never regresses local epoch, count or readiness from the historical
inventory snapshot stored in the receipt response.

Each endpoint private PreKey has a separate local state:
`PENDING_PUBLICATION`, `PUBLISHED`, or `ROOT_COMMITTED`. A batch response moves
only the matching keys to `PUBLISHED`; it never marks any key opened.
Opening one endpoint envelope atomically commits that resource's root content
key before only the matching PreKey becomes `ROOT_COMMITTED` and deletable.
Endpoint private PreKeys are never evicted by age or count while they may still
be referenced by Station. Unopened and abandoned-claim keys remain encrypted
durable state until a future accepted disposition protocol or explicit
account/device data destruction. Normal local destruction first requires
Station acknowledgement that the endpoint is revoked. No separate pool
retirement acknowledgement is required: accepted `SC-D15` already re-resolves
the publisher and fences Actor Identity before every new claim, so every
unclaimed key from that revoked endpoint is ineligible before exposure.
Previously claimed but unopened resources then use their mandatory actor
recovery envelope; explicit device destruction intentionally abandons the
endpoint envelope path.
An explicitly forced offline wipe is irreversible, must be presented as such
to the user, and makes no historical-access claim.
This content/claim-proportional local growth is an accepted negative
consequence; heuristic deletion is forbidden.

Recovery private PreKeys are derived on demand from the exact envelope epoch
and key ID and are not stored individually. Encrypted recovery masters form a
keyring keyed by `(actor_ptid, recovery_epoch)` and are retained until explicit
actor recovery reset. If the exact epoch master is absent, Native requires
re-entry of the recovery phrase or returns the existing typed
phrase-required/key-unavailable state; it never substitutes the current epoch.

On logout, account switch, vault lock, device revocation, Station switch or
process shutdown, the supervisor stops admission, cancels or bounded-drains
in-flight calls, records `UNKNOWN_COMMIT` when no response was observed,
invalidates callbacks from the prior session generation and zeroizes in-memory
private/signing/recovery material. It retains only the encrypted durable states
authorized above.

The target API-ownership projection is:

| Capability ID | Domain/truth owner | Truth stores | Allowed dependency |
|---|---|---|---|
| `key_exchange.content_prekey.publish` | `station.key_exchange` / `key_exchange.content_prekey_public_material` | `key_exchange_content_prekey_pools`, `key_exchange_content_prekeys`, `key_exchange_content_prekey_publication_receipts` | `actor.device_directory.read` |
| `key_exchange.content_prekey.inventory` | `station.key_exchange` / `key_exchange.content_prekey_public_material` | `key_exchange_content_prekey_pools`, `key_exchange_content_prekeys` | `actor.device_directory.read` |

Both entries have client exposure, no aliases and no superseded symbols. Route
registration and registry entries land atomically so the fail-closed
`station-api-ownership` Gate never observes a declared route without an owner
or an owner entry without a handler. Browser code does not call these routes
and never receives private/signing material.

The canonical protobuf handler owns encoding transport/authentication failures
for these two routes without importing the generated application model into
`frame/core/server`. The server package defines a transport-neutral route error
projector callback over HTTP status, stable error code and optional
`Retry-After`; Key Exchange supplies the projector that deterministically
encodes the shared `model.ErrorResponse`. JWT and device wrappers propagate a
structured auth failure to the route handler instead of writing their existing
JSON body directly. Other routes retain their current error representation.

### Rationale

The existing proto and application capability already express the correct
business semantics. A narrow Key Exchange-owned transport makes that capability
usable by Native without creating another authority, another wire model or a
Social proxy. Canonical raw-wire equality preserves `SC-D15` signing and replay
identity. Persist-before-publish prevents a crash from advertising public keys
whose private material was never durably stored.

Command receipts make a lost response decidable without weakening publisher
eligibility for new mutations. Retaining endpoint private keys until successful
root-key commit avoids making historical access depend on an assumed recovery
epoch or heuristic expiry.

### Alternatives Considered

- Reuse Direct/MLS prekey routes or tables: rejected because their contracts,
  quotas and lifecycle owners are distinct.
- Add `/secure-content/*` routes: rejected because Secure Content is not a
  business or persistence authority.
- Proxy publication through Social: rejected because Social does not own
  PreKey inventory or Actor Identity signing truth.
- Use JSON or the current generic strict typed handler alone: rejected because
  semantic normalization would accept multiple raw encodings for one signed
  mutation.
- Add separate endpoint and recovery route families: rejected because the
  accepted typed principal already distinguishes the pools and the duplicated
  transport would drift.
- Add one reconcile command that conditionally mutates: rejected because it
  combines a read with a signed CAS mutation and complicates timeout replay.
- Infer publication success from inventory counts: rejected because counts do
  not identify the exact committed key IDs or request.
- Evict endpoint private keys by age or pool capacity: rejected because a
  still-claimable key may protect an envelope whose recovery epoch is not
  locally available.
- Store private Content PreKeys in TypeScript or Web storage: rejected by the
  Native secret boundary.

### Consequences

The execution plan carries source-only `W7A` before W7:

| Field | Required projection |
|---|---|
| Dependencies | W3/W6 complete; `SC-D20` accepted |
| Exclusive source ownership | `model/domain/secure_content/prekey.proto`; `model/domain/error/error.proto`; generated outputs plus `apps/station/frame/touch/model/errors.go`; Mobile Rust build/proto registration; scoped generator/tests; `apps/station/frame/core/server`; `apps/station/frame/core/auth/adapter/http`; `apps/station/frame/core/plugin/native/server/wrapper`; `apps/station/app/subserver/key_exchange`; API ownership, error/proto/i18n governance docs; shared error locale catalogs and metadata; Content PreKey Development scenario/tests |
| Shared-read source | `tooling/acceptance/gates.yaml` and the existing API-ownership validator |
| Runtime claims | none |
| Focused checks | scoped proto generation with zero drift; Key Exchange/server Go race suites; Rust PreKey vectors; Desktop/Mobile generated-contract checks; `station-api-ownership`; Development runner tests |
| Functional evidence | exact-source `sc-dj-content-prekey-client-boundary` supporting service Journey through the real publish/inventory HTTP boundary |
| Evidence destination | `development/secure-content/W7A/EC5A/result.json` |

The scoped generator adds `--scope content-prekey-client`. That scope includes
only `prekey.proto`, `error.proto` and W7A's declared Go/Desktop/Mobile outputs;
apply/check fails if the tool observes or would write any other manifest
destination. Generator tests prove both the allowlist and rollback behavior.
Desktop and Mobile Rust packages compile the same proto inputs from their
build-time generation paths.

W7A adds one deterministic error/localization parity check covering
`error.proto`, Go messages, generated Desktop/Mobile enums, English/Chinese
catalog keys and a required locale metadata version increment. It also makes
PostgreSQL receipt-contention, pool/Actor lock ordering, profile-rotation and
revocation tests mandatory: EC5A fails if the PostgreSQL DSN is absent or a
required test skips. A checked test manifest names every required PostgreSQL
case. The fail-closed runner requires `MESSAGING_TEST_POSTGRES_DSN`, executes
`go test -json`, and rejects zero matches, missing names, `skip` events or
non-pass terminal events. The corpus includes
arbitrary-command rejection, all-existing first-command rollback with no
receipt, concurrent exact/conflicting replay with no dangling `PENDING`, and
`completed_receipt_count <= newly_inserted_immutable_key_count`. SQLite and Go
race execution remain supplemental.

The Secure Content Core focused-test wrapper copies the exact crate source to a
temporary directory, uses a temporary Cargo target/lock boundary, runs the
requested test filter, and removes the temporary tree. It cannot create a
crate-local lockfile or target directory in the repository.

W7 then depends on W7A and owns the Desktop Native store/worker/transport and UI
projection; runtime deployment and Journeys remain serial behind the existing
Desktop/Station leases.

W7A evidence is limited to canonical/non-canonical wire tests, authentication
and typed error mapping, transaction-held publication replay/conflict,
publication-response loss across profile rotation, epoch/revocation races and
proof that Direct/MLS state is unchanged. W7 owns encrypted
persist-before-publish crash recovery, batch/per-key state, fresh-inventory
reconciliation, supervisor teardown and retained-key safety. W7 still requires
current exact-source Desktop and Browser `FUNCTIONAL_PASS`; W7A service evidence
does not satisfy that exit. The earlier API/static evidence was later
reclassified as diagnostic-only by the accepted `SC-D22` amendment.

The Owner accepted this decision on 2026-09-15.

---

## SC-D17: Social Private Prepare And Submit Use Durable Records And Distinct Routes

**Status**: accepted
**Date**: 2026-09-14

### Context

The accepted Social transaction requires durable prepare replay, plan
consumption, slot mapping, and exact submit receipts, but the persistence
inventory names no plan, plan-slot, or command-receipt tables. The accepted
private submit request also shares the existing `POST /api/v1/social/moments`
route with `CreatePostRequest`, leaving request decoding ambiguous.

### Decision

Social adds three authority tables:

| Table | Primary/unique identity | Required bindings |
|---|---|---|
| `social_private_content_plans` | `plan_id`; unique `(author_ptid, prepare_command_id)`; unique `(content_id, generation)` | canonical prepare bytes/hash, exact Key Exchange claim-request bytes/hash and ordered targets, exact claim-response bytes/hash, resource kind, author endpoint, audience snapshot, exact signed plan bytes/hash, state, expiry, optional domain commit |
| `social_private_content_plan_slots` | `(plan_id, recipient_slot_id)`; globally unique `claim_id`; unique `(plan_id, one_time_key_id)` | key kind, recipient actor/device, principal epoch, exact claimed PreKey bytes/hash including issuer signature, principal-binding hash |
| `social_private_command_receipts` | `(author_ptid, command_id)` | canonical submit hash, resource kind/content/generation, domain commit ID, exact response bytes/hash, completion time |

Prepare first inserts or locks the plan identity in `PREPARING`, calls Key
Exchange with the exact claim request already persisted on that row, and then
atomically stores the exact claim response, all slot mappings, and the
Station-signed plan as `PREPARED`. A crash after irreversible PreKey claim is
recovered by replaying the persisted claim bytes with the same `plan_id`; another
prepare hash for the same author/command is a terminal conflict.

Submit locks the plan and command-receipt identities, revalidates current
audience policy and exact plan/payload/envelope/object commitments, then commits
the Post or Comment fact, audience snapshot, recipient grants, envelopes,
delivery intents, object attachments/grants, Station-signed commit proof, plan
consumption, and exact response receipt in one Social transaction. The receipt
stores canonical business-result bytes with `exact_replay=false`; an exact retry
validates those bytes and returns a clone with `exact_replay=true`. The same
author/command/hash therefore returns the same business result while replay
metadata remains truthful; another hash conflicts.

Before submit, Social revalidates every endpoint slot against current Actor
Identity activity/profile and every recovery slot against the current Key
Exchange recovery-pool epoch. Any revoked endpoint, advanced recovery epoch, or
changed FRIENDS snapshot moves the plan to `REJECTED_STALE` and commits no
resource rows. Key Exchange exposes this as an internal, read-only
claim-validation capability; it does not create a public route or transfer
Social policy ownership.

The plan lifecycle is:

```text
PREPARING -> PREKEYS_CLAIMED -> PREPARED -> CONSUMED(domain_commit_id)
PREPARING -> RETRY_WAIT | CANCELLED | EXPIRED
PREKEYS_CLAIMED -> PREPARED | RETRY_WAIT | CANCELLED | EXPIRED
RETRY_WAIT -> PREPARING | CANCELLED | EXPIRED
PREPARED -> CONSUMED | REJECTED_STALE | CANCELLED | EXPIRED
```

Retry uses the same author, prepare command, canonical prepare hash, `plan_id`,
claim-request bytes, and target order. Cancellation or expiry never releases or
reuses an already claimed PreKey. Terminal states do not transition back to
`PREPARING`.

The private wire uses explicit routes:

```text
POST /api/v1/social/moments/prepare-private
POST /api/v1/social/moments/submit-private
POST /api/v1/social/moments/{post_id}/comments/prepare-private
POST /api/v1/social/moments/{post_id}/comments/submit-private
```

Existing `POST /api/v1/social/moments` and
`POST /api/v1/social/moments/{post_id}/comments` retain their existing public
request types and reject non-PUBLIC writes once W6 lands. Content negotiation
does not select business semantics, and no handler attempts to decode one body
as two unrelated protobuf request messages.

The W6 persistence substrate lands before W5. W5 then adds the paginated
recovery query over committed private resources, current grants, and actor
recovery envelopes; it does not create a synthetic recovery-only table.

### Rationale

Explicit durable identities make crash recovery and exact replay enforceable.
Separate routes preserve typed decoding and keep the existing public API stable.
Putting the shared Social persistence substrate in W6 preserves one domain
authority and removes the W5/W6 dependency inversion.

### Alternatives Considered

- Infer private submit from `Content-Type`: rejected because existing public
  requests already support JSON and protobuf, so media type is not a business
  discriminator.
- Trial-decode both request messages on one route: rejected because protobuf
  field overlap can produce ambiguous or silently defaulted interpretations.
- Store prepare state only in Key Exchange: rejected because Social owns
  resource, audience, slot, expiry, and command semantics.
- Add W5-only recovery tables: rejected because that would create a second
  Social private-content authority.

### Consequences

W6 owns the three additional tables and the explicit private routes before W5.
W5 depends on W6 and reads only committed resource/grant/envelope rows. W11
removes the legacy private write/read path after all callers migrate; W12 alone
owns physical deletion/reset. The new tables carry only ciphertext,
commitments, identifiers, grants, and signed evidence, never private plaintext
or key material.
The Owner accepted this decision on 2026-09-14.

---

## SC-D18: Social Encrypted Objects Use Typed Control Messages And Bounded Raw-Byte Routes

**Status**: accepted
**Date**: 2026-09-14

### Context

The accepted architecture assigns a Social-owned object plane, lists six
Social object routes and defines the object state machine and persistence
tables. `model/domain/secure_content/object.proto` currently contains only
`EncryptedObjectUploadSpec` and `EncryptedObjectDescriptor`; it has no
begin/status/chunk/complete/cancel/get operation contract. W6 therefore cannot
implement IMAGE publish or authenticated object read without inventing
unversioned handler-local wire shapes.

### Decision

`model/domain/secure_content/object.proto` adds domain-neutral, versioned
control messages:

```text
BeginEncryptedObjectUploadRequest/Response
GetEncryptedObjectUploadRequest/Response
PutEncryptedObjectChunkResponse
CompleteEncryptedObjectUploadRequest/Response
CancelEncryptedObjectUploadRequest/Response
EncryptedObjectTransferState
```

Begin binds the prepared Social resource, deterministic object ID,
authenticated uploader endpoint, complete upload spec, descriptor-commitment
hash and command ID. First admission requires the object ID to appear in the
caller's current, unexpired durable `PREPARED` plan. The handler first looks up
an existing upload by `(uploader actor, command_id)` and returns an exact
same-hash replay before applying the current-plan check, so a committed begin
remains replayable after plan consumption or expiry. A changed canonical
request conflicts.

Chunk upload remains a bounded raw-byte data plane:

```text
PUT /api/v1/social/moments/objects/uploads/{upload_id}/chunks/{chunk_index}
Content-Type: application/octet-stream
X-Upload-Generation: <u64>
X-Chunk-Offset: <u64>
X-Ciphertext-Size: <u64>
X-Ciphertext-SHA256: <lowercase hex SHA-256>
Idempotency-Key: <canonical identifier>
```

Unsigned decimal headers use no sign and no leading zero except the value zero.
`Content-Length` is mandatory and must equal `X-Ciphertext-Size`, which in turn
must equal the expected size for that chunk. The request body stays within the
shared Secure Content policy. `(upload_id, generation, chunk_index)` is
exact-once: identical offset/size/hash/body replay returns duplicate success;
the part row persists the canonical idempotency key, and reusing that key for
another index or hash is terminal conflict. Bytes are written only through the
generic `storage.Backend` under a Social-owned opaque key. They never enter a
public OSS row or a protobuf/JSON control message.

`descriptor_commitment_sha256` is SHA-256 over the canonical
`EncryptedObjectDescriptorCommitmentInput`, which contains format version,
resource, object ID and complete `EncryptedObjectUploadSpec`, and deliberately
excludes the Station-owned `storage_ref`.

The bitmap has exactly `ceil(chunk_count / 8)` bytes. Bit `i` is chunk `i`,
least-significant bit first within byte `i / 8`; unused high bits in the final
byte are zero. Status requires an empty body and exactly one
`?generation=<canonical-u64>` query value. Chunk PUT forbids query data; neither
route normalizes alternate wire shapes into the same command.

Complete verifies the full bitmap, every chunk hash, total ciphertext size and
whole-object SHA-256, then atomically moves
`VERIFYING -> COMPLETE_UNATTACHED` and returns one canonical
`EncryptedObjectDescriptor`. Exact complete replay returns that descriptor.
Mismatch atomically stores and returns a deterministic `TERMINAL_CORRUPT`
complete response; the same command replays that terminal response before and
after GC. Cancellation and expiry never make object bytes attachable.

Private submit may only attach a `COMPLETE_UNATTACHED` object whose canonical
descriptor equals the submitted descriptor. The existing Social outer UOW
atomically commits `ATTACHED(domain_commit_id)` and endpoint/recovery object
grants with the Post or Comment and command receipt.

Object download uses:

```text
GET /api/v1/social/moments/objects/{object_id}
```

`GET /api/v1/social/moments/{post_id}` returns
`GetMomentResourceResponse` with fields 1 and 2 wire-compatible with the
existing `GetPostResponse` public projection. Field 3 carries the typed
`PostResource`; private reads leave the legacy public fields empty rather than
reinterpreting field 1 as another message type. The point read accepts its
identifier from the path only and rejects body or query alternatives.

It returns raw `application/octet-stream` bytes and descriptor/ETag/range
metadata through the following exact HTTP contract:

```text
request query:
  expected_descriptor_sha256=<lowercase hex SHA-256>

request header:
  Range: bytes=<start>-<end> | bytes=<start>-

response:
  200 for a full body; 206 for one satisfiable range; 416 otherwise
  Accept-Ranges: bytes
  Content-Length: <returned bytes>
  Content-Range: bytes <start>-<end>/<total>   # 206 only
  ETag: "sha256:<lowercase hex descriptor SHA-256>"
  X-Descriptor-SHA256: <lowercase hex descriptor SHA-256>
  X-Total-Ciphertext-Size: <canonical u64>
```

Multiple or suffix ranges are rejected with `416`. Social resolves the
authenticated actor and `X-Device-ID`, requires that endpoint to remain active,
and accepts either its exact unrevoked endpoint grant or the same actor's
unrevoked recovery grant, plus current Post/Comment authorization. This permits
a newly recovered active endpoint to fetch ciphertext without inventing a
server-side root-key transfer. Missing and unauthorized objects use the same
not-found shape. `storage_ref` is never accepted from the caller and is never an
authorization token.

The complete descriptor is already carried by the authorized Post/Comment
resource projection; raw object GET does not repeat it in an unbounded header.
The total response-header budget is 8 KiB and all object metadata headers are
fixed-size or bounded identifiers.

Begin, complete and cancel store their canonical command bytes/hashes on the
upload row. Status reads are uploader-endpoint scoped. All control messages
reject unknown fields, duplicate protobuf singular/oneof fields and
non-canonical identities; POST controls require their typed body and reject
query data rather than silently treating it as a body alternative. Every
server transport applies a bounded full-request read timeout, and every route
enforces size/chunk-count limits and zero partial authority writes.

Every non-transactional storage action is fenced by durable SQL state:

- before writing a chunk, Social inserts or locks its part row in `WRITING`
  with expected metadata, immutable storage key, lease owner/generation/expiry,
  attempts and next-attempt time;
- a same-hash retry of an expired `WRITING` lease may verify or rewrite only the
  same immutable key, then CAS the same lease generation to `STORED`;
- complete CAS-leases the upload row in `VERIFYING`; a transient backend
  interruption records retry/backoff from the failure time and returns to
  `RECEIVING_PARTS`, while a decided integrity mismatch stores an immutable
  `TERMINAL_CORRUPT` response and result hash;
- submit attach and GC both lock the same object row. Attach CASes only
  `COMPLETE_UNATTACHED -> ATTACHED`; GC CASes only an eligible non-attached
  state to `GC_CLAIMED`, so neither can pass the other;
- deletion completion retains upload/object tombstones, canonical command
  hashes, terminal result hashes, generations and storage identities in
  `GARBAGE_COLLECTED`. Exact replay returns the terminal outcome and no command
  may recreate the same upload, object or storage key.
- active-upload admission counts only `CREATED`, `RECEIVING_PARTS` and
  `VERIFYING`; `COMPLETE_UNATTACHED` is no longer transferring and therefore
  does not prevent the remaining objects in one valid ten-object plan from
  uploading;
- background expiry commits `CREATED/RECEIVING_PARTS -> EXPIRED` before a later
  cleanup lease may claim the row for GC. Verification retries honor their
  persisted next-attempt time and the shared bounded attempt limit.

Persisting `WRITING` before `storage.Backend.Save` makes every crash-visible
byte write discoverable from its deterministic row; cleanup never depends on a
backend list API.

The object cleanup transitions are:

```text
CREATED -> RECEIVING_PARTS -> VERIFYING -> COMPLETE_UNATTACHED
VERIFYING -> RECEIVING_PARTS        # retriable storage interruption only
VERIFYING -> TERMINAL_CORRUPT       # any decided integrity mismatch
CREATED/RECEIVING_PARTS -> CANCELLED | EXPIRED
CREATED/RECEIVING_PARTS/VERIFYING/COMPLETE_UNATTACHED/
  CANCELLED/EXPIRED/TERMINAL_CORRUPT
  -> GC_CLAIMED -> GARBAGE_COLLECTED
```

A failed blob write may leave only unreferenced Social-owned bytes eligible for
bounded cleanup; it cannot create an attachment or grant. `ATTACHED` is outside
this pre-attachment GC path and may enter later domain deletion cleanup only
after all grants are revoked.

### Rationale

Typed control messages preserve proto-first client parity, while raw chunk and
object bodies keep large ciphertext out of JSON/protobuf buffering. Social
retains authorization and lifecycle ownership, the shared kernel retains pure
validation/FSM ownership, and `storage.Backend` remains an opaque byte store.

### Alternatives Considered

- Handler-local JSON structs: rejected because Desktop and Mobile would have
  no generated canonical contract.
- Put ciphertext bytes inside protobuf: rejected because it collapses the
  control and large-payload data planes.
- Reuse `/conversation/attachments/*`: rejected because Conversation does not
  own Social resources or grants.
- Reuse public OSS rows or presigned public URLs: rejected because possession
  of a key or URL would bypass Social authorization.
- Attach an object during complete: rejected because only the Social
  Post/Comment outer UOW may commit object authority.

### Consequences

W6 must extend the scoped generator inputs/outputs, persist upload/part command
hashes and exact completion state, add a Social `storage.Backend` adapter, and
implement all six routes for the minimal IMAGE path. Its Gate covers begin,
chunk, complete, attach, authorized read, exact replay, failpoint rollback and
unattached cleanup. W8 retains VIDEO variants plus exhaustive cancellation,
expiry, corrupt-upload, range, abuse, storage-full and GC lifecycle matrices.
The decision does not change Conversation routes, tables, attachment behavior
or the shared stateless kernel.
The Owner accepted this decision on 2026-09-14.

---

## SC-D19: Durable Content Proofs Use Current-Key Attestations For Retained Station Public Keys

**Status**: accepted
**Date**: 2026-09-14

### Context

`ContentEncryptionPlan` expires after minutes, but
`ViewerContentCommitProof` must remain verifiable for never-opened recovery.
The Federation key store retains the previous private key only for its bounded
token grace window. Keeping only `station_signing_key_id` on a content proof
does not let a newly recovered device verify an older proof after later Station
key rotations. Social cannot solve this by storing its own trusted public-key
copy: a compromised content database could substitute the proof, key and
signature together.

### Decision

The Federation authentication owner adds an append-only public verification-key
history keyed by `(station_peer_id, signing_key_id)`. Rotation atomically
archives the outgoing public key before its private key may leave the existing
`prev` grace slot. Public history remains while any durable content proof may
reference the key; old private keys retain their existing short grace and are
not archived.

The current Station signing key issues a bounded, short-lived
`StationContentSigningKeyAttestation`:

```protobuf
message StationContentSigningKeyAttestation {
  uint32 format_version = 1;
  string station_peer_id = 2;
  string proof_signing_key_id = 3;
  bytes proof_ed25519_public_key = 4;
  string attesting_signing_key_id = 5;
  google.protobuf.Timestamp issued_at = 6;
  google.protobuf.Timestamp expires_at = 7;
  bytes station_signature = 8;
}
```

The current key signs the domain-separated canonical fields `1..7`. A client
trusts the current Station key through the existing Federation profile/pin,
verifies the attestation, then verifies the historical content proof with
`proof_ed25519_public_key`. A current proof key is self-attested through the
same message. Attestations expire after five minutes and are regenerated on
read; their expiry does not expire the content proof or the retained public key.

Federation exposes a read-only internal capability:

```go
ResolveContentProofVerificationKey(
    ctx context.Context,
    stationPeerID string,
    signingKeyID string,
) (ed25519.PublicKey, error)

AttestContentProofVerificationKey(
    ctx context.Context,
    signingKeyID string,
    now time.Time,
) (*StationContentSigningKeyAttestation, error)
```

Social uses the resolver to verify every signed plan before submit and every
commit proof before projection. Point reads add a freshly generated
attestation to `PrivateContentVerification`; it is transport verification
metadata, not part of the immutable command receipt or commit-proof signature.
Exact submit replay therefore retains the original business/proof bytes while
point reads may carry a newer valid attestation after rotation.

The history record and attestation contain only public keys. Mutation remains
Federation-owned; Social and Secure Content cannot insert, rotate, delete or
trust keys independently. A missing history key fails closed with typed
`STATION_PROOF_KEY_UNAVAILABLE` and returns no private payload or envelope.

### Rationale

Re-attesting one retained public key with the currently trusted Station key
gives new devices a fixed-size verification path without retaining old private
keys, embedding an unbounded rotation chain in every response, or trusting the
content database as key authority.

### Alternatives Considered

- Current/previous key lookup only: rejected because recovery may occur after
  the previous-key grace window.
- Store the old public key beside each Social proof: rejected because the same
  compromised database could substitute both.
- Retain every old private key: rejected because it expands signing compromise.
- Embed the complete rotation chain in each Post: rejected as unbounded
  response metadata.
- Use Actor device keys for Station commit proofs: rejected because a device
  does not own Station commit truth.

### Consequences

W6 must add the Federation-owned public-key history and internal resolver,
verify plans before submit, verify proofs before point-read projection, and add
the attestation to the generated private verification response. Federation key
rotation tests must prove atomic archive-before-retire and re-attestation after
rotation. W5 must prove that a newly recovered device can validate a proof
signed before rotation. Existing JWT/Federation token grace behavior and
Conversation wire remain unchanged.
The Owner accepted this decision on 2026-09-14.

# Secure Content - Architecture Decisions

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-13 | **Updated**: 2026-09-14
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
and a fixed 32-byte content key. W5 records the resulting encapsulated key and
ciphertext beside the derivation vector before implementation can complete.

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
POST /api/v1/social/moments:prepare-private
POST /api/v1/social/moments:submit-private
POST /api/v1/social/moments/{post_id}/comments:prepare-private
POST /api/v1/social/moments/{post_id}/comments:submit-private
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

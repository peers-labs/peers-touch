# Mobile Shell — 数据与 Proto 映射

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-29
> **Owner**: Mobile Architecture Team

---

## 1. Mapping Rule

Prototype types are presentation fixtures. Production view models are derived
from generated proto plus device-local UI state; they never become parallel
domain contracts.

Actor identity is a stricter boundary:

- `ptid: string` is the only actor identity accepted by Mobile API gateways,
  runtimes, stores, persisted caches, commands, events, and routes.
- Numeric `actor_id` and aliases such as `actor_did` are not Mobile view-model
  fields. A migration-only gateway may discard legacy fields but must not expose
  them; the target Station endpoint no longer emits them.
- Auth/session activation requires a generated `ActorRef` with non-empty
  `ptid`; display names and `acct` cannot substitute for it.

## 2. Prototype To Canonical Contract

| Prototype concept | Canonical source | Local projection only |
|---|---|---|
| `StationEntry` | verified `station_peer_id` handshake plus device-local URL registry | selected/checking/error |
| `Conversation` | `chat.Conversation`, `FriendChatSession`, `Group` | preview, badge, pin sort |
| `Message` | `FriendChatMessage`, `GroupMessage`, `CommittedConversationEvent` | selection, menu anchor, draft |
| `MessageStatus` | `FriendMessageStatus`, `MessageDeliveryState`, receipts | display label |
| `MessageReply` | `reply_to_*` plus referenced message projection | truncated preview |
| `MessageReaction` | `ReactionEvent` / `ReactCommand` | picker open state |
| pinned message | `PinEvent` / `PinMessageCommand` | active pinned panel |
| thread | `thread_root_*` and message query | open thread route |
| `Contact` | `ActorProfile`, friendship/session projection, presence | grouping/search text |
| `GroupItem` | `Group`, `GroupMember` | list preview |
| `Moment` | `social.Post`, `PostAuthor`, `ReactionSummary` | expansion state |
| `MomentComment` | `social.Comment` | reply composer state |
| profile | `ActorProfile` | current detail route |
| settings | `ActorPreferences`, notification preferences, device config | selected section/draft |

## 3. Proto Requirements

### 3.1 Reuse without schema change

- Station access and gate chain: `access_gate/access_gate.proto`, `auth/auth.proto`.
- Friend/group chat, attachments, replies, edits, recalls, settings and search:
  existing `chat/*.proto`.
- Reactions, pins, forward proposal delivery, thread list/count, and durable
  command results: `chat/conversation.proto` and `chat/conversation_api.proto`.
- Moments feed, audience, media and reactions: `social/post.proto`.
- Comments and replies: `social/comment.proto`.
- Profile and relationship: `actor/actor.proto`, `social/relationship.proto`.
- Presence, notifications, runtime events: `presence/`, `notification/`,
  `realtime/event.proto`.

Reuse is permitted only after endpoint, generated-binding, identity, idempotency,
and readback semantics are verified. The existence of a message in Proto does
not prove that Station and Mobile currently expose the full product operation.

### 3.2 Contract Status

| ID | Required semantic | Owner | Status | Current evidence / remaining target |
|---|---|---|---|---|
| MS-P01 | PTID-only login/OAuth session identity | Model + Station auth | implemented | Mobile-facing auth/OAuth contracts use `ActorRef`; legacy numeric OAuth bridge fields are reserved and Mobile fails closed without PTID |
| MS-P02 | OAuth provider attempt | Model + Station OAuth | implemented | `mobile_oauth.proto` and Station/Mobile Rust bind provider, Station, access attempt/gate, redirect, PKCE, nonce, attempt secret, device and generation |
| MS-P03 | OAuth callback completion/status | Model + Station OAuth | implemented; physical proof pending | Station performs one-time callback claim, candidate/finalizer/status/cancel/ack; W2-E2 still requires the proposed physical proof contracts |
| MS-P04 | Mutation outcome lookup | Owning Model/Station domain | gap | Query by stable command ID or authoritative entity/event readback is still required for every offline-retriable mutation |
| MS-P05 | Complete account preferences | Model + Station actor/preferences | gap | Generated account preference read/write contract remains required for accepted cross-device fields |
| MS-P06 | Durable Mobile command envelope | Model + Mobile reliability | gap | Typed command kind and `oneof` payload, Station/PTID scope, ordering, state and typed error remain required |
| MS-P07 | Station identity/capability handshake | Model + Station core | implemented | Libp2p-host-key-signed statement and Mobile Rust verification bind peer ID, origin, capabilities, challenge and expiry |
| MS-P08 | Device-local draft envelope | Model + Mobile storage | gap | Typed Station/PTID-scoped Chat/Moments draft persistence remains required |

These statuses describe the current architecture contract and implementation
surface; they do not authorize a protocol version bump. Any future message,
field-number, compatibility, or version change requires its own reviewed Model
change.

W2-E2 runtime-only Fixture, Station proof, provider/browser lease and physical
build attestation schemas are proposed in
[`native-oauth-proof/data-model.md`](./native-oauth-proof/data-model.md). They
are Acceptance artifacts, not additions to the Mobile OAuth product Proto.

### 3.2.1 MS-P02/MS-P03 Security Amendment

> **Status**: accepted on 2026-08-28; field numbers remain an
> implementation-plan concern.

MS-P02 start additionally binds:

- `action_type = AUTH_OAUTH`, selected from the current credential gate's
  advertised alternatives;
- `device_id`;
- `lifecycle_generation`;
- `attempt_secret_hash`, derived from random Mobile Rust material;
- `credential_delivery_public_key`, an ephemeral X25519 public key whose private
  key never leaves secure storage.

MS-P03 complete/status/cancel/acknowledge requests present the device-held
attempt secret. Station compares its hash in constant time and also requires the
exact Station, device, lifecycle generation, Access Attempt, OAuth Attempt, and
gate binding.

`AccessGate` exposes typed alternative actions. The `auth.login` gate is the
single credential stage and advertises email/password plus available
`auth.oauth` provider actions. One successful action satisfies the stage and
the remaining alternatives become skipped; OAuth is never appended as a second
mandatory login gate.

Successful finalization returns an encrypted session credential envelope to
Mobile Rust:

```text
OAuthCredentialEnvelope {
  candidate_id
  session_id
  actor_ref
  station_peer_id
  device_id
  lifecycle_generation
  server_ephemeral_public_key
  nonce
  ciphertext
  expires_at
}
```

The plaintext contains the Station access/refresh credentials and their expiry.
The envelope uses X25519 + HKDF-SHA256 + AES-256-GCM, with the binding fields as
authenticated associated data. Station persists one envelope per candidate and
returns the identical bytes after an uncertain response; it never creates a new
session during status polling.

After Mobile Rust decrypts and durably stores the credential, it sends an
acknowledgement authenticated by the attempt secret. Station then marks delivery
complete and removes the recoverable envelope. Later status calls return only
the terminal state and public session projection.

Session persistence adds a unique `oauth_candidate_id` and stores
`station_peer_id`, `access_attempt_id`, final gate-decision revision,
`device_id`, and `lifecycle_generation`. The authorization finalizer creates
the session row, candidate terminal state, attempt terminal state, and encrypted
delivery envelope in one transaction.

OAuth attempt state:

```text
idle -> starting -> awaiting-provider -> callback-received -> exchanging
     -> session-candidate-issued -> access-gate-chain
     -> finalizing -> credential-delivery -> active-session
        (only after final access grant and native secure-store acknowledgement)

starting|awaiting-provider|callback-received|exchanging
  -> cancelled|expired|failed
```

Terminal and race rules:

- callback claim is one conditional update from `awaiting-provider`;
- authorization-code consumption is one conditional update before exchange;
- one Access Attempt may have only one live OAuth attempt per device/generation;
- finalization and cancellation lock rows in the same order;
- an exact duplicate callback during uncertain completion resumes the same
  claimed attempt; a different callback after claim or any post-terminal
  resubmission is replay and fails closed;
- stale generation, Station replacement, device mismatch, provider mismatch,
  redirect mismatch, state mismatch, nonce mismatch, PKCE mismatch, and expiry
  fail closed;
- crash after finalization but before client acknowledgement resumes the same
  encrypted envelope;
- cancellation after finalization revokes the candidate-created session before
  reporting completion.

Station owns attempt identity, provider/Station/redirect binding, PKCE challenge,
nonce hash, opaque state, access attempt/gate binding, expiry, and atomic
one-time consumption. Mobile secure storage owns the PKCE verifier, nonce, and
attempt secret, credential-delivery private key, and any attempt-scoped session
candidate. The candidate cannot authorize business calls. The Web UI sees only
projected state.

`station_peer_id` from the verified handshake is the canonical Station scope for
OAuth, sessions, caches, and command records. URL is a mutable connection hint.
A saved URL returning another peer ID is a terminal identity mismatch and
requires explicit Station replacement; it cannot inherit the old scope.
The explicit first-add action pins the peer ID after challenge-signature
verification; subsequent URL edits or redirects cannot silently replace it.

### 3.3 MS-P07 Signed Station Identity Contract

The request carries exactly one cryptographically random 32-byte challenge.
The response contains:

- deterministic protobuf bytes for `StationIdentityStatement`, containing the
  exact challenge, `station_peer_id`, canonical origin, sorted capability IDs,
  issue time, and expiry time;
- the marshalled libp2p Ed25519 host public key;
- the libp2p host-key signature.

The signature input is:

```text
"peers-touch/station-identity/v1\0"
  || deterministic_protobuf(StationIdentityStatement)
```

`StationIdentityStatement` contains no map fields. Capabilities are sorted by
UTF-8 byte order before signing. The client must:

1. reject a challenge whose length is not 32 bytes;
2. verify the returned challenge byte-for-byte;
3. unmarshal the Ed25519 public key and derive the libp2p PeerID from it;
4. require the derived PeerID to equal `station_peer_id`;
5. verify the signature over the domain-separated deterministic bytes;
6. require `issued_at <= now + 30s`, `expires_at >= now - 30s`, and a signed
   lifetime no longer than 60 seconds;
7. require every requested capability to appear in the signed capability set;
8. reject any HTTP redirect rather than carrying trust across origins.

Unknown capabilities are retained but ignored. The required set uses stable
capability IDs and subset matching; list order has no semantic meaning.
`canonical_origin` contains normalized scheme, host, and effective port only,
with no path, query, fragment, or credential.

The current Station host key is Ed25519. Host-key rotation changes the derived
PeerID and therefore requires explicit Station replacement. No continuity
alias, URL-based migration, or silent state transfer is permitted.

### 3.4 Contract wiring before schema extension

- Forwarding should be modeled as a new send command referencing source content
  only if current command APIs cannot express the accepted audit semantics.
- Thread list/count should use `thread_root_message_id` queries before adding a
  separate thread entity.
- Moments reactions/comments must use existing `social/post.proto` and
  `social/comment.proto` unless endpoint verification proves a semantic gap.

### 3.5 Explicit non-gaps

| Concept | Owner | Contract disposition |
|---|---|---|
| Station registry | Mobile device | Remains local unless product scope later requires cross-device sync |
| User message flag | Mobile device | Remains local under MS-C14 |
| Chat Docs tab | deferred product domain | No schema under current scope |
| Device preferences | Mobile device | No shared Proto; use a typed Tauri contract only when crossing Web/Rust |
| Navigation and overlay state | Mobile navigation | Never enters business Proto |

## 4. Durable Command Projection

The local command ledger is a device-owned reliability projection, not shared
business truth:

```text
MobileDurableCommand {
  schema_revision
  command_id
  station_peer_id
  actor_ptid
  origin_generation // diagnostics only
  ordering_key
  command_kind
  oneof typed_payload
  created_at
  attempt_count
  state
  last_error_code
}
```

Command state:

```text
queued -> submitting -> committed
                  \-> failed-retryable
                  \-> failed-terminal
                  \-> unknown-outcome -> reconciling
                                           |-> committed
                                           |-> retry-authorized
                                           \-> unresolved
```

The envelope is a generated Proto contract, not `string type + opaque bytes`.
Station commit/result remains authoritative. `origin_generation` rejects stale
callbacks in the originating process but does not gate restart recovery. After
restart, exact Station/PTID scope is verified and the record is rebound to the
new in-memory generation.

The single persistent owner is a transactional encrypted store in
`mobile-rust`; mobile-web accesses it only through typed Tauri commands. The
platform secure-storage key protects the store. Tokens, provider secrets, PKCE
material, nonce, and media bytes are forbidden; media commands persist only
encrypted blob references.

`CommandAdmissionPolicy` is normative:

- at most 512 unresolved records and 16 MiB per Station/PTID partition;
- at most 256 KiB serialized payload per record;
- one inflight command per `ordering_key`, with four keys active concurrently;
- round-robin scheduling across keys prevents one conversation/domain from
  starving others;
- `unknown-outcome` blocks its ordering key until readback resolves it;
- capacity exhaustion returns typed `COMMAND_LEDGER_FULL`; no unresolved record
  is dropped, overwritten, or silently evicted;
- state transitions and attempt counters commit atomically with crash recovery;
- unsupported schema revision fails closed and requires an explicit migration,
  never best-effort decoding.

## 5. Device-Local Draft Projection

Chat and Moments drafts are local product state, not Station truth. Their
generated envelope is keyed by `station_peer_id + actor_ptid + surface_kind +
target_id` and stores text, encrypted attachment references, audience, and
`updated_at`.

The single persistent owner is an encrypted `mobile-rust` draft store.
mobile-web owns editing state and writes through typed Tauri commands. A draft
is deleted only after authoritative commit, explicit discard, or confirmed
scope removal. It is never replayed as a command and never exposed under another
Station/PTID scope.

## 6. JSON To Generated-Proto Cutover

Target boundary:

```text
Page -> view projection -> runtime -> generated Proto gateway -> Station
```

Temporary JSON decoding is allowed only inside a domain API gateway and must
immediately normalize into generated-contract semantics. A JSON DTO cannot be
imported by pages, stores, runtime public APIs, storage, or native plugins.

A domain deletes its old JSON/manual path only when all of the following hold:

1. Station endpoint and event parity are verified for reads, writes, typed
   errors, pagination, identity, and idempotency.
2. Mobile gateway tests prove Proto encode/decode and legacy-ingress parity.
3. Runtime/store consumers use one canonical projection.
4. Native two-actor readback passes for that domain.
5. Repository scans find no imports of the retired DTO outside the quarantined
   adapter.

After those conditions pass, the compatibility adapter and duplicate manual
types are deleted in the same change. Permanent dual paths are forbidden.

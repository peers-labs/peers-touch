# Mobile Shell — 数据与 Proto 映射

> **Status**: active; owner-contract closure amendment accepted
> **Version**: v1.3
> **Created**: 2026-08-27 | **Updated**: 2026-10-07
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
| `Conversation` | `chat.Conversation` plus Device Messaging Engine projection | preview, badge, pin sort |
| `Message` | `ConversationEvent` plus Device Messaging Engine plaintext projection | selection, menu anchor, draft |
| `MessageStatus` | Conversation command/result, delivery and read receipts | display label |
| `MessageReply` | `reply_to_*` plus referenced message projection | truncated preview |
| `MessageReaction` | `ReactionEvent` / `ReactCommand` | picker open state |
| pinned message | `PinEvent` / `PinMessageCommand` | active pinned panel |
| thread | `thread_root_*` and message query | open thread route |
| `Contact` | `ActorProfile`, friendship/session projection, presence | grouping/search text |
| `GroupItem` | canonical Conversation projection and member-authority snapshot | list preview and Messaging command feedback |
| `Moment` | `social.Post`, `PostAuthor`, `ReactionSummary` | expansion state |
| `MomentComment` | `social.Comment` | reply composer state |
| profile | `ActorProfile` | current detail route |
| settings | `ActorProfile`, Notification preferences, Social blocked users, device config | selected owner/section/draft |

## 3. Proto Requirements

### 3.1 Reuse without schema change

- Station access and gate chain: `access_gate/access_gate.proto`, `auth/auth.proto`.
- Conversation, attachments, replies, edits, retracts, reactions, pins,
  thread list/count, member authority, and durable command results:
  `chat/command.proto`, `chat/conversation.proto`,
  `chat/conversation_api.proto`, and `chat/event.proto`.
- Retired Friend/Group-specific Chat contracts are deleted; Mobile consumes
  only the canonical Conversation command, event, projection, and receipt
  families.
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
| MS-P03 | OAuth callback completion/status | Model + Station OAuth | implemented; simulator proof pending | Station performs one-time callback claim, candidate/finalizer/status/cancel/ack; required proof uses deterministic simulator cells under MS-D26 |
| MS-P04 | Mutation outcome lookup | Owning Model/Station domain | Friend Request and Social relationship lookup implemented; other domains remain gaps | Generated authenticated lookups return exact command ID/hash and `not_found`, `accepted_pending`, `terminal_result`, or `unresolved`; every additional offline-retriable mutation still requires an equivalent owner contract |
| MS-P05 | Owner-specific settings CAS | Model + Actor Profile + Notification | accepted target; implementation pending | Profile needs dedicated editable-state revision; Notification needs aggregate revision and atomic batch; Desktop and Mobile must hard-cut together |
| MS-P06 | Durable Mobile command envelope | Model + Mobile reliability | source complete; simulator proof pending | Generated v2 contract contains Friend Request and Social relationship commands; Rust enforces exact Station/PTID scope, ordering, state, key hierarchy, migration, one-ID resolvers, and projection checkpoint semantics |
| MS-P07 | Station identity/capability handshake | Model + Station core | implemented | Libp2p-host-key-signed statement and Mobile Rust verification bind peer ID, origin, capabilities, challenge and expiry |
| MS-P08 | Device-local draft envelope | Model + Mobile storage | source complete; simulator proof pending | Generated v2 Chat/Moment envelopes use exact Station/PTID scope, wrapped scope keys, lifecycle write fencing, and explicit retain/discard recovery |
| MS-P09 | Generic Access Gate action submission | Access Gate Model + Station | accepted target; implementation pending | Descriptor schema exists; submission needs action/schema binding, stable identity, typed built-ins, generic scalar values, result state, and finalizer isolation |
| MS-P10 | Conversation member authority | Conversation | implemented | AO-D10 generated member-update/owner-transfer commands are consumed only through Device Messaging Engine; Mobile projects pending/uncertain/failed state until authoritative member/owner readback converges |
| MS-P11 | Directional block/list/status | Social | source implemented; runtime proof pending | Generated public mutations, cursor-bounded list, privacy-safe relationship projection, result lookup, ordered event, Federation propagation, and Mobile durable-command cutover are implemented |
| MS-P12 | Forward/actor-hide/moderation | Conversation + Device Messaging Engine | accepted target; implementation pending | Retract exists; user forward, actor-scoped hide, and moderation tombstone contracts are absent |
| MS-P13 | Moments visibility outcome and native media staging | Social + Secure Content + Mobile Rust | source implemented; simulator proof pending | Generated feed/detail outcomes and Rust picker staging, encryption, upload, promotion, and cleanup are implemented; required multi-actor proof uses simulators and physical picker behavior is optional diagnostics |
| MS-P14 | Settings ownership | Actor Profile + Notification + Social + Mobile device | accepted; source cutover pending | No additional account-preference owner exists in this release; selected-owner save and Profile/Notification CAS remain |
| MS-P15 | Native authenticated transport and delivery lifecycle | Mobile Rust + Notification + native plugins | source implemented; simulator proof pending | Rust-owned authenticated transport, PTID/device-bound push registration, encrypted credential persistence, generation/sequence-fenced receipt/tap, one native scheduler identity per environment, exactly-once completion, and native-to-Rust media staging are implemented; required platform proof uses simulators and provider/device behavior is optional diagnostics |

These statuses describe the current architecture contract and implementation
surface; they do not authorize a protocol version bump. Any future message,
field-number, compatibility, or version change requires its own reviewed Model
change.

W2-E2 runtime-only Fixture, Station proof, provider/browser lease and physical
build attestation schemas remain available for optional diagnostics in
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
MobileDurableCommandEnvelopeV2 {
  schema_revision
  command_id
  station_peer_id
  actor_ptid
  origin_generation // diagnostics only
  ordering_key
  payload_sha256
  created_at
  attempt_count
  state
  typed_last_error
  oneof payload {
    FriendRequestCommand friend_request
    SocialRelationshipCommand social_relationship
  }
}
```

> **MS-D15 status**: accepted by the Owner on 2026-09-11 and source-complete.
> The exact membership and behavior below remain implementation authority. The
> Friend Request result-lookup prerequisite and Mobile cutover are complete;
> required simulator proof remains `UNPROVEN`. Physical native proof is
> optional diagnostics under MS-D26.

The envelope is a generated Proto contract, not `string type + opaque bytes`.
The oneof discriminator is the command kind; there is no parallel category or
string command-type registry. v2 contains generated `FriendRequestCommand` and
`SocialRelationshipCommand` variants. Station exposes typed command-ID result
lookups, and Mobile persists and dispatches the same signed bytes, command ID,
and hash through the matching exhaustive resolver before applying the
projection checkpoint.

The following current writes are not v2 members:

- all Chat and Group writes, which remain Device Messaging Engine commands;
- Moment publish, reaction/unreaction, comment, reply, and deletion, whose
  current requests lack stable command IDs and authoritative result lookup;
- notification and settings writes without an accepted domain resolver.

An excluded write is online-only or draft-only and must expose that state. It
cannot call the ledger as best-effort bookkeeping or continue after admission
failure.

The single persistent owner is a transactional encrypted store in
`mobile-rust`; mobile-web accesses it only through typed Tauri commands. Tokens,
provider secrets, PKCE material, nonce, media bytes, and human-readable errors
are forbidden. Media-capable commands persist only encrypted blob references.

### 4.1 Command Identity And Preparation

The domain command ID is the ledger primary identity. `InteractionAdmission`
owns admission and persistence only. For Friend Request, it calls a typed Rust
port on the Device Messaging Engine, which remains the sole owner of
actor-device enrollment and signing keys and returns immutable signed command
bytes, command ID, and hash. W4 must not load, copy, or manage those keys.

The outer `command_id` must equal the ID inside the payload. Dispatch and every
retry use the persisted deterministic bytes; no layer may rebuild, re-sign, or
allocate another ID.

The current `command_type + payload_json` Tauri shape, caller-supplied
idempotency key, and Rust-generated second ledger ID are invalid v2 inputs.

### 4.2 Resolver Contract

Every generated payload variant has one exhaustive Rust resolver:

```text
prepare_typed_payload
  -> admit_exact_bytes
  -> dispatch_exact_bytes
  -> read_authoritative_outcome(command_id, payload_sha256)
  -> apply_projection_checkpoint
  -> purge_or_project_failure
```

The resolver returns one of:

| Result | Meaning | Allowed transition |
|---|---|---|
| `not_found` | Station proves no command/result with that ID and hash | exact-byte retry may be authorized |
| `accepted_pending` | Local Home Station durably owns the matching command/outbox while remote business completion is pending | apply the authoritative pending projection, then purge Mobile durability |
| `terminal_result` | Station returns the matching `FriendRequestCommandResult` | map committed/duplicate to checkpoint; map rejected/conflict to terminal failure |
| `unresolved` | Lookup is absent, unavailable, ambiguous, or hash-mismatched | block the ordering key and require explicit recovery |

For Friend Request, the required Station contract is a generated lookup by
authenticated actor plus `command_id`, returning the persisted payload hash,
local durable-acceptance state, and `FriendRequestCommandResult` when terminal.
The existing list projection and synchronous projection response are not
substitutes for that lookup. A cross-Station request may remain
business-pending after the local Home Station durably accepts its command and
outbox; that state is `accepted_pending`, not remote business success.

### 4.3 Retry And Deadline Policy

Validation, schema, signing, and deterministic policy failures are
`failed_terminal` before admission. A retryable local availability failure
before dispatch leaves the command queued without incrementing a transport
attempt.

Each dispatch and authoritative readback attempt has a 30-second runtime-owned
deadline, matching the existing Mobile Station transport request bound. Once
dispatch starts, any deadline, disconnect, cancellation, timeout, or
response-decode failure enters `unknown-outcome`; it never goes directly to
retry. A readback deadline keeps the command unresolved/reconciling and never
authorizes replay.

After authoritative readback proves `not_found`, retry uses the same bytes,
command ID, hash, signature, and domain expiry. Automatic retries use full
jitter over exponential delays starting at 1 second and capped at 60 seconds.
They stop after eight transport attempts or the generated domain expiry,
whichever occurs first. Restart, background/foreground, network changes, and
process generation changes do not reset `attempt_count`.

Cancellation and dispatch use one persisted compare-and-swap fence. A cancel
transaction may move only `queued` or `retry_wait` to `cancelled`. A dispatcher
must first move the same row to `dispatch_fenced`, persist
`attempt_count + 1` and `dispatch_started_at`, and only then send bytes. The
first transaction to commit wins. A crash after `dispatch_fenced` recovers as
`unknown_outcome`, even when the transport may not have emitted bytes; only
authoritative `not_found` can authorize another dispatch.

### 4.4 State Machine

```text
queued -> dispatch_fenced -> submitting
queued -> cancelled -> purged      // only before any dispatch begins
queued -> failed_terminal          // validation/schema/signing/policy
retry_wait -> dispatch_fenced -> submitting
retry_wait -> cancelled -> purged
dispatch_fenced -> unknown_outcome // crash/cancel after the fence
submitting -> accepted_pending
submitting -> committed
submitting -> failed_terminal
submitting -> unknown_outcome
submitting -> retry_wait           // authoritative Station not_found only

unknown_outcome -> reconciling
reconciling -> accepted_pending
reconciling -> committed
reconciling -> failed_terminal
reconciling -> retry_wait          // authoritative not_found only
reconciling -> unresolved

retry_wait -> unresolved           // attempt ceiling or domain expiry

accepted_pending -> checkpointing -> purged
committed -> checkpointing -> purged
failed_terminal -> acknowledged -> purged
unresolved -> reconciling|discarded
```

`origin_generation` rejects stale callbacks in the originating process but
does not gate restart recovery. After restart, exact Station/PTID scope is
verified and the record is rebound to the new in-memory generation.
`discarded` means Mobile stops local tracking; it never means Station cancelled
or rolled back the business operation. `dispatch_fenced` is the durable
linearization point; after it commits, the available local action is
discard-tracking, not cancel.

Internal resolver states project to the accepted product states without adding
a second user-visible state model:

| Internal state | Product projection |
|---|---|
| `queued`, `dispatch_fenced`, `submitting`, `accepted_pending`, `checkpointing` | `pending` |
| `retry_wait` | `failed-retryable` |
| `committed` | `committed` |
| `failed_terminal` | `failed-terminal` |
| `unknown_outcome`, `reconciling`, `unresolved` | `unknown-outcome` or `reconciling` |
| `cancelled`, `discarded` | `cancelled` with the explicit local-only consequence |

### 4.5 Retention And Capacity

`CommandAdmissionPolicy` remains normative:

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

The authoritative result and local projection checkpoint commit atomically.
Only then is the full command row, including payload, removed. Mobile keeps no
committed audit tombstone because Station owns command and event audit truth.
A terminal rejected/conflict row remains until the failure projection is
acknowledged, then is removed. Unresolved rows and their exact bytes remain
until authoritative convergence or explicit discard.

### 4.6 Reliability Key Hierarchy

Rust generates one random 256-bit install key-encryption key and stores it in
the native Keychain/Keystore as a versioned, device-only, non-synchronizing
record with a stable `kek_id`. Each exact `station_peer_id + actor_ptid` scope
gets a random 256-bit data-encryption key whose wrapped record remains in the
same Rust-owned secure-storage namespace and binds `kek_id`, Station/PTID,
schema revision, and AEAD metadata. HKDF-SHA256 derives separate v2
command-ledger and draft-store AES-256-GCM keys from that scope key and fixed
domain-separation labels.

Session credentials authorize activation of an exact scope. They never derive,
wrap, name, or cross the Web/Rust boundary as a persistence key. Logout and
Station replacement close admission and always quarantine unresolved commands
under the original scope. Drafts independently require the product-state
retain/discard decision. Until the draft decision commits, lifecycle remains
outside the next Shell and Rust retains the closed exact-scope store. Draft
retain preserves its rows; draft discard deletes only draft rows and reports a
blocking cleanup failure when deletion cannot complete. Exact Station/PTID
re-authentication may reopen retained drafts and unresolved commands. The scope
key is removed only when neither remains, or during explicitly authorized
whole-app reset.

Each v2 store contains authenticated scope/schema metadata. Rust verifies that
metadata with the unwrapped scope key before crash recovery or any state
mutation. A missing or invalid install/scope key fails closed; Rust never
generates a replacement key over existing ciphertext.

Whole-app reset is journaled and idempotent: close stores, remove scope-key
records and databases, remove the old install key, then create a new install
key only when fresh v2 storage initializes. Reinstall behavior follows the
native secure-storage platform result. The secure record binds a random
app-data `install_epoch`; a surviving Keychain/Keystore record from another
epoch cannot open a new store. If no reliability database or quarantine exists,
Rust may retire that orphan and initialize a fresh key. If any ciphertext
exists, a key/epoch mismatch is a blocking recovery state rather than an
implicit reset.

### 4.7 V1 Quarantine

V1 command and draft databases have no trustworthy Station/PTID provenance.
Before a v2 store opens, Rust performs a crash-recoverable quarantine
transaction: close SQLite handles, create and fsync a manifest, rename every
existing main/WAL/SHM file on the same filesystem, fsync source and destination
directories, then atomically mark the manifest complete. Any partial or
ambiguous manifest keeps all admission closed until recovery completes. Rust
must not decrypt rows to infer scope, assign them to the active account,
restore them into editors, replay them, or count them against v2 capacity.

The v1 implementation accepted a caller-supplied `db_dir`, but no production
runtime ever invoked that initializer. Quarantine therefore owns only the
canonical Rust app-data reliability root and the exact legacy filenames
`command_ledger.db`, `draft_store.db`, and their `-wal`/`-shm` companions.
Rust must not scan or delete arbitrary caller-selected filesystem paths. This
is a fail-closed ownership boundary, not a promise to recover abandoned
development files outside the canonical app-data root.

The quarantine state closes command admission and exposes exactly three
actions:

- `retain`: preserve the opaque archive and remain read-only;
- `discard legacy`: remove the archive and initialize an empty v2 store;
- `reset all local reliability data`: remove v1/v2 files and rotate the
  install key.

Evidence may claim logical database, path, record, or key absence. It must not
claim secure physical deletion across SQLite WAL, filesystem snapshots,
backups, or flash wear-leveling unless the platform proves all ciphertext and
the unique decryption key irrecoverable.

## 5. Device-Local Draft Projection

Chat and Moments drafts are local product state, not Station truth. Their
generated v2 envelope is keyed by
`station_peer_id + actor_ptid + surface_kind + target_id`:

```text
MobileDraftEnvelopeV2 {
  schema_revision
  station_peer_id
  actor_ptid
  surface_kind // chat_composer | moment_composer
  target_id
  updated_at
  oneof payload {
    ChatDraftPayload chat
    MomentDraftPayload moment
  }
}
```

`ChatDraftPayload` contains composer text and encrypted attachment references.
`MomentDraftPayload` contains composer text, generated audience selection, and
encrypted media references. Neither payload contains media bytes or a
dispatchable command frame.

The single persistent owner is an encrypted `mobile-rust` draft store.
mobile-web owns editing state and writes through typed Tauri commands. A draft
is deleted only after authoritative commit, explicit discard, or confirmed
scope removal. It is never replayed as a command and never exposed under another
Station/PTID scope. It uses the scope key hierarchy in §4.6, so deletion or
rotation of session credentials does not make an intentionally retained draft
unreadable.

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

## 7. Accepted Owner-Closure Contract Shapes

> **Status**: accepted on 2026-09-18. Names are semantic contracts; field
> numbers and package placement require the corresponding Model change.

### 7.1 Access Gate Action

```text
AccessGateActionDescriptor {
  action_id
  gate_type
  submit_action
  schema_revision
  schema_sha256
  input_schema_json
}

SubmitAccessGateActionRequest {
  attempt_id
  gate_id
  action_id
  gate_type
  station_peer_id
  device_id
  lifecycle_generation
  schema_revision
  schema_sha256
  submission_id
  oneof action {
    login
    session_restore
    oauth
    invite_code
    device_trust
    schema_bound_values
  }
}
```

`schema_bound_values` contains only canonical scalar values keyed by a field
name declared in the exact descriptor. It cannot contain credentials, URLs,
binary payloads, nested executable data, or undeclared fields. Station returns
the next `AccessDecision`; a candidate credential remains attempt-scoped until
the Station finalizer commits `granted`.

### 7.2 Social Relationship Authority

```text
SocialRelationshipCommand {
  version
  command_id
  action                 // block | unblock
  actor_ptid             // derived from authenticated subject
  target_actor_ptid
  actor_home_station_peer_id
  target_home_station_peer_id
  observed_revision
  client_timestamp
  deadline
  payload_sha256
  actor_device_signature
}

RelationshipProjection {
  target_actor
  following
  followed_by
  blocked_by_viewer
  interaction_allowed
  denied_reason          // generic; never exposes peer block direction
  revision
}

ListBlockedActorsRequest {
  cursor
  limit
}

ListBlockedActorsResponse {
  repeated BlockedActorProjection items
  next_cursor
}
```

Block command result and lookup bind `command_id + payload_sha256` and resolve
to accepted-pending, terminal result, not-found, or unresolved. An ordered
relationship event carries the resulting revision and invalidation classes.
The block transaction removes both visible follow directions and invalidates
pending relationship eligibility. Unblock does not recreate them.

Federation carries a signed directional edge event with source/target Home
Station, relationship revision, command identity, and expiry/replay metadata.
The remote side materializes only the deny state needed for enforcement and
does not expose peer direction to clients.

### 7.3 Conversation Member And Message Actions

Member authority reuses the accepted:

```text
ConversationMemberAuthorityCommand
UpdateConversationMemberRequest
TransferConversationOwnershipRequest
ConversationMemberAuthorityCommittedFact
```

Mobile consumes `muted_until`, authority sequence/hash, membership/MLS epochs,
and the complete resulting snapshot. It does not define a second Group command.

Message actions have separate generated intents:

```text
RetractMessageIntent {
  message_id
}

HideMessageForActorIntent {
  message_id
}

ModerateMessageIntent {
  message_id
  reason_code
}

ForwardMessageIntent {
  destination_message_id
  content_kind
  repeated EncryptedObjectDescriptor destination_attachments
  repeated PreparedEndpointPayload destination_payloads
  destination_payload_sha256
}
```

Any source reference or forward attribution is bounded private metadata inside
the endpoint-encrypted destination payload, not authority-visible routing data.
It is provenance, not authorization. Device Messaging Engine must already hold
an entitled plaintext/object projection, then create fresh destination
encryption and grants. All results use the existing Conversation command
ID/hash resolver shape and ordered authority events. Actor-hide readback is
actor-scoped; retract and moderation readback are shared tombstones; forward
readback is the destination message projection.

### 7.4 Moments Visibility

```text
MomentDetailReadback {
  object_id
  oneof state {
    Post available
    PolicyHidden policy_hidden
    Deleted deleted
    NotFound not_found
    Unavailable unavailable
  }
}

FeedPageProjection {
  repeated Post posts
  repeated FeedObjectExplanation explanations
  next_cursor
  has_more
  FeedPolicySummary policy_summary
}

FeedPolicySummary {
  visible_count
  policy_filtered_count
  bool source_nonempty
  repeated PolicyReasonClass reason_classes
}
```

The summary is viewer-scoped and intentionally omits hidden object IDs,
authors, content, and block direction. `source_nonempty` may distinguish a
filtered-empty page only when Social can prove that fact without leakage.
Otherwise the result is `unavailable`, not an inferred empty state.

### 7.5 Native Media Staging

```text
NativeMediaPickRequest {
  request_id
  surface_kind
  capability
  lifecycle_generation
  deadline
  accepted_media_kinds
  max_item_count
  max_total_bytes
}

NativeMediaPickResult {
  request_id
  lifecycle_generation
  oneof outcome {
    SelectedMedia selected
    Cancelled cancelled
    PermissionRequired permission_required
    Expired expired
    NativeFailure failed
  }
}

SelectedMedia {
  repeated StagedMediaHandle items
}

StagedMediaHandle {
  handle
  media_kind
  mime_type
  byte_length
  sha256
}
```

The handle resolves only inside Rust's app-owned staging store and exact
Station/PTID draft scope. Web cannot provide a filesystem path. Selected
content becomes a Social object descriptor only after Secure Content
encryption/upload and Social publish commit.

### 7.6 Settings Projection

Settings does not gain one aggregate persistence message. It composes:

- Station policy/capability/configuration as a Station-owned read-only
  projection, while the Station registry and selection remain device-local;
- Actor Profile response/update fields for profile and four privacy values;
- a `NotificationPreferencesSnapshot` and push-device contracts;
- Social `RelationshipProjection` plus paginated outgoing blocked actors;
- a typed device-local preferences record for theme, font size, compact
  density, language, cache controls, permission state, and app metadata.

There is no additional account-preference field, service, runtime, or
placeholder section in the current release.

```text
ActorProfile {
  ...
  profile_revision
}

UpdateProfileRequest {
  optional editable profile/privacy fields
  observed_revision
}

UpdateProfileResponse {
  outcome // APPLIED | UNCHANGED | CONFLICT
  profile // canonical latest ActorProfile
}

NotificationPreferencesSnapshot {
  repeated NotificationPreference preferences
  notification_preferences_revision
}

NotificationPreferencePatch {
  category
  enabled
  push_enabled
  sound_enabled
}

UpdateNotificationPreferencesRequest {
  repeated NotificationPreferencePatch updates
  observed_revision
}

UpdateNotificationPreferencesResponse {
  outcome  // APPLIED | UNCHANGED | CONFLICT
  snapshot // canonical latest complete category snapshot
}
```

Profile persists `profile_revision` with `touch_actor_meta`, starts at `1`,
locks Actor then meta, compares only editable values, updates both rows in one
transaction, and increments once only when an editable value changes.
Notification persists one revision row per actor, starts at `1`, validates the
whole batch before mutation, locks the revision owner, commits every changed
category atomically, and increments once.

Applied, unchanged, and conflict outcomes use HTTP `200`. Invalid/empty
mutation or zero observed revision is `400`; missing authentication is `401`;
owner failure is `500`. Conflict never writes and always includes the latest
snapshot. A lost response is reconciled by GET before any retry.

The UI draft records exactly one selected owner and its base revision. One
owner failing does not replace another owner's canonical value or save state.

### 7.7 Native Transport, Push, And Scheduled Work

```text
MobileStationOperation {
  operation_id            // generated allowlisted operation
  station_peer_id
  actor_ptid
  lifecycle_generation
  request_id
  deterministic_body
  deadline
}

PushChannel {
  APNS
  FCM
  UNIFIED_PUSH
}

PushEnvironment {
  DEVELOPMENT
  PRODUCTION
}

ActorDeviceRef {
  actor_ptid
  device_id
}

RegisterPushDeviceRequest {
  request_id
  device_id               // must equal authenticated device assertion
  lifecycle_generation
  app_install_epoch_sha256
  environment
  oneof provider_binding {
    ApnsPushBinding apns
    FcmPushBinding fcm
    UnifiedPushBinding unified_push
  }
}

PushRegistration {
  registration_id
  actor_device
  channel
  environment
  app_install_epoch_sha256
  provider_binding_sha256 // Station-scoped HMAC fingerprint
  created_at
  updated_at
  last_success_at
}

RegisterPushDeviceResponse {
  request_id
  outcome                 // CREATED | ROTATED | UNCHANGED
  registration
}

UnregisterPushDeviceRequest {
  request_id
  device_id
  lifecycle_generation
  registration_id
  app_install_epoch_sha256
}

UnregisterPushDeviceResponse {
  request_id
  outcome                 // REMOVED | ALREADY_ABSENT
}

ListPushDevicesResponse {
  repeated PushRegistration registrations
}

NativeWakeup {
  source                  // push | work_manager | bg_task
  native_sequence
  lifecycle_generation
  notification_id
  target_hint
  deadline
}
```

Rust attaches credentials and validates origin, generation, bounds, redirects,
and response type. The Web result excludes credentials and headers.

Provider bindings are write-only. They stay native/Rust in Mobile, are
registered with Notification only for the active Station/PTID/device, and are
stored as AES-256-GCM ciphertext under a versioned Station key. Neither
registration response nor readback exposes token, endpoint, encryption key,
auth secret, ciphertext, nonce, or plaintext credential. The public provider
fingerprint is Station-scoped HMAC output rather than a raw token digest.

Registration is unique by actor/device/channel/environment. Exact request
replay returns the same redacted response; request-ID/body mismatch and
cross-device provider reuse fail without mutation. Same-tuple provider
rotation atomically replaces the encrypted credential. Unregister binds the
authenticated actor/device, registration ID, and install epoch and is
idempotent.

Push receipt marks projections stale. A tap routes only after active-scope
validation and authoritative reconcile. Scheduled work emits `NativeWakeup`
only, observes platform cancellation/expiration, and completes exactly once.

Scheduled reconciliation uses exactly two app/environment identifiers:

```text
com.peers.touch.mobile.reconcile.v1.development
com.peers.touch.mobile.reconcile.v1.production
```

Native scheduled callbacks add an opaque completion ID and a 25-second
deadline. Rust accepts only the current generation and increasing native
sequence, performs bounded reconciliation, and acknowledges the completion ID.
Success, failure, cancellation, expiration, and duplicate acknowledgement
converge on one native terminal transition.

Native media selection uses `NativeMediaPickRequest` and
`NativeMediaPickResult` from section 7.5. Native selected items contain
temporary app-private paths only on the native-to-Rust boundary. Rust verifies
the regular file, declared length, SHA-256, count, aggregate byte limit,
deadline, generation, and Station/PTID draft scope before moving bytes to:

```text
<app-data>/native-media-staging/v1/<scope-digest>/<opaque-handle>.stage
```

Only the opaque handle and metadata cross to Web. Rust deletes all native
temporary files after success or rejection and removes partial staged files on
failure.

## 8. Semantic Hard-Cut Inventory

The verified production hard-cut result is:

| Owner | Legacy operation | Current caller count | Canonical target |
|---|---|---:|---|
| Conversation | member role/mute update | 0 | `/conversation/member/update` through Device Messaging Engine |
| Conversation | ownership transfer | 0 | `/conversation/ownership/transfer` through Device Messaging Engine |
| Social | Chat-owned block | 0 | generated Social relationship command |
| Social | Chat-owned unblock | 0 | generated Social relationship command |
| Social | Chat-owned blocked list | 0 | generated Social paginated projection |
| Social | Chat-owned relationship status | 0 | generated Social relationship projection |

Closure requires all listed operations to use the canonical Conversation and
Social owners. Friend/Group-specific Chat Proto, generated bindings, routes,
gateways, stores, runtimes, tests, and Acceptance resources are deleted.
Generated comments and historical documents cannot be imported or used as
fallback runtime paths.

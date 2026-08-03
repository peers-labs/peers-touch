# Federated IM Architecture — Design

> **Status**: draft
> **Version**: v0.4
> **Created**: 2026-07-04 | **Updated**: 2026-08-03
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/conversation/`, `apps/station/app/subserver/envelope/`, `apps/station/frame/touch/actor/`, `apps/station/frame/touch/federation/`, `model/domain/chat/`, `model/domain/federation/`

> **v1 unification update (2026-07-11)**: This design now reflects the approved
> decisions D-08…D-12 (see `decisions.md`). Group E2EE is **MLS (RFC 9420)**, not
> Sender Keys (D-06 superseded). Direct and group chat share one reliable
> **Station signaling-envelope channel** with typed QoS (D-10). Direct chat uses
> **X3DH + Double Ratchet** (D-09). Text always rides the envelope; **P2P is
> audio/video and large files only** (D-12). Cutover is hard with legacy chat data
> wiped (D-11). Where older passages below still said "SKDM / Sender Key", they
> have been rewritten to the MLS key-delivery model carried over the same envelope.

---

## 1. Core Principles

1. **Governance and chat traffic are separate.** Federation Ledger records Station/Federation governance. It must not carry chat messages, MLS key-delivery payloads, typing events, read receipts, or online presence.
2. **Every federated group has one authority Station in the Foundation Profile.** The authority Station owns the group event log, membership epoch, message sequence, MLS Commit ordering, and lifecycle state.
3. **Remote Stations submit signed proposals, not truth mutations.** A member's Home Station may propose messages or lifecycle commands, but the group authority validates and commits them.
4. **E2EE key material stays on devices.** Stations route opaque MLS key-delivery envelopes (Welcome/Commit/KeyPackage) but must not store MLS group secrets, ratchet keys, or any plaintext.
5. **Clients render projection and execute crypto.** Desktop/Mobile hydrate Station projections, process MLS Commits/Welcome, decrypt locally, and display policy states.
6. **Family-scale reliability beats premature consensus.** Ordinary chat uses authority sequencing for latency and availability; quorum recovery is reserved for authority loss and future high-value groups.
7. **One reliable envelope, typed QoS.** Direct and group chat share a single Station signaling-envelope channel (D-10) carrying committed events, key-delivery payloads, receipts, and low-latency signals; text never uses P2P (D-12).
8. **One membership transition fact.** Under accepted D-13, group membership,
   `membership_epoch`, MLS epoch, opaque Commit ordering, and durable fan-out
   are accepted or rejected together by the authority Station.
9. **One remote authority-command trust protocol.** Under accepted D-17, every
   authority-committed remote `ConversationCommand` uses the same
   actor-device-signed proposal, Home Station token, verifier, idempotency
   journal, and canonical committed-event result. Ephemeral typing remains on
   the signaling plane.

## 2. System Architecture

```text
Desktop / Mobile
  ├─ local projection store
  ├─ local E2EE store
  └─ Home Station API / SSE
        │
        ▼
Home Station of actor
  ├─ local auth and ActorRef signing
  ├─ local projection cache
  ├─ proposal outbox / delivery cursor
  ├─ local SSE fan-out
  └─ federation transport
        │
        ▼
Group Authority Station
  ├─ group event log
  ├─ group membership and role truth
  ├─ membership_epoch / authority_epoch
  ├─ message sequence allocator
  ├─ group lifecycle policy
  └─ cross-Station fan-out outbox
        │
        ▼
Remote Member Stations
  ├─ replicated group projection
  ├─ per-actor delivery cursors
  ├─ local SSE fan-out
  └─ proposal retry / resync

Federation Ledger
  └─ Station membership, policy, sequencer/handover governance only
```

The architecture intentionally has two logs:

| Log | Owner | Frequency | Contains | Does Not Contain |
| --- | --- | --- | --- | --- |
| Federation Ledger | Federation sequencer | Low | Station governance and policy facts | Chat messages, MLS key-delivery, presence |
| Group Event Log | Group authority Station | High | Group lifecycle, membership, MLS Commit ordering, message ciphertext references, mutations | MLS group secrets, message plaintext |

## 3. Scope / Non-Scope

In scope:

- federated group and private IM across multiple member Stations;
- group authority model for ordinary groups;
- signed remote message/lifecycle proposals;
- group event log and follower replication;
- membership epoch, authority epoch, and MLS epoch progression triggers;
- family-scale pressure target: about 100-person groups and many private chats on a Home Station.

Out of scope for the Foundation Profile:

- full consensus for every IM message;
- automatic multi-master group operation;
- public global discovery registry;
- Station-readable group plaintext;
- remote hard deletion of other members' local history;
- cloud-scale group operation.

## 4. Sources Of Truth And Ownership

| Capability | Truth Owner | Replicas / Consumers | Forbidden Relationship |
| --- | --- | --- | --- |
| Federation Station membership | Federation Ledger materialized by Station | Member Stations | Group service invents active Station membership |
| Federated Actor identity | ActorRef / Home Station | Group authority and member Stations | Wire payload uses local actor ID as global identity |
| Group lifecycle state | Group authority Station | Member Station projections | Remote Station mutates group state directly |
| Group event ordering | Group authority Station | Follower Stations | Clients or followers allocate committed group seq |
| Group membership epoch | Group authority Station | Clients and follower Stations | MLS Commit ordering ignores or diverges from `membership_epoch` |
| Group message plaintext | Sender/receiver devices | None | Any Station logs or persists plaintext body |
| MLS group state / key material | Device local crypto store | None | Station stores MLS group secrets or ratchet/signing private keys |
| Local user notification | Home Station + client runtime | Client UI | Group authority pushes UI state directly to remote client |
| Stress-test evidence | Quality/acceptance harness | PR/release review | Manual spot checks replace family-scale evidence |

## 5. Runtime Units And Boundaries

### 5.1 Group Authority Station

The group authority Station is selected when the group is created:

```text
creator ActorRef.home_station_peer_id == group_authority_station_peer_id
```

Foundation Profile rules:

- ownership transfer changes the group owner actor, not the authority Station;
- authority handover is not automatic;
- if the authority Station is temporarily unavailable, the group becomes read-only/degraded on follower Stations;
- if the authority Station is permanently lost, the group becomes orphaned read-only until a future handover/recovery protocol is available.

### 5.2 Actor Home Station

The actor Home Station:

- authenticates the local actor;
- accepts actor-device-signed proposals and adds short-lived Station transport
  authentication without creating an actor signature;
- queues proposals to remote group authority Stations;
- stores local projection and delivery cursors;
- delivers SSE events to local clients.

It must not:

- commit events for groups it does not authoritatively own;
- claim remote actors with local actor IDs;
- alter committed group event log entries from another authority.

### 5.3 Federation Transport

The federation transport carries signed proposals and committed event replication between Stations. It may use existing relay-mediated pub/sub or direct Station-to-Station transport, but it must preserve:

- origin Station identity;
- target Federation scope;
- payload signature bytes;
- idempotency key;
- delivery status and retry metadata.

Relay is transport, not truth owner.

### 5.4 Client Runtime

Desktop/Mobile:

- calls Home Station APIs;
- observes Home Station SSE;
- executes local crypto;
- displays policy states such as waiting key, before-join history, removed, dissolved, degraded.

Clients must not:

- make Station-side authorization decisions;
- manually duplicate federated group contracts instead of generated Model contracts;
- infer group membership from UI-only cached data.

## 6. Core Contracts And Flows

### 6.1 Federated Group Create

```text
Alice@StationA creates group in Federation F
  -> StationA verifies it is an active member Station in F
  -> StationA creates group_ulid with authority_station_peer_id = StationA
  -> StationA writes GroupCreated(seq=1, membership_epoch=1, authority_epoch=1)
  -> StationA invites/adds member ActorRefs according to group policy
  -> StationA fans out committed events to member Home Stations
```

Initial direct-add is allowed only if the group policy says so. Otherwise, member ActorRefs receive invitations and join after acceptance.

### 6.2 Remote Member Send

```text
Bob@StationB sends to group owned by StationA
  -> Bob client encrypts payload as an MLS application message for the current MLS epoch
  -> Bob device signs one ConversationCommandProposal over the canonical command hash
  -> StationB authenticates Bob/device and verifies its durable follower route/head
  -> StationB mints a short-lived, command-bound peer token and forwards the proposal
  -> StationA verifies Station/Federation/actor-device signatures and exact field binding
  -> StationA resolves command_id idempotently and runs the same SubmitCommand service
  -> StationA allocates committed group_seq and appends MessageCommitted
  -> StationA replicates event to member Stations
  -> StationB/StationC fan out local SSE to their clients
```

StationA validates metadata and ciphertext envelope shape, not plaintext.

#### 6.2.1 Accepted D-17 Remote Command Boundary

D-17 applies only to authority-committed command kinds:

```text
send_message | edit_message | retract_message | dissolve |
update_settings | react | pin_message | membership_transition
```

`typing` is ephemeral and stays on the D-10 signaling channel. Receipts retain
their dedicated typed receipt contract. Neither becomes a committed group event
through the proposal wrapper.

The device, Home Station, and authority responsibilities are distinct:

| Boundary | Responsibility | Forbidden behavior |
| --- | --- | --- |
| Device | deterministically encode command, hash it, sign proposal input | give the Home Station its actor private key |
| Home Station | authenticate exact PTID/device, verify follower routing facts, persist retry state, mint peer token | commit remote truth or alter signed command bytes |
| Authority | verify both trust layers, resolve exact retry, authorize command, commit canonical event | trust proposal-supplied public keys or accept direct remote client writes |

`command_id` is required for every authority-committed command. The authority
owns an idempotency journal keyed by `(conversation_id, command_id)`:

- the same deterministic command hash returns the same committed event;
- a different hash for the same key returns `COMMAND_CONFLICT`;
- retries never allocate a second `group_seq` or duplicate fan-out.

For every durable command, one authority transaction owns:

```text
lock conversation head
  -> resolve command receipt or conflict
  -> validate command-specific authorization/admission
  -> allocate group_seq
  -> append canonical committed event
  -> insert command receipt
  -> insert deterministic replication/inbox outbox rows
commit
```

No post-commit network submission is the durability source. Workers only wake
and deliver rows that already committed with the event. A crash exposes either
none of the command/event/outbox or all of them.

The Home Station may remint an expired peer token without changing device-signed
bytes. It retries a durable proposal until the authority returns an accepted or
terminal rejected result, or until the immutable device-signed command expiry.
Authority unavailability creates no local committed event. An expired command
is terminal and cannot be extended by the Home Station. A client cannot cancel
a signed command after Home Station acceptance; message retraction or another
compensating command is the explicit follow-up.

Admission is bounded before authority mutation. Oversized commands,
ciphertexts, or attachment metadata return `PAYLOAD_TOO_LARGE`; saturated Home
or authority queues return `RATE_LIMITED`. Exact byte/count thresholds are
Station policy surfaced through typed limits and must be exercised by the
acceptance gate. No queue is unbounded.

Home Station dispatch is FIFO for one conversation and fairly scheduled across
actors/conversations under bounded per-actor, per-conversation, and global
limits. It must not reorder accepted commands inside one conversation to
prioritize membership over messages; the authority head decides the resulting
order and stale commands receive typed rejection.

The actor-device signer is process/actor scoped, not window scoped. Multiple
Desktop windows share the same durable device identity through the Rust
identity runtime, generate distinct command IDs, and never copy private key
bytes into TypeScript or window state. Closing the originating window does not
cancel a Home Station-durable proposal; process shutdown preserves local queued
state and Home Station retry remains authoritative after durable acceptance.

#### 6.2.2 Accepted Endpoints And Result Recovery

```text
POST /conversation/command
  auth: local actor JWT + exact device header
  use: local-authority command only
  response: canonical committed event or typed rejection

POST /conversation/command-proposal
  auth: local actor JWT + exact device header
  use: Home Station durable acceptance of device-signed proposal
  response: home_accepted | accepted | terminal_rejected

POST /conversation/federation/command-proposal
  auth: scoped Station peer token
  use: Home Station worker to authority
  response: accepted | retryable_rejected | terminal_rejected

GET /conversation/command-proposal/result
  auth: local actor JWT + exact device header
  key: conversation_id + command_id
  response: current durable Home Station proposal/result state
```

The Home Station persists the proposal before attempting remote forwarding. A
fast authority response may be returned by the initial POST, but the request
may safely return `home_accepted` while forwarding continues.

On authority acceptance or terminal rejection, the Home Station atomically
stores the result and inserts a local device inbox notification addressed to
the originating actor/device. The D-10 signaling envelope carries only the
typed command result and public authority evidence. Reconnect can recover from
the local inbox or the result query; response loss never requires issuing a new
command ID.

The public `/conversation/command` route rejects a group whose authority is not
the authenticated actor's Home Station. The peer route rejects actor JWTs.
Remote clients never submit directly to the authority.

### 6.3 Membership Change

```text
Owner/Admin device creates an OpenMLS pending Commit
  -> device submits MembershipTransitionCommand to group authority
  -> authority validates role, Federation Station state, current heads,
     target epochs, transition id, Commit hash, size, and recipient routes
  -> authority transaction locks the conversation head
  -> transaction mutates members + advances membership_epoch/group_seq
  -> transaction appends MembershipTransitionCommitted with opaque Commit
  -> transaction inserts committed-event and Commit/Welcome outbox rows
  -> authority responds accepted with event id, seq, epochs, and hashes
  -> committer merges the pending Commit only after acceptance
  -> member Stations apply the ordered transition and enqueue local delivery
  -> recipient clients process Commit/Welcome before post-change sends
```

The Foundation Profile binds one business transition to one MLS transition:

```text
to_membership_epoch = from_membership_epoch + 1
to_mls_epoch        = from_mls_epoch + 1
to_membership_epoch = to_mls_epoch
```

Removed or left members are included in the pre-transition Commit recipient
set so they can process their eviction, but are excluded from all post-change
messages and group secrets. Added members receive recipient-specific Welcome
delivery tied to the same `transition_id`; they do not apply the Commit as an
existing member.

D-16 governs actor-initiated leave because RFC-conforming OpenMLS rejects a
Commit that removes the committer's own leaf. The departing device signs a
head-bound leave intent. A different active leaf removes every D-15 credential
for the target PTID, and the authority consumes the verified intent atomically
with the D-13 transition. A bare or self-authored `LEAVE` is invalid.

The client MUST keep a generated OpenMLS Commit pending until the authority
accepts the transition. Local durable MLS state cannot advance on request send,
transport ACK, or optimistic UI state. Authority rejection discards the pending
Commit and refreshes the authoritative projection before retry.

Authority admission rejects a transition before locking when Commit bytes exceed
128 KiB, Welcome payloads exceed 8 MiB total, or recipient device deliveries
exceed 200.

#### 6.3.1 Accepted Unified Signed Remote Command Submission

Local and remote commands converge on the same authority service:

```text
Remote member device
  -> prepares canonical ConversationCommand
  -> hashes the deterministic command and signs proposal input
  -> Home Station authenticates actor/device and resolves group authority
  -> Home Station forwards ConversationCommandProposal with Station token
  -> authority verifies Station token and active Federation membership
  -> authority resolves actor key from verified Actor identity projection
  -> authority verifies actor signature, command hash, and bound identifiers
  -> authority invokes the same SubmitCommand service as a local command
  -> authority returns ConversationCommandProposalResult
```

D-14 remains the membership-specific validation specialization inside this
generic D-17 boundary. Membership commands still require D-13 epoch, Commit,
Welcome, leave-intent, and exact pending-Commit acceptance checks. They do not
retain a second membership-only proposal protocol.

Trust boundaries:

- the device owns the actor signing private key;
- Actor identity/resolver owns the verified public-key projection and rotation;
- the Home Station owns transport authentication and the Station signature;
- Conversation owns proposal semantics, command idempotency, and authority
  business validation;
- Federation governance owns the active Station set;
- the authority event remains the only membership/MLS ordering truth.

Forbidden relationships:

- Home Station must not create an actor signature on behalf of the device;
- authority must not trust actor public-key bytes supplied by the proposal;
- Conversation must not persist a parallel actor signing-key copy;
- remote proposal handling must not emit or return legacy `GroupEvent`;
- membership handling must not retain a parallel
  `MembershipTransitionProposal` route after the D-17 hard cut;
- a verified Station token alone is insufficient to authorize an actor command.

Missing or stale identity projection, invalid actor signature, inactive Home
Station, claim mismatch, expired token, or command-hash mismatch rejects before
authority mutation. Exact command retry resolves to the same canonical
committed event. Membership-specific semantic rejection also discards the
device's pending OpenMLS Commit.

### 6.4 Cross-Station MLS Key Delivery

MLS key-delivery objects remain opaque and ride the single Station signaling
envelope (D-10), and accepted D-13 defines their ordering owner:

```text
Committer device
  -> include opaque Commit/Welcome material in MembershipTransitionCommand
  -> authority commits transition event and transactional outbox rows
  -> federation transport retries durable rows asynchronously
  -> recipient Home Station stores authority event + local inbox rows atomically
  -> recipient client applies the authority-ordered Commit/Welcome
```

Key-delivery envelopes must bind:

- `federation_id`
- `group_ulid`
- `authority_station_peer_id`
- `membership_epoch`
- `sender_actor_ref`
- `sender_device_id`
- `recipient_actor_ref`
- `recipient_device_id`
- `transition_id`
- `group_seq`
- `from_membership_epoch` / `to_membership_epoch`
- `from_mls_epoch` / `to_mls_epoch`
- `commit_sha256` or `welcome_sha256`

The Station sees only opaque bytes plus this routing metadata; it never sees MLS group secrets.

Station verifies exact hashes and declared epoch progression. Recipient
OpenMLS verifies that the opaque Commit actually belongs to the expected group
and advances the expected cryptographic epoch.

`/mls/distribute` is not an ordering API in the D-13 target. Commit and Welcome
delivery are created only as effects of an accepted authority transition.
KeyPackage upload/fetch remains a separate directory capability.

### 6.5 Follower And Device Convergence

Follower Stations maintain one authority-derived head:

```text
FollowerGroupHead
  group_seq
  event_hash
  membership_epoch
  mls_epoch
  transition_id
  commit_sha256
  status
```

Apply rules:

1. `group_seq == head.group_seq + 1` and both epochs advance according to the
   event transition.
2. Applying the same `transition_id` with the same hashes is a no-op.
3. Reusing a transition id or group sequence with a different event/Commit hash
   activates fork protection and read-only state.
4. A future sequence or epoch is held in a bounded 128-event buffer and starts
   authority resync. Buffer overflow remains read-only and requires a snapshot.
5. Disconnect resume starts from the last transactionally applied sequence, not
   the last received or SSE-delivered sequence.

Follower projection mutation and local recipient inbox insertion occur in one
database transaction. Network ACK is emitted only after that transaction
commits.

Client runtime rules:

- Commit application is idempotent by `(transition_id, commit_sha256)`.
- duplicate delivery is acknowledged without reapplying OpenMLS state;
- future transitions are buffered by authority `group_seq`;
- a gap triggers Station resync and blocks post-gap sends;
- OpenMLS rejection, hash mismatch, or impossible epoch progression puts the
  conversation in crypto-desynced read-only state;
- reconnect replays from the last durable local transition, then drains the
  bounded buffer in order.

### 6.5.1 Accepted Device-To-Leaf Identity

D-15 requires that every MLS leaf use deterministic protobuf
`MlsDeviceCredential{version, ptid, device_id}` bytes as its BasicCredential
identity. Actor membership remains Station truth; device-to-leaf identity
remains client/OpenMLS truth.

Allowed relationships:

- Station orders actor/device transition descriptors but does not parse MLS
  KeyPackages or Commits.
- Clients validate KeyPackage credentials against directory routing metadata.
- Clients resolve exact device leaves locally and verify received Commits
  against the authority transition.

Forbidden relationships:

- selecting the first leaf whose credential contains only PTID;
- ad hoc `ptid#device_id` string identities;
- Station-owned MLS leaf indexes or device secret synchronization;
- compatibility fallback for PTID-only development credentials.

This boundary is accepted and authorizes the proto-first hard cutover.

### 6.6 Dissolve And History Retention

Group dissolution is a committed group event:

```text
GroupDissolved(seq=N, dissolved_by, dissolved_at)
```

Foundation Profile behavior:

- group becomes read-only;
- committed ciphertext history remains available to entitled members;
- no new messages, invitations, or member changes are accepted;
- local clear history remains a per-actor projection operation;
- group owner cannot remotely erase other members' local decrypted history.

## 7. Authority Loss And Recovery

Foundation Profile:

```text
authority reachable      -> normal read/write
authority temporarily lost -> degraded read-only followers
authority permanently lost -> orphaned read-only group
```

The architecture reserves, but does not implement initially:

- signed authority handover;
- Federation quorum recovery;
- high-value consensus-backed group profile.

Any future recovery must prove:

- last committed group event head;
- complete event log or verified snapshot;
- Federation policy authority for handover;
- new authority signature;
- `authority_epoch` bump;
- MLS epoch progression before new writes.

## 8. Security And Privacy Constraints

Mandatory:

- no group plaintext in Station logs, persistence, or diagnostics;
- no MLS group secrets or ratchet/signing private keys in Station persistence;
- every remote proposal carries actor and Station signatures;
- receiver verifies source Station is active in the Federation scope;
- direct private-group join is forbidden without valid invitation;
- stale membership epoch send is rejected;
- removed/suspended Station cannot publish or receive new group events;
- transport retries must be idempotent;
- metrics must not expose message plaintext, private keys, or raw MLS key-delivery bytes.

## 9. Component Relationships

| Component | Responsibility | Inputs | Outputs |
| --- | --- | --- | --- |
| Federation Governance | Station membership and policy truth | Ledger events/proposals | Materialized active Station set |
| Actor Resolver | Cross-Station identity resolution | Federation scope + handle/ActorRef | Verified ActorRef projection |
| Actor Device Identity | Device-local Ed25519 signer and Station-side verified public projection | authenticated actor/device scope, signed profile | signatures and verified device key records |
| Command Proposal Gateway | D-17 Home/authority transport authentication and field binding | device-signed command, follower route, peer token | verified canonical command or typed rejection |
| Command Receipt Store | Exact command replay/conflict resolution | conversation ID, command ID, command hash | canonical accepted/terminal result |
| Group Authority Service | Group lifecycle truth | local commands, remote proposals | committed group events |
| Group Follower Service | Local projection of remote group truth | committed group events | local query/SSE projection |
| Federation Delivery Outbox | Reliable cross-Station delivery | proposals/events | retries, cursors, status |
| Realtime Event Stream | Device-window notification | local projection events | SSE + resync |
| Client Crypto Runtime | E2EE encrypt/decrypt, MLS group state, direct-chat ratchet | key bundles, ciphertext, epoch, MLS Commit/Welcome | local plaintext projection |
| Stress Harness | Family-scale evidence | configured Stations/actors | latency/error/security reports |

The Actor Device Identity component is upstream of both the generic command
proposal signer and OpenMLS credential construction. The MLS runtime must not
become the owner of generic proposal signing merely because the current D-14
implementation first exposed the signer from an MLS module.

## 10. Three-Round Architecture Self Review

### Round 1 — Source Of Truth Review

Finding:

- The design originally risked blending Federation Ledger and Group Event Log.

Resolution:

- The final design keeps governance in Federation Ledger and chat facts in Group Event Log. This preserves the existing Federation rule that social data does not enter the governance ledger.

### Round 2 — Security Review

Finding:

- A remote Station could become too powerful if proposals were treated as committed events.

Resolution:

- Remote Stations submit signed proposals only. The group authority commits events after checking ActorRef, Station membership, group membership, role, mute state, and membership epoch.

### Round 3 — Availability And Scope Review

Finding:

- Full consensus on every message would improve authority failure handling but would hurt ordinary family Station latency and availability.

Resolution:

- The Foundation Profile uses authority sequencing and read-only degradation on authority loss. Quorum recovery is reserved for later authority handover, not ordinary message delivery.

## 11. Completeness Check

- Architecture layer: yes; it defines cross-Station ownership, allowed calls, forbidden relationships, and trust boundaries.
- Sources of truth: explicit for Federation Ledger, group authority, Model contracts, client crypto, and local projection.
- Runtime boundaries: explicit for authority Station, actor Home Station, federation transport, and clients.
- Contracts: conceptual contracts are defined in this document and expanded in `data-model.md`.
- Security: authorization, signatures, epoch checks, plaintext/key non-leakage, and diagnostics constraints are covered.
- Decisions: ADR-lite alternatives are recorded in `decisions.md`.
- Downstream constraint: platform implementations must not redefine authority, epoch, or MLS group-state ownership.

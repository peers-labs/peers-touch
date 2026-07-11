# Federated IM Architecture — Design

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-04 | **Updated**: 2026-07-11
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/group_chat/`, `apps/station/frame/touch/federation/`, `model/domain/chat/`, `model/domain/federation/`, `model/domain/realtime/`

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
- signs remote proposals with actor and Station credentials;
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
  -> StationB builds signed GroupMessageProposal
  -> StationB sends proposal to StationA
  -> StationA validates Federation membership, ActorRef, group member, role, mute, epoch
  -> StationA allocates committed group_seq
  -> StationA appends GroupMessageCommitted
  -> StationA replicates event to member Stations
  -> StationB/StationC fan out local SSE to their clients
```

StationA validates metadata and ciphertext envelope shape, not plaintext.

### 6.3 Membership Change

```text
Owner/Admin issues add/remove/leave/update
  -> command reaches group authority
  -> authority validates role and Federation Station state
  -> authority increments membership_epoch
  -> authority commits GroupMembershipChanged and orders the corresponding MLS Commit
  -> member Stations refresh projection
  -> clients process the MLS Commit / Welcome before post-change sends
```

Removed or left members are removed from the MLS group by the Commit and receive no post-change group secrets. `membership_epoch` and the MLS epoch advance together (see D-08 consequence).

### 6.4 Cross-Station MLS Key Delivery

MLS key-delivery objects (Welcome for new members, Commit for existing members, KeyPackage publication) are opaque client-to-client encrypted payloads carried over the single Station signaling envelope (D-10). Foundation Profile routing:

```text
Sender/committer device
  -> produce MLS Welcome/Commit for the target member devices
  -> Home Station routes opaque key-delivery envelope
  -> recipient Home Station stores/delivers the control event
  -> recipient client applies Welcome/Commit into local MLS group state
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

The Station sees only opaque bytes plus this routing metadata; it never sees MLS group secrets.

### 6.5 Dissolve And History Retention

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
| Group Authority Service | Group lifecycle truth | local commands, remote proposals | committed group events |
| Group Follower Service | Local projection of remote group truth | committed group events | local query/SSE projection |
| Federation Delivery Outbox | Reliable cross-Station delivery | proposals/events | retries, cursors, status |
| Realtime Event Stream | Device-window notification | local projection events | SSE + resync |
| Client Crypto Runtime | E2EE encrypt/decrypt, MLS group state, direct-chat ratchet | key bundles, ciphertext, epoch, MLS Commit/Welcome | local plaintext projection |
| Stress Harness | Family-scale evidence | configured Stations/actors | latency/error/security reports |

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


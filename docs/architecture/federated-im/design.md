# Federated IM Architecture — Design

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-04 | **Updated**: 2026-07-04
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/group_chat/`, `apps/station/frame/touch/federation/`, `model/domain/chat/`, `model/domain/federation/`, `model/domain/realtime/`

---

## 1. Core Principles

1. **Governance and chat traffic are separate.** Federation Ledger records Station/Federation governance. It must not carry chat messages, SKDM payloads, typing events, read receipts, or online presence.
2. **Every federated group has one authority Station in the Foundation Profile.** The authority Station owns the group event log, membership epoch, message sequence, and lifecycle state.
3. **Remote Stations submit signed proposals, not truth mutations.** A member's Home Station may propose messages or lifecycle commands, but the group authority validates and commits them.
4. **E2EE key material stays on devices.** Stations may route encrypted SKDM envelopes, but must not store Sender Key chain keys or group plaintext.
5. **Clients render projection and execute crypto.** Desktop/Mobile hydrate Station projections, install SKDM, decrypt locally, and display policy states.
6. **Family-scale reliability beats premature consensus.** Ordinary chat uses authority sequencing for latency and availability; quorum recovery is reserved for authority loss and future high-value groups.

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
| Federation Ledger | Federation sequencer | Low | Station governance and policy facts | Chat messages, SKDM, presence |
| Group Event Log | Group authority Station | High | Group lifecycle, membership, message ciphertext references, mutations | Sender Key plaintext, message plaintext |

## 3. Scope / Non-Scope

In scope:

- federated group and private IM across multiple member Stations;
- group authority model for ordinary groups;
- signed remote message/lifecycle proposals;
- group event log and follower replication;
- membership epoch, authority epoch, and Sender Key rotation triggers;
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
| Group membership epoch | Group authority Station | Clients and follower Stations | Sender Key rotation ignores epoch |
| Group message plaintext | Sender/receiver devices | None | Any Station logs or persists plaintext body |
| Sender Key material | Device local crypto store | None | Station stores chain key or sender signing private key |
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
  -> Bob client encrypts payload with Sender Key for current membership_epoch
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
  -> authority commits GroupMembershipChanged
  -> member Stations refresh projection
  -> clients rotate or request Sender Key distribution before post-change sends
```

Removed or left members receive no new post-change SKDM.

### 6.4 Cross-Station SKDM

SKDM remains a client-to-client encrypted control payload. Foundation Profile routing:

```text
Sender device
  -> encrypt SKDM for recipient device key bundle
  -> Home Station routes opaque SKDM envelope
  -> recipient Home Station stores/delivers control event
  -> recipient client installs Sender Key locally
```

SKDM envelopes must bind:

- `federation_id`
- `group_ulid`
- `authority_station_peer_id`
- `membership_epoch`
- `sender_actor_ref`
- `sender_device_id`
- `recipient_actor_ref`
- `recipient_device_id`

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
- Sender Key rotation before new writes.

## 8. Security And Privacy Constraints

Mandatory:

- no group plaintext in Station logs, persistence, or diagnostics;
- no Sender Key chain keys in Station persistence;
- every remote proposal carries actor and Station signatures;
- receiver verifies source Station is active in the Federation scope;
- direct private-group join is forbidden without valid invitation;
- stale membership epoch send is rejected;
- removed/suspended Station cannot publish or receive new group events;
- transport retries must be idempotent;
- metrics must not expose message plaintext, private keys, or raw SKDM.

## 9. Component Relationships

| Component | Responsibility | Inputs | Outputs |
| --- | --- | --- | --- |
| Federation Governance | Station membership and policy truth | Ledger events/proposals | Materialized active Station set |
| Actor Resolver | Cross-Station identity resolution | Federation scope + handle/ActorRef | Verified ActorRef projection |
| Group Authority Service | Group lifecycle truth | local commands, remote proposals | committed group events |
| Group Follower Service | Local projection of remote group truth | committed group events | local query/SSE projection |
| Federation Delivery Outbox | Reliable cross-Station delivery | proposals/events | retries, cursors, status |
| Realtime Event Stream | Device-window notification | local projection events | SSE + resync |
| Client Crypto Runtime | E2EE encrypt/decrypt/SKDM | key bundles, ciphertext, epoch | local plaintext projection |
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
- Downstream constraint: platform implementations must not redefine authority, epoch, or Sender Key ownership.


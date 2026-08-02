# Federated IM Architecture — Decisions

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-07-04 | **Updated**: 2026-08-02
> **Owner**: Architecture Team

---

## Decision Index

| ID | Decision | Status |
| --- | --- | --- |
| D-01 | Use a separate Group Event Log instead of Federation Ledger for chat facts | accepted |
| D-02 | Use creator Home Station as group authority in the Foundation Profile | accepted |
| D-03 | Remote Stations submit proposals, authority commits events | accepted |
| D-04 | Do not run consensus for every ordinary chat message | accepted |
| D-05 | Authority loss degrades groups to read-only before recovery exists | accepted |
| D-06 | Sender Keys remain device-local across federation | superseded-by: D-08 |
| D-07 | Foundation Profile targets family-scale pressure, not cloud-scale operation | accepted |
| D-08 | Group E2EE uses MLS (RFC 9420); Sender Keys removed | accepted (pending G0 verification) |
| D-09 | Direct chat E2EE uses X3DH + Double Ratchet, per-device sessions | accepted |
| D-10 | One Station signaling-envelope channel with typed QoS; no per-domain queues | accepted |
| D-11 | Hard cutover with no compatibility bridge; legacy chat data wiped | accepted |
| D-12 | Text always flows through the Station envelope; P2P only for audio/video and large files | accepted |
| D-13 | Authority commits membership and MLS transition as one transactional fact | accepted |

> **Approval**: D-08/09/10/11/12 approved by user on 2026-07-11 (worktree `peers-group-chat`).
> Proposal source: [`proposals/20260711-im-unification-review.md`](proposals/20260711-im-unification-review.md).

---

## D-01: Use A Separate Group Event Log Instead Of Federation Ledger For Chat Facts

**Status**: accepted
**Date**: 2026-07-04

### Context

Federation architecture already states that social data does not enter Federation Ledger. Group IM needs durable ordering and lifecycle truth, but messages, mutations, SKDM routing, read receipts, and typing are high-frequency business data.

### Decision

Federated IM uses a Group Event Log owned by the group authority Station. Federation Ledger remains limited to governance facts such as Station membership, policy, sequencer, suspend/remove, and recovery authorization.

### Rationale

This keeps the governance ledger small, auditable, and privacy-preserving while giving group chat its own recoverable event stream.

### Alternatives Considered

- Put all group events into Federation Ledger: simpler global audit, but high write volume, privacy leakage, and poor latency.
- Store only mutable database rows: fast locally, but cross-Station replay and fork detection are weak.

### Consequences

Federated IM needs its own event hash, sequence, follower replication, and resync logic. This is intentional and separate from Federation governance.

---

## D-02: Use Creator Home Station As Group Authority In The Foundation Profile

**Status**: accepted
**Date**: 2026-07-04

### Context

Every federated group needs a single writer for ordinary chat facts unless a full consensus profile is selected. The earliest natural owner is the creator's Home Station.

### Decision

For the Foundation Profile, `group_authority_station_peer_id` is the creator actor's Home Station at group creation time.

### Rationale

It avoids initial cross-Station negotiation, matches Home Station ownership of user-created social assets, and is deployable for family-scale Stations.

### Alternatives Considered

- Group owner Station follows current group owner: causes authority migration on owner transfer and complicates log handoff.
- Federation sequencer owns every group: centralizes chat load and mixes governance with social traffic.
- Quorum-chosen authority at creation: stronger neutrality, but slow and more complex for ordinary groups.

### Consequences

Ownership transfer does not move group authority. Future authority handover must be an explicit signed protocol.

---

## D-03: Remote Stations Submit Proposals, Authority Commits Events

**Status**: accepted
**Date**: 2026-07-04

### Context

Remote actors must be able to speak in a group, but allowing every Home Station to commit group facts directly creates multi-writer conflicts.

### Decision

Actor Home Stations submit signed `GroupProposal` messages. The group authority validates and commits accepted proposals into `GroupEvent`.

### Rationale

This gives remote users a natural path while preserving one committed group sequence and one authorization decision point.

### Alternatives Considered

- Remote Station directly commits its own event: low latency but creates conflicting heads.
- Client posts directly to group authority: bypasses Home Station signing, retry, and local policy.

### Consequences

Home Stations need proposal outboxes and idempotency keys. Authority Stations need proposal validation and rejection codes.

---

## D-04: Do Not Run Consensus For Every Ordinary Chat Message

**Status**: accepted
**Date**: 2026-07-04

### Context

Consensus can solve single-authority failure, but ordinary IM needs low latency and must tolerate weakly online family Stations.

### Decision

Ordinary group messages use authority sequencing. Consensus/quorum is reserved for governance, authority handover, and future high-value group profiles.

### Rationale

Family Station networks often have NAT traversal, relay dependency, and intermittent availability. Requiring quorum for every message would make chat slower and less available.

### Alternatives Considered

- Full consensus per message: stronger availability after authority failure, but high latency and operational complexity.
- No ordering authority: fast but inconsistent and hard to repair.

### Consequences

Authority Station is on the write path. When it is unavailable, followers cannot safely accept new committed messages.

---

## D-05: Authority Loss Degrades Groups To Read-Only Before Recovery Exists

**Status**: accepted
**Date**: 2026-07-04

### Context

If the group authority Station disappears, follower Stations may hold incomplete logs. Automatically electing a new authority without proof can fork group truth.

### Decision

Foundation Profile behavior is read-only degradation:

- temporary loss: `read_only_degraded`;
- permanent loss: `orphaned_read_only`;
- future recovery requires a signed handover/recovery protocol.

### Rationale

Read-only degradation preserves history and prevents split-brain. It is safer than pretending another Station can commit without a verified head.

### Alternatives Considered

- Automatic follower takeover: better write availability but unsafe without quorum and head proof.
- Delete the group: loses user history and violates IM expectations.

### Consequences

Some groups become temporarily unwritable during authority outage. The tradeoff is explicit and safer for the first deployable profile.

---

## D-06: Sender Keys Remain Device-Local Across Federation

**Status**: superseded-by D-08 (2026-07-11)
**Date**: 2026-07-04

> **Superseded**: The Station signaling envelope (D-10) now provides the opaque,
> retriable, device-targeted routing this decision was created to justify, so the
> "device-local Sender Keys" mechanism no longer earns its cost. Group E2EE moves
> to MLS under D-08. This entry is retained for history per the append-only
> knowledge rule; do not build new work on it.

### Context

Cross-Station delivery increases the number of routers, but E2EE must not grant any Station access to group plaintext or Sender Keys.

### Decision

SKDM is routed as an opaque encrypted control envelope. Devices create, encrypt, consume, and rotate Sender Keys. Stations store delivery metadata only.

### Rationale

This preserves Station-blind group content while still allowing offline routing and retry.

### Alternatives Considered

- Authority Station distributes group keys: easier delivery, breaks E2EE.
- Home Station escrow keys: easier multi-device, breaks trust model and creates a high-value target.

### Consequences

Key delivery needs its own retry, device targeting, and UI states for waiting key vs not entitled.

---

## D-07: Foundation Profile Targets Family-Scale Pressure, Not Cloud-Scale Operation

**Status**: accepted
**Date**: 2026-07-04

### Context

Peers-Touch Home Stations should feel industrial-grade for household and small community deployment, but are not managed data-center clusters.

### Decision

The required quality bar is:

- roughly 100-person group;
- 10 active senders;
- 1-2 devices per actor;
- multiple private chats;
- 3 member Stations in federated pressure tests;
- offline recovery and membership churn.

### Rationale

This matches the product positioning and prevents over-engineering cloud-scale primitives before family Station reliability is proven.

### Alternatives Considered

- Cloud-scale architecture first: high cost and slow iteration.
- Toy local-only testing: misses the real decentralized product risk.

### Consequences

Stress harness and metrics become first-class deliverables before larger federation profiles are considered.

---

## D-08: Group E2EE Uses MLS (RFC 9420); Sender Keys Removed

**Status**: accepted (pending G0 verification)
**Date**: 2026-07-11
**Supersedes**: D-06

### Context

Sender Keys were chosen when no general signaling-envelope channel existed, so SKDM piggybacked on the friend-chat control channel. That produced a dual-channel split-brain (friend-chat control type 50 *and* a Station SKDM envelope), O(n²) SKDM redistribution on every membership change, and a "wait for each sender to come online and rotate" window for post-removal forward secrecy. The two client copies of `sender_keys.rs` have already diverged.

### Decision

Group E2EE uses MLS (RFC 9420). Membership changes, cryptographic epochs, device membership, Welcome, and Commit are unified under MLS TreeKEM. The group authority Station only orders MLS Commits; it never holds group plaintext or MLS group secrets. Sender Keys, SKDM, and friend-chat control type 50 are removed entirely.

### Verification Gate (G0)

MLS is PROPOSED until a two-platform (Desktop + Mobile Rust) minimum prototype proves: group create / add device / add member / remove member / offline Commit / state recovery; 3-Station Commit ordering under duplicate/out-of-order/disconnect; multi-device; security negatives (forged Commit, stale epoch, removed member continued decryption); and 100-member / 200-device pressure. A specific MLS library and exact version require separate user approval before introduction.

### Rationale

MLS gives logarithmic re-key on membership change, unifies device and member state, and provides post-compromise security without the Sender Keys redistribution cost — while keeping Stations blind to content.

### Alternatives Considered

- Keep Sender Keys, only unify SKDM onto the envelope: smaller change, but retains O(n²) redistribution and the rotation-window weakness.
- Defer decision: leaves the split-brain in place.

### Consequences

MLS Commit ordering must be atomically bound to the authority's `membership_epoch` to avoid business-vs-crypto membership fork. Mobile needs durable MLS group-state storage beyond today's KV secure storage.

---

## D-09: Direct Chat E2EE Uses X3DH + Double Ratchet, Per-Device Sessions

**Status**: accepted
**Date**: 2026-07-11

### Context

`double_ratchet.rs` exists but self-documents as an M1 skeleton not wired into any send/recv path; direct chat has no live end-to-end ratchet.

### Decision

Direct chat uses X3DH for initial key agreement and Double Ratchet for message progression, with independent per-device sessions managed by an explicit multi-device session manager. All chain-only fallbacks are removed and the ratchet is wired into the real send/receive path.

### Rationale

This is the standard, well-audited pairwise E2EE construction and matches the existing crypto dependency stack.

### Consequences

A per-device session manager, device add/revoke/loss recovery, and safety-number / identity-change surfacing become required work.

---

## D-10: One Station Signaling-Envelope Channel With Typed QoS

**Status**: accepted
**Date**: 2026-07-11

### Context

Reliability mechanisms are fragmented: friend-chat in-process pending map, group offline dual-track, duplicate friend/group outboxes, a realtime durable store, and separate proposal/event/SKDM outboxes.

### Decision

All chat transport converges on one Station signaling-envelope protocol and routing framework carrying typed payloads with distinct persistence/QoS: committed message events (durable, ordered), key-agreement payloads, receipts, lightweight signals (typing, droppable), and call signaling (low-latency). "Unify" means one protocol + framework, not one undifferentiated table or queue. Per-domain private queues are deleted.

### Rationale

A single durable outbox/inbox/cursor with idempotency and ACK removes duplicated, drift-prone reliability code and gives one recovery story.

### Consequences

The envelope must express per-type QoS and durability; same-Station (local transport) and cross-Station (federation relay + JWT) are two adapters of one contract.

---

## D-11: Hard Cutover With No Compatibility Bridge; Legacy Chat Data Wiped

**Status**: accepted
**Date**: 2026-07-11

### Context

The project is at v1 development stage. Preserving old chat data or old protocol paths would require compatibility bridges that reintroduce the split-brain this refactor removes.

### Decision

The migration is an atomic cutover: introduce the new contracts, migrate every consumer, then delete old entrypoints, tables, protos, and crypto in the same change. Legacy chat data is wiped rather than migrated. No dual-write, feature flag, compatibility adapter, or `_legacy` path is retained. Rollback relies on Git / deployment rollback only.

### Rationale

At v1 the cost of a clean single-truth cutover is far lower than carrying a bridge forever; wiping dev-stage chat data avoids migration debt.

### Consequences

A tree-wide search for old symbols must return zero live references at G4. Users lose pre-cutover chat history by design (dev-stage decision).

---

## D-12: Text Always Flows Through The Station Envelope; P2P Only For Audio/Video And Large Files

**Status**: accepted
**Date**: 2026-07-11

### Context

Text delivery must be reliable, ordered, and offline-recoverable; WebRTC data channels are best-effort and connection-dependent.

### Decision

Text messages, receipts, and control always flow through the reliable Station envelope (D-10). P2P (WebRTC) is used only for real-time audio/video and, in the future, large-file direct transfer. Text is never carried over a P2P data channel.

### Rationale

This keeps the durability/ordering guarantees on the reliable path and confines best-effort transport to media where it fits.

### Consequences

Call signaling still rides the envelope; media SRTP/data paths are established peer-to-peer with the envelope as the signaling channel.

---

## D-13: Authority Commits Membership And MLS Transition As One Transactional Fact

**Status**: accepted
**Date**: 2026-08-02
**Approval**: User approved on 2026-08-02 with the product constraint to stay
focused on a modern Desktop/Mobile IM experience.

### Context

C-4 requires the group authority to bind MLS Commit ordering atomically to
`membership_epoch`. The current product cannot satisfy that property:

- `AddMembersCommand`, `RemoveMembersCommand`, and `LeaveCommand` carry no MLS
  epoch, Commit hash, or opaque Commit bytes.
- clients call `/mls/distribute` independently from the membership command;
- Station mutates member rows, bumps the epoch, appends the event, and enqueues
  delivery through separate persistence calls;
- the registered L3 acceptance gate points to a missing Make target.

This is a verified architecture gap, not merely missing test coverage. A crash
or rejection between the independent operations can leave business membership
and the device MLS tree at different epochs.

### Decision

Introduce one proto-first **membership transition** accepted only by the group
authority. It carries:

- a globally unique `transition_id`;
- the observed membership and MLS epochs;
- the requested member changes;
- the target MLS epoch;
- opaque MLS Commit bytes plus SHA-256;
- recipient-specific opaque Welcome deliveries plus hashes when adding members.

For the Foundation Profile, every accepted transition advances exactly one
step:

```text
to_membership_epoch = from_membership_epoch + 1
to_mls_epoch        = from_mls_epoch + 1
to_membership_epoch = to_mls_epoch
```

The authority locks the conversation head and commits the following in one
database transaction:

1. member-row mutations;
2. `membership_epoch` and `group_seq`;
3. one `MembershipTransitionCommitted` group event containing the opaque Commit
   and transition hashes;
4. transactional outbox rows for committed-event replication and recipient
   Commit/Welcome delivery.

Outbox transmission remains asynchronous. Transaction success means every
delivery fact is durable; transaction failure means none of the four facts is
visible.

Admission is bounded before the transaction: Commit bytes are at most 128 KiB,
Welcome payloads total at most 8 MiB, and one transition targets at most 200
device deliveries. Larger requests are rejected without partial state.

The client generates an OpenMLS pending Commit but MUST NOT merge it into its
durable local group state until the authority accepts the transition. Rejection
discards the pending Commit. The standalone client sequencing path
`/mls/distribute` is removed for Commit and Welcome after cutover; KeyPackage
directory operations remain separate because they do not mutate group truth.

Follower Stations apply the authority event in `group_seq` order. Projection
head, membership epoch, transition identity/hash, and local recipient inbox
rows are committed transactionally. Duplicate identical transitions are
no-ops; same identity/sequence with different hashes activates fork protection
and read-only state. A future sequence or epoch is buffered within a bounded
window and triggers authority resync.

### Rationale

This makes the authority event the only ordering fact shared by business
membership and cryptographic progression. A transactional outbox preserves
atomicity without making network delivery part of the database transaction,
and Stations remain blind to MLS secrets because Commit and Welcome bytes stay
opaque.

Station proves atomic association of declared epochs and exact opaque bytes; it
does not prove MLS semantic validity. Recipient OpenMLS verifies the actual
group and epoch transition. A semantic mismatch is fail-closed and moves the
group to crypto-desynced read-only state.

### Alternatives Considered

- **Keep `/mls/distribute` before membership mutation**: removed members can
  receive the Commit, but crashes can advance only the crypto side.
- **Keep `/mls/distribute` after membership mutation**: business membership can
  advance without a durable Commit, and removed members may be excluded before
  receiving their eviction Commit.
- **Store only a Commit hash in the event**: proves association but cannot
  recover missing Commit delivery after disconnect.
- **Let follower Stations sequence local membership**: violates the single
  authority and creates multi-writer forks.
- **Have Station parse or generate MLS**: breaks the device-local E2EE trust
  boundary and is rejected.

### Consequences

- Model contracts, Station repository boundaries, Desktop/Mobile crypto
  orchestration, federation replication, and acceptance tooling all change.
- Group creation with initial remote members must use the same transition
  semantics at epoch 1.
- Existing independent Commit/Welcome distribution entrypoints are deleted in
  the same cutover; no compatibility bridge or dual-write is allowed.
- Authorized malicious devices can still submit an MLS Commit that other
  devices reject. Recipient OpenMLS rejection moves the group to crypto-desynced
  read-only state and requires resync; Station cannot validate MLS semantics
  without violating E2EE.
- D-13 is binding for downstream planning. C-4/C-5 remain `UNPROVEN` until
  three distinct Station processes pass the L3 matrix.

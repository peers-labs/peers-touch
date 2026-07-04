# Federated IM Architecture — Decisions

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-04 | **Updated**: 2026-07-04
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
| D-06 | Sender Keys remain device-local across federation | accepted |
| D-07 | Foundation Profile targets family-scale pressure, not cloud-scale operation | accepted |

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

**Status**: accepted
**Date**: 2026-07-04

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


# Federated IM Architecture — Decisions

> **Status**: draft
> **Version**: v0.5
> **Created**: 2026-07-04 | **Updated**: 2026-08-03
> **Owner**: Architecture Team

---

## Decision Index

| ID | Decision | Status |
| --- | --- | --- |
| D-01 | Use a separate Group Event Log instead of Federation Ledger for chat facts | accepted |
| D-02 | Use creator Home Station as group authority in the Foundation Profile | accepted |
| D-03 | Remote Stations submit proposals, authority commits events | accepted; contract superseded-by D-17 |
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
| D-14 | Remote membership transitions use a conversation-owned signed proposal and verified actor-key projection | accepted; wrapper superseded-by D-17 |
| D-15 | MLS leaves use a versioned actor-device credential | accepted |
| D-16 | Actor leave uses a signed intent and non-target MLS committer | accepted |
| D-17 | Remote actors submit one signed ConversationCommand proposal | accepted |

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

**Status**: accepted (concrete wire contract superseded by D-17)
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

---

## D-14: Remote Membership Transitions Use A Conversation-Owned Signed Proposal And Verified Actor-Key Projection

**Status**: accepted (wire wrapper superseded by D-17; validation retained)
**Date**: 2026-08-02
**Approval**: User approved the recommended architecture amendment on
2026-08-02 after D13-C2 implementation exposed the missing trust contract.

### Context

D-13 defines the atomic membership/MLS transition but does not define how a
remote member's Home Station submits that transition to the group authority.
The remaining legacy `GroupProposal` returns the retired `GroupEvent` truth
model, has no atomic MLS transition command, and historically checked only that
an actor signature was present.

The shared Actor proto declares `signing_public_key`, but the current
`touch_actor` persistence model does not retain that field. Conversation
membership also has no verified signing-key reference. An authority therefore
cannot verify an actor signature without trusting a key supplied by the same
proposal.

### Decision

Model owns a new conversation-scoped `MembershipTransitionProposal` and
`MembershipTransitionProposalResult` contract:

- the proposal wraps the canonical `ConversationCommand`; it does not define a
  second membership command or event type;
- a deterministic signing input binds proposal, Federation, authority,
  conversation, transition, actor, device, command SHA-256, and creation time;
- the client device signs that input with the actor/device Ed25519 identity;
- the Home Station authenticates the client and forwards the proposal with a
  short-lived Station federation token whose claims bind the same identifiers
  and command hash;
- the authority resolves the actor signing key from the verified actor identity
  projection, verifies the actor signature and Home Station token, verifies
  active Federation membership, then submits the embedded command to the same
  D-13 authority service used by local commands;
- the result carries the canonical `CommittedConversationEvent` or a typed
  rejection with required heads. It never returns legacy `GroupEvent`.

The verified actor-device-key projection is owned by the Actor
identity/resolver layer and keyed by actor, device, and signing key id. It is
populated only by authenticated local device registration or a verified remote
Actor profile/locator envelope. Conversation may read it through a narrow
resolver interface but must not persist a second key copy or trust proposal key
bytes.

### Rationale

This preserves one command, one authority service, and one committed event
truth while satisfying both signatures required by the Federation trust
boundary. Binding the actor key through the identity projection prevents a
proposal from choosing the key that verifies its own forgery.

### Alternatives Considered

- **Use only the Station federation token**: rejected because it removes the
  accepted actor-signature requirement and lets a compromised Home Station
  impersonate an actor.
- **Reuse legacy `GroupProposal` and `GroupEvent`**: rejected because it revives
  a parallel event truth and cannot return D-13 acceptance evidence.
- **Embed the actor public key in each proposal**: rejected because a
  self-supplied key is not an identity trust anchor.
- **Store actor signing keys in conversation membership**: rejected because
  identity key rotation and verification belong to Actor identity, not chat.

### Consequences

- Conversation and Actor identity contracts gain a signed-proposal integration
  boundary before D13-C2 can complete.
- Desktop must sign the proposal input without merging its pending OpenMLS
  Commit.
- Home and authority Stations must bind and verify the same deterministic
  command hash and Federation claims.
- Missing, expired, rotated-without-proof, or mismatched actor keys fail closed
  before the D-13 transaction.
- The legacy `GroupProposal`/`GroupEvent` acceptance path remains deleted and
  cannot serve as a compatibility bridge.

---

## D-15: MLS Leaves Use A Versioned Actor-Device Credential

**Status**: accepted
**Date**: 2026-08-02

### Context

D13-C4 implementation verified that the current Desktop OpenMLS
`BasicCredential.identity` contains only PTID bytes. This is sufficient to find
an actor in a single-device group, but it cannot identify one device leaf when
the same actor has multiple devices. `ADD_DEVICE`, `REMOVE_DEVICE`, actor
`LEAVE`, and full member removal therefore have no safe leaf-selection rule.
Removing the first leaf whose credential equals PTID can remove the wrong
device and violates D-08's device-membership requirement.

### Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
| --- | --- | --- | --- | --- |
| current BasicCredential identity is PTID-only | verified_fact | `apps/desktop/src-tauri/src/domain/mls_group.rs` calls `create_credential(ptid.as_bytes())` | high | none |
| exact `REMOVE_DEVICE` cannot select a unique leaf | verified_fact | leaf lookup currently compares credential bytes only with PTID | high | none |
| deterministic protobuf actor-device identity solves cross-platform leaf mapping | accepted_design | fixed-tag scalar/string fields have stable deterministic protobuf bytes in generated Rust runtimes | high | Desktop/Mobile interoperability and multi-device tests remain implementation gates |
| Station can remain opaque | inference | routing metadata already carries PTID/device ID while Commit/KeyPackage bytes remain opaque | high | L3 three-Station evidence |

### Decision

Define a shared proto `MlsDeviceCredential` with:

```text
version = 1
ptid
device_id
```

Its deterministic protobuf bytes are the only allowed
`BasicCredential.identity` for new MLS KeyPackages and leaves.

- KeyPackage publication and fetch metadata MUST match the credential's PTID
  and device ID before a client prepares an add transition.
- `ADD` adds the actor's named initial device leaf.
- `ADD_DEVICE` adds exactly the named device leaf.
- `REMOVE_DEVICE` removes exactly one `(ptid, device_id)` leaf.
- `REMOVE` and `LEAVE` remove every active leaf for the target PTID in one MLS
  Commit.
- Recipient OpenMLS processing verifies that the committed leaf changes match
  the authority transition descriptors.
- PTID-only or malformed credentials fail closed. D-11 forbids a compatibility
  parser or fallback leaf lookup.

Station continues to treat KeyPackage and Commit bytes as opaque. Device
credential validation remains device-local; Station validates only actor/device
routing metadata, transition authorization, hashes, and epochs.

### Rationale

The MLS tree is device-scoped while Station membership is actor-scoped. A
versioned actor-device identity is the minimum stable mapping that lets clients
prove both views describe the same transition without exposing MLS secrets to
Station.

### Alternatives Considered

- **Keep PTID-only credentials and remove the first matching leaf**: rejected
  because leaf selection is nondeterministic for multi-device actors.
- **Encode `ptid#device_id` as an ad hoc string**: rejected because parsing and
  escaping are not a versioned shared contract.
- **Let Station map device IDs to MLS leaf indices**: rejected because Station
  cannot parse or own the device-local MLS tree.
- **Use one MLS leaf per actor and synchronize secrets across devices**:
  rejected because it creates device secret escrow and violates D-08.

### Consequences

- Model, Desktop, and later Mobile gain the same generated credential type.
- Existing development KeyPackages and MLS groups become invalid and are
  ignored or reset operationally; application migration code is forbidden.
- MLS identity signer and credential state must be actor-scoped and durable.
- D13-C4 leave/device implementation is authorized by this decision and must
  complete the acceptance gate below.

### Acceptance Gate

- Model generation produces the identical credential contract for Go,
  Desktop Rust/TypeScript, and Mobile.
- Two devices for one actor create distinct leaves and can both send after
  restart.
- `REMOVE_DEVICE` removes only the named device; the sibling device continues.
- actor `REMOVE` / `LEAVE` removes every actor leaf.
- KeyPackage PTID/device mismatch, unknown version, duplicate leaf identity,
  and PTID-only credentials fail closed.
- Station DB/log scans contain no MLS private state and Station never parses
  the credential from KeyPackage or Commit bytes.
- Three-Station C6 evidence includes multi-device add/remove and public tree
  convergence.

### Review Result

Accepted after confirming that this message contains only fixed-tag scalar and
string fields, with no maps or unknown-field dependence, so deterministic
protobuf bytes are stable OpenMLS BasicCredential input across generated Rust
runtimes. Revisit only if the selected OpenMLS credential type gains a native
structured device-identity extension that preserves the same Station-opaque
boundary.

---

## D-16: Actor Leave Uses A Signed Intent And Non-Target MLS Committer

**Status**: accepted
**Date**: 2026-08-02

### Context

D-15 implementation proved that OpenMLS rejects a Commit that removes the
committer's own leaf with `CreateCommitError(CannotRemoveSelf)`. Because actor
`LEAVE` removes every leaf for the departing PTID, no departing device can
author the required Commit. Accepting an opaque self-removal Commit at Station
would advance business membership while conforming recipients reject MLS.

### Decision

`LEAVE` is a two-party authorization flow with one final D-13 transaction:

1. a departing actor device signs a versioned leave intent bound to the
   Federation, authority, conversation, actor, device, and observed membership
   and MLS heads;
2. the authority verifies and durably records the intent, then routes it to
   active non-target member devices;
3. one non-target device prepares an OpenMLS Commit that removes every leaf
   whose D-15 credential PTID matches the departing actor;
4. that committer submits the canonical `MembershipTransitionCommand` with the
   leave-intent proof;
5. the authority verifies the committer's active leaf and the unconsumed,
   exact-head leave intent, then atomically consumes the intent in the same
   D-13 transaction that commits membership, epochs, event, and outbox rows.

Any active non-target member device may perform the cryptographic commit
because the signed leave intent supplies authorization. Concurrent committers
race on one authority head; exactly one succeeds and stale attempts discard
pending OpenMLS state. Station stores and verifies metadata and signatures only
and never parses or generates MLS material.

An owner must transfer ownership before leaving. A sole remaining owner
dissolves the group rather than using `LEAVE`. If no non-target device is
online, the intent remains pending and the actor remains a member until a
conforming Commit is accepted.

### Consequences

- `MembershipTransitionCommand` gains a leave-intent proof reference.
- Leave intent creation, delivery, claim, expiry, and atomic consumption are
  conversation-owned contracts.
- The frontend shows leave as pending until the authority commits the D-13
  transition; it never optimistically removes the actor.
- Direct client self-removal Commit generation is forbidden and covered by a
  regression test.

### Acceptance Gate

- a member cannot submit a bare `LEAVE` transition;
- a valid target-signed intent can be committed by a different active leaf;
- wrong actor/device/head, expired, replayed, or mismatched intents fail before
  any authority write;
- one accepted transition removes every target PTID leaf while preserving
  non-target leaves;
- crash/retry and concurrent-committer tests prove one atomic intent
  consumption and one committed authority event;
- Desktop App/Web runtime proves request, delegated Commit, restart, and
  post-leave forward secrecy.

---

## D-17: Remote Actors Submit One Signed Conversation Command Proposal

**Status**: accepted
**Date**: 2026-08-03
**Approval**: User explicitly accepted D-17 on 2026-08-03.

### Context

D-03 requires remote Home Stations to submit signed proposals and forbids
remote mutation of authority truth. Its historical `GroupProposal` contract
returns the retired `GroupEvent` model and cannot represent the canonical
`ConversationCommand` / `CommittedConversationEvent` path.

D-14 later added a secure actor-device-signed proposal, but scoped its contract
and implementation to membership transitions. C6 runtime evidence proves that
remote membership/device/leave commands now converge, while an ordinary remote
`SEND_MESSAGE` still has no canonical authority path. Reusing local authority
submission or the retired proposal would bypass the accepted Home Station trust
boundary.

### Decision

Hard-cut D-14's remote wrapper to one conversation-owned
`ConversationCommandProposal` and `ConversationCommandProposalResult`:

- the proposal wraps one deterministic canonical `ConversationCommand`;
- `command_id` is the sole proposal/idempotency identity and is required for
  every authority-committed command;
- the device signature binds Federation, authority, conversation, command ID,
  actor, device, signing key ID, command kind, command SHA-256, authority epoch,
  Home Station, creation time, and immutable expiry;
- the authenticated Home Station validates the exact actor/device and durable
  follower head, then mints a scoped peer token with the same bindings;
- the authority verifies active Federation membership, pinned Home Station
  identity, the verified actor-device key projection, signature, command hash,
  field bindings, current authority head, and command-specific authorization;
- every accepted proposal enters the same authority `SubmitCommand` service
  used by a local actor and returns one canonical
  `CommittedConversationEvent`;
- the authority resolves `(conversation_id, command_id, command_sha256)` before
  sequence allocation: an exact retry returns the original result and hash
  conflict rejects before mutation;
- command receipt, canonical event, command effects, and deterministic fan-out
  outbox rows commit in one authority transaction for every durable command;
- membership transitions retain D-13 exact epoch/hash/Commit rules and merge a
  pending OpenMLS Commit only after exact authority acceptance;
- ordinary messages carry only opaque MLS ciphertext in the canonical command.
- ephemeral typing remains on the signaling plane and is rejected by the
  proposal verifier; receipts retain their dedicated typed contract.

The Home Station durably queues accepted device-signed proposals and may remint
an expired peer token without changing signed command bytes. Queues, payloads,
attachment metadata, retry retention, and retry backoff are bounded Station
policy with typed `RATE_LIMITED` / `PAYLOAD_TOO_LARGE` outcomes. It stops retry
at the device-signed expiry; the authority returns `COMMAND_EXPIRED` without
mutation after that boundary.

The initial client request may return `HOME_ACCEPTED` before authority commit.
Authority acceptance or terminal rejection is persisted with an addressed
originating-device inbox notification; reconnect also supports result lookup by
`(conversation_id, command_id)`. The original HTTP response is not a delivery
guarantee.

The membership-specific proposal types, routes, forwarder, and Desktop command
are deleted in the same hard cut. No compatibility bridge or second remote
message proposal remains.

### Rationale

The command and committed event are already the canonical local authority
contracts. A generic remote authentication wrapper preserves that truth while
removing two protocol forks: the retired `GroupProposal` and the
membership-only D-14 wrapper. Exact command-ID/hash replay is required because
Home/authority response loss otherwise allocates duplicate group sequences and
fan-out.

Atomic event/outbox persistence is required because signing and idempotency
alone do not prevent a crash after event commit but before remote fan-out.

Keeping typing out of this wrapper preserves the governance/chat/signaling
separation: ephemeral presence-like signals do not belong in the durable group
event log.

### Alternatives Considered

- **Add a message-only signed proposal beside D-14**: smaller initial diff, but
  duplicates token claims, actor-key verification, retry, rejection, and
  idempotency semantics. Rejected as a second trust protocol.
- **Allow remote clients to call the authority directly**: avoids Home Station
  forwarding, but bypasses Home Station authentication, policy, retry, and
  Federation trust boundaries. Rejected.
- **Reuse historical `GroupProposal`**: preserves existing names, but returns
  retired truth, lacks canonical command semantics, and cannot satisfy D-13.
  Rejected.
- **Let the Home Station sign for the actor**: simplifies devices, but turns
  Station compromise into actor impersonation and violates D-14. Rejected.
- **Commit typing as ordinary events**: creates high-frequency durable noise
  and violates D-10 signaling ownership. Rejected.

### Consequences

- local and remote actors share one command/event truth and one proposal trust
  protocol;
- remote ordinary send can satisfy C6 without direct client-to-authority
  mutation;
- D-14 remains the membership validation specialization inside the generic
  wrapper rather than a parallel wire protocol;
- model, Station, Desktop App, and Desktop Web change atomically before C6 can
  claim completion.
- authority Conversation gains a command receipt/idempotency journal and
  command-specific admission classification;
- Home Stations gain durable proposal retry pressure and must expose bounded
  overload rather than silently dropping or growing without limit;
- a larger hard-cut diff is accepted to leave one protocol and no compatibility
  bridge.

Negative consequences:

- all D-14 generated types and callers change at once;
- queued membership-only proposals from development snapshots are invalid and
  are ignored or removed operationally, never migrated by application code;
- exact command retry requires additional authority persistence and storage
  lifecycle policy;
- ordinary command handling moves onto the same unit-of-work discipline as
  D-13, increasing the authority transaction surface;
- clients cannot cancel a command after Home Station durable acceptance;
  retraction or another explicit compensating command is required.

### Acceptance Gate

- deterministic proto generation produces the same generic proposal contract
  for Station, Desktop App/Web, and Mobile-generated models;
- local and remote forms of each supported command kind reach the same
  authority service and canonical event semantics;
- exact retry after dropped response yields one event, one sequence, and one
  logical fan-out; command-ID/hash reuse rejects before mutation;
- lost initial response and Home restart recover the same durable result through
  device inbox/query without a new command ID;
- injected failure at every receipt/event/outbox write boundary leaves no
  partial command result;
- wrong Station/Federation/actor/device/key/kind/hash/epoch bindings and
  inactive/revoked identities fail closed;
- queue and payload admission are bounded and tested;
- multi-window signing shares one durable actor-device identity while producing
  distinct command IDs, and window close does not cancel Home-durable work;
- per-conversation FIFO and bounded fairness across conversations are proven
  under overload;
- remote MLS ciphertext send reaches three Stations and decrypts only on
  entitled current leaves;
- typing-through-proposal and direct remote client-to-authority submission are
  rejected;
- searches find zero live `MembershipTransitionProposal`, active
  `GroupProposal`, membership-only proposal route, or membership-only Desktop
  command after cutover.

### Reversal Trigger

Revisit only if a future protocol removes the Home Station trust boundary or
authority-owned `ConversationCommand` / `CommittedConversationEvent` truth.
Performance pressure alone is not a reversal trigger; it must first be measured
against the bounded outbox and authority admission gates.

### Acceptance Record

D-17 supersedes D-03's concrete `GroupProposal` / `GroupEvent`
contract wording while retaining its single-writer invariant, and supersedes
D-14's membership-only wire wrapper while retaining its actor-device and Home
Station validation rules.

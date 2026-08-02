# Federated IM Architecture — D-13 Integration

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-08-02 | **Updated**: 2026-08-02
> **Owner**: Architecture Team
> **Module**: `model/domain/chat/`, `apps/station/app/subserver/conversation/`, `apps/station/app/subserver/envelope/`, `apps/desktop/src-tauri/`, `apps/desktop/src/`

---

## 1. Document Scope

This document defines:

- the verified current-state gaps that block C-4/C-5;
- how accepted D-13 maps across Model, authority Station, follower Station,
  envelope transport, and client crypto runtimes;
- the old relationships that the target architecture deletes;
- the architecture evidence required before C-4/C-5 can be accepted.

This document does not define:

- implementation phases or dependency order;
- Mobile UI behavior;
- Federation governance ledger semantics;
- authority handover or multi-writer recovery.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing Proof |
| --- | --- | --- | --- | --- |
| Membership and MLS Commit are independent requests | `verified_fact` | `ConversationCommand` has member changes only; `/mls/distribute` is a separate endpoint | high | none |
| Authority membership mutation is not one DB transaction | `verified_fact` | `processCommand` calls `NextSeq`, member upserts, `BumpMembershipEpoch`, `AppendEvent`, then envelope submission separately | high | none |
| Current L3 registered gate is not executable | `verified_fact` | `federation-three-node-e2e` invokes missing target `testnet-p5-federation-e2e` | high | replacement gate |
| Current code can fork business and crypto epochs on crash/rejection | `inference` | independent durable operations have observable intermediate states | high | deterministic crash-injection test |
| Authority transactional transition removes the fork window | `proposal` | D-13 transaction + outbox contract | pending review | L2 failure injection + L3 evidence |
| Three Station followers converge under duplicate/reorder/reconnect | `hypothesis` | L2 envelope tests pass only on one Station | low until L3 | C-5 L3 matrix |

## 3. Current-To-Target Mapping

| Layer | Current Relationship | D-13 Target |
| --- | --- | --- |
| Model | `AddMembersCommand`, `RemoveMembersCommand`, `LeaveCommand` omit MLS transition data | one typed membership transition carries changes, epochs, Commit, hashes, and Welcome targets |
| Desktop/Mobile crypto | OpenMLS Commit is merged before/independently of Station membership acceptance | Commit remains pending until authority acceptance; rejection discards it |
| Desktop gateway | client invokes `/mls/distribute` independently | client submits one transition command; no public Commit/Welcome sequencing endpoint |
| Authority service | member rows, epoch, event, and delivery are separate writes | one locked transaction commits truth and transactional outbox |
| Group event log | membership event records business changes only | transition event also anchors MLS epochs, Commit bytes/hash, and Welcome descriptors |
| Envelope | random Commit delivery idempotency key; current membership snapshot chooses recipients | outbox derives deterministic delivery identities from accepted transition and pre/post snapshots |
| Follower Station | no transactionally defined projection/inbox apply boundary | projection head, membership epoch, and local inbox rows commit together |
| Client receive | Welcome/Commit processing depends on arrival path | authority sequence drives bounded reorder, deduplication, gap resync, and fail-closed state |
| Acceptance | stale Sender Keys browser gates and missing federation Make target | MLS-native C-4/C-5 three-Station harness and reports |

## 4. Ownership And Trust Boundaries

| Capability | Owner | May Read | May Mutate | Must Not Do |
| --- | --- | --- | --- | --- |
| Membership transition order | authority Station | signed command metadata, opaque hashes/bytes | group truth, event log, outbox | parse MLS secrets or accept follower ordering |
| MLS Commit generation | authorized client device | local OpenMLS state, authority projection | pending local Commit | merge before authority acceptance |
| Follower projection | recipient Home Station | signed authority events | local replicated projection and inbox | allocate epoch/sequence or rewrite event |
| MLS state application | recipient client device | opaque Commit/Welcome, local MLS state | device-local MLS state | infer business membership without authority event |
| Federation transport | envelope/relay adapters | signed opaque envelope | delivery status/cursors | become chat truth or decrypt payload |

## 5. Authority Integration Boundary

The conversation repository must expose a transaction-scoped transition
operation rather than independent mutation methods:

```text
CommitMembershipTransition(
  authenticated_subject,
  validated_transition,
  pre_transition_members
) -> committed_event
```

The operation owns:

- row lock and current-head validation;
- sequence allocation;
- member mutations and membership epoch;
- event serialization/hash;
- deterministic replication and key-delivery outbox rows.

`EnvelopeSubmitter` cannot be called after the transaction as the source of
durability for this path. It may wake asynchronous workers after commit, but the
outbox rows already exist.

## 6. Follower Integration Boundary

Follower apply consumes a signed authority event and produces one local
transaction:

```text
ApplyAuthorityTransition(
  current_follower_head,
  committed_transition
) -> updated_projection + local_inbox_rows + updated_head
```

Outcomes:

| Condition | Outcome |
| --- | --- |
| exact next sequence and epochs | apply transaction |
| exact duplicate transition/hash | no-op + ACK |
| future sequence within buffer | buffer + resync |
| buffer overflow | read-only + snapshot required |
| same identity/sequence, different hash | fork-protected read-only |
| invalid authority signature or inactive Station | reject |

## 7. Client Integration Boundary

The crypto runtime exposes an explicit pending-transition lifecycle:

```text
prepare transition -> submit -> authority accepted -> merge pending Commit
                                  |
                                  +-> rejected -> discard pending Commit
```

Receive lifecycle:

```text
authority event arrives
  -> verify transition identity/hash/sequence/epochs
  -> apply OpenMLS Commit or Welcome
  -> persist MLS state and durable applied-transition marker
  -> release post-transition sends
```

The frontend renders `establishing` or read-only crypto-desynced state from the
runtime. It does not optimistically mutate membership truth.

## 8. Target Deletions

The D-13 cutover deletes, rather than aliases:

- client sequencing of Commit/Welcome through `/mls/distribute`;
- random UUID-based MLS delivery idempotency keys;
- separate `BumpMembershipEpoch` and member-upsert calls as the transition
  persistence contract;
- post-commit envelope submission as the only durability mechanism;
- Sender Keys acceptance gates and reports that claim current MLS coverage.

KeyPackage upload/fetch remains. Generic envelope infrastructure remains.

## 9. Failure Semantics

| Failure | Required Behavior |
| --- | --- |
| authority validation rejection | no business or MLS durable state changes; client discards pending Commit |
| DB failure before commit | no transition/event/outbox visibility |
| process crash after DB commit | outbox worker resumes deterministic delivery |
| duplicate proposal | same committed result, no duplicate event/outbox |
| reordered follower events | bounded buffer, authority resync, no post-gap writes |
| recipient offline | durable inbox resume in authority order |
| OpenMLS Commit rejection | crypto-desynced read-only; no silent membership continuation |
| forged authority/event hash | reject and activate fork protection |
| authority unavailable | follower remains read-only per D-05 |

## 10. Architecture Gates

C-4 requires:

- transaction failure injection at every write boundary with zero partial state;
- accepted event satisfies
  `to_membership_epoch == to_mls_epoch == from_membership_epoch + 1`;
- stale/mismatched epochs and Commit hashes are rejected;
- three Station authority/follower heads show the same sequence, event hash,
  membership epoch, MLS epoch, transition id, and Commit hash.

C-5 requires:

- duplicate transition proposals produce one event and one logical delivery per
  recipient;
- reordered event/Commit delivery converges after resync;
- partial ACK plus process restart resumes from the last durable apply point;
- same sequence with a different hash activates fork protection;
- all three Station heads and all recipient devices' public MLS group
  context/tree hashes converge after reconnect.

Evidence is a machine-readable report containing topology peer IDs, deployed
commit, transition identities, injected fault schedule, per-Station heads,
per-client public MLS group context/tree hashes, rejection results, and
plaintext/key leakage scan.

## 11. Review Status

D-13 is `accepted`. Execution planning must replace the missing/stale L3 gates
with dependency-ordered tasks and deletion gates before implementation begins.

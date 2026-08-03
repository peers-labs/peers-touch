# Federated IM Architecture — D-17 Integration

> **Status**: active
> **Version**: v0.3
> **Created**: 2026-08-02 | **Updated**: 2026-08-03
> **Owner**: Architecture Team
> **Module**: `model/domain/chat/`, `apps/station/app/subserver/conversation/`, `apps/station/app/subserver/envelope/`, `apps/desktop/src-tauri/`, `apps/desktop/src/`

---

## 1. Document Scope

This document defines:

- the verified D-13 through D-16 current state across Model, authority Station,
  follower Station, envelope transport, and client crypto runtimes;
- the verified remote ordinary-command gap and accepted D-17 generic signed
  command boundary;
- the old relationships that the target architecture deletes;
- the architecture evidence required before D-17 and C6 remote send can be
  accepted.

This document does not define:

- implementation phases or dependency order;
- Mobile UI behavior;
- Federation governance ledger semantics;
- authority handover or multi-writer recovery.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing Proof |
| --- | --- | --- | --- | --- |
| Membership and MLS transition are one authority transaction | `verified_fact` | D-13 transition unit of work plus C5 write-boundary report | high | none |
| Pending OpenMLS Commit merges only after exact authority acceptance | `verified_fact` | Desktop MLS pending-state runtime/tests and C6 transition evidence | high | none |
| Follower projection and recipient inbox apply atomically in authority order | `verified_fact` | durable follower head/applied ledger/reorder tests and three-Station C6 convergence | high | remaining L3 restart/fault schedule |
| C6 topology and remote membership/device/leave gate are executable | `verified_fact` | `make testnet-p5-federation-e2e` and `make chat-mls-three-station-convergence` reports | high | remote ordinary send + remaining L3 faults |
| Legacy remote proposal could not satisfy D-13 | `verified_fact` | Historical `GroupProposal` returned retired `GroupEvent` and had no atomic transition command; D-17 deletion search now finds no live contract or handler | high | none |
| Actor-device signing trust is identity-owned and persisted outside Conversation | `verified_fact` | `ActorDeviceIdentity`, Actor `DeviceStore`, signed profile publication, verified remote hydration, and signer continuity tests | high | none |
| D-17 generic proposal reaches the canonical authority service in focused App/Web and Station tests | `verified_fact` | generic Station verifier/Home queue/result tests, Desktop service tests, Rust compile and MLS regression suites | high | three-Station remote ordinary runtime |
| Three Station clients converge for remote membership/device/leave | `verified_fact` | C6 report records equal public OpenMLS context/tree/credential hashes at epoch 5 and removed-device/departed-actor decrypt denial | high | remaining L3 fault schedule |
| Remote ordinary command has one canonical D-17 authority path | `verified_fact` | generic Rust signer, Home durable queue/forwarder, authority verifier, and shared `SubmitCommand` service | high | W7/W8 runtime evidence |
| Generic authority `SubmitCommand` has exact `command_id` replay persistence | `verified_fact` | W1 command receipt and conflict tests resolve `(conversation_id, command_id, command_sha256)` before sequence allocation | high | W7 fault report |
| Ordinary event fan-out is atomic with authority commit | `verified_fact` | W1 ordinary write-boundary matrix covers receipt, event, effects, and deterministic inbox/outbox | high | W7 consolidated report |
| Typing is not a durable authority command | `verified_fact` | `ConversationCommand` declares `typing`, but authority `processCommand` has no committed typing event; D-10 owns ephemeral signaling | high | explicit D-17 exclusion |
| One generic signed command proposal removes duplicate trust protocols | `verified_fact` | generated Model/Go/Desktop/Mobile contracts plus zero-reference deletion gate | high | W7/W8 evidence |

## 3. Current-To-Target Mapping

| Layer | Current D-17 Implementation | Remaining Proof |
| --- | --- | --- |
| Model | one generic proposal/result/reject/submission/result-delivery contract; old proposal contracts deleted | W7 deterministic contract misuse matrix |
| Remote proposal | one signed wrapper covers every durable authority command | W8 real remote ordinary send |
| Actor identity | one shared actor-device signer and verified public-key projection | multi-process W7 runtime evidence |
| Desktop crypto | pending Commit lifecycle and strict OpenMLS message encryption retained | W8 restart/decrypt evidence |
| Desktop gateway | native and Web use one authority-aware generic Rust signing command | W8 native/Web runtime evidence |
| Authority service | one locked command transaction commits receipt, event, effects, and deterministic outbox | W7 every-boundary report |
| Group event log | canonical hash-chained events with command receipt linkage | W7 replay/conflict report |
| Envelope | deterministic event/MLS/result delivery; no proposal truth ownership | W7 leakage and result-recovery report |
| Follower Station | durable authority-derived route/head/member/device projection | W8 restart/convergence evidence |
| Client receive | authority result event consumption plus periodic result query reconciliation | W8 disconnect/reconnect evidence |
| Acceptance | C5 PASS; W3-W6 focused gates PASS; C6 remains partial | W7 report and W8 C6 PASS |
| Command retry | Home durable retry and authority exact command-ID/hash replay | W7 response-loss/token-remint/fairness evidence |

## 4. Ownership And Trust Boundaries

| Capability | Owner | May Read | May Mutate | Must Not Do |
| --- | --- | --- | --- | --- |
| Membership transition order | authority Station | signed command metadata, opaque hashes/bytes | group truth, event log, outbox | parse MLS secrets or accept follower ordering |
| MLS Commit generation | authorized client device | local OpenMLS state, authority projection | pending local Commit | merge before authority acceptance |
| Follower projection | recipient Home Station | signed authority events | local replicated projection and inbox | allocate epoch/sequence or rewrite event |
| MLS state application | recipient client device | opaque Commit/Welcome, local MLS state | device-local MLS state | infer business membership without authority event |
| Federation transport | envelope/relay adapters | signed opaque envelope | delivery status/cursors | become chat truth or decrypt payload |
| Remote proposal authentication | Conversation + Actor identity + Federation governance | Station token, verified actor key, deterministic command hash | proposal acceptance only through authority service | trust proposal key bytes or create actor signatures |
| Command idempotency journal | authority Conversation service | command ID/hash and canonical result | exact accepted-result receipt | allocate another sequence for an exact retry |

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

Accepted D-17 remote submission enters the same authority service only after
generic verification:

```text
VerifyConversationCommandProposal(
  verified_station_claims,
  actor_key_projection,
  signed_proposal
) -> canonical ConversationCommand
```

This verifier owns no business mutation. It checks Station/Federation
membership, actor identity, signature, command kind/hash, authority epoch, and
field binding. It resolves `(conversation_id, command_id)` before mutation,
then passes a new command to the same `SubmitCommand` authority service used by
local actors. D-13 remains the membership specialization inside that service.

The generic authority unit of work is:

```text
CommitConversationCommand(
  authenticated_subject,
  verified_command_id_and_hash,
  command_specific_validation
) -> command_receipt + committed_event + deterministic_outbox
```

Command receipt lookup/conflict happens under the same conversation-head lock
before `group_seq` allocation. Event append and all replication/delivery outbox
rows are committed with the receipt. `EnvelopeSubmitter` may notify workers
after commit but is never the durability source.

The Home Station owns a durable proposal outbox, not a truth log:

```text
accept authenticated device proposal
  -> persist signed command + route + retry metadata
  -> mint or remint <=60s peer token
  -> submit to authority
  -> store accepted or terminal rejected result
  -> stop retry at immutable device-signed command expiry
  -> expose result to originating device
```

Queue size, payload size, retry retention, and retry backoff are bounded Station
policy. Saturation is visible as typed `RATE_LIMITED`, never silent drop or
unbounded growth.

Authority result recovery does not depend on the original request:

```text
authority result
  -> Home Station transaction stores durable result
  -> same transaction inserts originating-device inbox row
  -> device receives signaling notification or resumes inbox
  -> device may query by conversation_id + command_id at any time
```

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

### Accepted D-15 Device Leaf Boundary

Current Desktop OpenMLS credentials contain PTID only and therefore cannot
implement exact `ADD_DEVICE` / `REMOVE_DEVICE` semantics. D-15 requires:

- Model owns generated `MlsDeviceCredential{version, ptid, device_id}`;
- Desktop and Mobile encode it as the complete BasicCredential identity;
- KeyPackage directory metadata must match the decoded credential;
- Desktop/Mobile remove one exact leaf for `REMOVE_DEVICE` and all actor leaves
  for `REMOVE` / `LEAVE`;
- Station remains opaque to KeyPackage and Commit contents.

No current PTID-only credential path is retained.

### Accepted D-16 Delegated Leave Boundary

OpenMLS does not permit a member to commit its own removal. Actor `LEAVE`
therefore uses a signed, expiring leave intent from the departing device and a
Commit generated by a different active leaf. The final
`MembershipTransitionCommand` carries the intent ID; the authority verifies
exact actor/device/head binding and consumes the intent inside the same D-13
transaction. Desktop and Mobile must not expose a direct self-removal Commit
path. Home/authority Station forwarding for remote intents is verified in C6.

## 8. Target Deletions

The D-13 cutover deletes, rather than aliases:

- client sequencing of Commit/Welcome through `/mls/distribute`;
- random UUID-based MLS delivery idempotency keys;
- separate `BumpMembershipEpoch` and member-upsert calls as the transition
  persistence contract;
- post-commit envelope submission as the only durability mechanism;
- Sender Keys acceptance gates and reports that claim current MLS coverage.

The completed D-17 hard cut deletes:

- `MembershipTransitionProposal`, signing input, result, reject enum, and API
  request/response types;
- `/conversation/membership-transition` and
  `/conversation/federation/membership-transition`;
- `mls_submit_membership_transition` and the membership-only Desktop routing
  branch;
- legacy `GroupProposal` / `GroupProposalResult` definitions and active
  handlers;
- any direct remote client call to an authority Station;
- any message-only proposal introduced in parallel with the generic command
  proposal.

KeyPackage upload/fetch remains. Generic envelope infrastructure remains.

## 9. Failure Semantics

| Failure | Required Behavior |
| --- | --- |
| authority validation rejection | no business or MLS durable state changes; client discards pending Commit |
| DB failure before commit | no transition/event/outbox visibility |
| ordinary-command failure at any receipt/event/outbox write | no receipt, event, sequence advance, or fan-out visibility |
| process crash after DB commit | outbox worker resumes deterministic delivery |
| duplicate proposal | same committed result, no duplicate event/outbox |
| reordered follower events | bounded buffer, authority resync, no post-gap writes |
| recipient offline | durable inbox resume in authority order |
| OpenMLS Commit rejection | crypto-desynced read-only; no silent membership continuation |
| forged authority/event hash | reject and activate fork protection |
| authority unavailable | follower remains read-only per D-05 |
| Home Station unavailable before durable accept | client remains local-queued and retries its Home Station; no authority event exists |
| Home Station crashes after durable accept | proposal outbox resumes with the same signed bytes and command ID |
| peer token expires during retry | Home Station remints the token; actor-signed command bytes do not change |
| device-signed command expires | `COMMAND_EXPIRED`; no retry extension, receipt, sequence, or authority mutation |
| exact command retry after lost response | authority returns the original canonical event; no new sequence/fan-out |
| client/Home response lost after Home durable accept | device resumes addressed result notification or queries the same command ID |
| Home crashes after authority response but before local result commit | authority exact retry returns the same result; Home then commits result + inbox atomically |
| command ID reused with different hash | `COMMAND_CONFLICT` before sequence allocation |
| actor key/profile temporarily unavailable | retryable rejection; no command receipt or authority mutation |
| invalid signature/hash/field binding | terminal rejection before command receipt or authority mutation |
| queue or policy admission exceeded | typed `RATE_LIMITED` / `PAYLOAD_TOO_LARGE`; no silent drop |
| client requests cancellation after Home durable accept | cancellation is unsupported; use an explicit retract/compensating command after commit |
| typing submitted through D-17 proposal | `UNSUPPORTED_COMMAND`; typing remains signaling-plane only |

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

D-17 additionally requires:

- local and remote submissions of the same durable command produce equivalent
  `CommittedConversationEvent` semantics;
- dropped response plus exact retry returns one event, one `group_seq`, and one
  logical fan-out;
- deterministic failure injection at every generic command
  receipt/event/outbox write boundary proves zero partial visibility;
- same command ID with a forged hash, wrong command kind, wrong device, stale
  authority/membership epoch, expired peer token, and inactive Home Station
  fail closed;
- a remote MLS ciphertext send passes through Desktop Rust, authenticated Home
  Station, authority, follower projections, and recipient OpenMLS decrypt;
- direct remote client-to-authority submission and typing-through-proposal are
  rejected;
- queue/payload admission and retry after Home/authority restart are exercised;
- concurrent submissions from multiple Desktop windows share one actor-device
  signer without duplicate command IDs or private-key exposure;
- per-conversation FIFO and bounded cross-conversation fairness are exercised
  under one noisy actor/conversation;
- Model, Station, Desktop App, and Desktop Web contain no live
  membership-only proposal path after cutover.

## 11. Review Status

D-13 through D-17 are `accepted`. Owner acceptance of D-17 was recorded on
2026-08-03. Execution must conform to the generic proposal, command receipt,
atomic event/outbox, retry, exclusion, and hard-deletion semantics above.

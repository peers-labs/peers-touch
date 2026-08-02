# D-13 Atomic MLS Membership Transition — Execution Plan

> **Status**: active
> **Version**: v0.1
> **Created**: 2026-08-02 | **Updated**: 2026-08-02
> **Owner**: Architecture Team
> **Architecture Decision**: D-13 (accepted 2026-08-02)

---

## 1. Background And Goal

The Desktop single-Station strict E2EE closure is complete. The next
dependency-ready closure is parent-plan `P3-S3`: prove C-4 and C-5 across one
authority Station and two follower Stations.

Current code cannot pass C-4:

- membership commands carry no MLS Commit/hash/epoch;
- clients sequence `/mls/distribute` independently from membership mutation;
- member rows, `membership_epoch`, event append, and envelope delivery are
  separate persistence operations;
- the registered three-node acceptance gate invokes a missing Make target;
- existing federated browser gates still describe Sender Keys rather than the
  strict MLS runtime.

This plan lands accepted D-13: one authority transaction owns membership truth,
epoch progression, opaque MLS Commit evidence, and durable outbox facts.
Follower Stations and clients then converge by authority sequence under
duplicate, reorder, disconnect, and restart.

The product outcome remains a modern Desktop/Mobile IM app. This closure builds
the reliability substrate needed for user-visible group membership to remain
correct; it does not add infrastructure unrelated to chat journeys.

## 2. Accepted Sources

| Source | Contract Used By This Plan |
| --- | --- |
| `docs/architecture/federated-im/design.md` | authority, membership transition, follower/device convergence |
| `docs/architecture/federated-im/data-model.md` | transition command/event, delivery, heads, uniqueness |
| `docs/architecture/federated-im/decisions.md` D-05 | authority unavailable means read-only |
| `docs/architecture/federated-im/decisions.md` D-08 | OpenMLS, device-local secrets |
| `docs/architecture/federated-im/decisions.md` D-10 | one typed Station envelope framework |
| `docs/architecture/federated-im/decisions.md` D-11 | hard cutover, no compatibility bridge |
| `docs/architecture/federated-im/decisions.md` D-13 | atomic authority membership/MLS transition |
| `docs/architecture/federated-im/integration.md` | current-to-target mapping and deletion boundary |
| `docs/architecture/federated-im/execution-plans/20260712-g0-mls-verification.md` | C-4/C-5 L3 acceptance |
| `docs/architecture/federated-im/execution-plans/20260712-v1-im-execution-plan.md` | parent P3-S3 ordering |
| User decision, 2026-08-02 | stay focused on a modern Desktop/Mobile IM product |

## 3. Scope

### In Scope

- proto-first D-13 membership transition and authority result contracts;
- authority validation, transaction, idempotency, event, and outbox;
- follower projection/head/inbox transaction and resync semantics;
- Desktop OpenMLS pending-commit lifecycle and ordered receive state;
- Desktop App/Web group create, add, remove, leave, and restart integration;
- three distinct Station deployment/topology gate;
- C-4/C-5 duplicate, reorder, disconnect, restart, fork, and leakage evidence;
- deletion of independent Commit/Welcome sequencing paths and stale acceptance
  claims.

### Out Of Scope

- Mobile OpenMLS runtime implementation; it remains the following formal phase;
- new visual design or chat information architecture;
- direct-message protocol changes;
- authority handover, multi-writer consensus, or automatic recovery;
- parent P4 runtime unification;
- parent P6 historical-data operational SQL cleanup;
- migration or compatibility support for pre-D-13 development data.

Shared proto generation must remain buildable for Mobile, but that is contract
compatibility evidence, not a Mobile runtime readiness claim.

## 4. Architecture Traceability

| Plan Requirement | Product Outcome | Architecture / Decision | Required Evidence |
| --- | --- | --- | --- |
| one membership transition command | membership UI never shows a state the MLS tree did not accept | D-13, design §6.3 | L2 failure injection + live transition |
| transactionally durable outbox | offline members receive the accepted change after restart | D-10, D-13 | crash-after-commit resume |
| follower ordered apply | remote members see one membership order | design §6.5 | three Station head equality |
| pending OpenMLS commit | sender does not advance crypto on rejected business mutation | D-08, D-13 | rejection leaves local state unchanged |
| removed-member denial | removed users cannot send/read/decrypt future group data | D-08 security boundary | live negative results |
| bounded reorder/resync | reconnect produces one stable conversation instead of a stuck UI | D-05, D-13 | reorder/disconnect matrix |
| App/Web parity | Desktop variants behave as one IM product | parent P3-S3 | App↔Web cross-Station evidence |
| no Station plaintext/secrets | E2EE remains device-local | D-08, D-10 | DB/log/report leakage scan |

## 5. Current-State Inventory

### 5.1 Contracts And Generated Outputs

- `model/domain/chat/conversation.proto`
  - `AddMembersCommand`, `RemoveMembersCommand`, `LeaveCommand`;
  - `MembershipChangedEvent`;
  - no MLS transition identity/hash/bytes.
- `model/domain/chat/conversation_api.proto`
  - `DistributeMlsRequest/Response`.
- `model/domain/chat/envelope.proto`
  - `MlsKeyDeliveryPayload`;
  - delivery lacks authority sequence and transition identity/hash.
- generated Go:
  `apps/station/frame/touch/model/chat/{conversation,conversation_api,envelope}.pb.go`.
- generated Desktop TS:
  `apps/desktop/src/gen/proto/domain/chat/{conversation,conversation_api,envelope}_pb.ts`.
- Desktop Rust generated contracts are produced through
  `apps/desktop/src-tauri/build.rs`.

### 5.2 Authority Station

- `apps/station/app/subserver/conversation/service_impl.go`
  performs sequence allocation, member writes, epoch bump, and event assembly
  through separate repository calls.
- `apps/station/app/subserver/conversation/repository.go`
  exposes independent `NextSeq`, `UpsertMember`, `BumpMembershipEpoch`, and
  `AppendEvent`.
- `apps/station/app/subserver/conversation/envelope_bridge.go`
  submits envelopes after event persistence.
- `apps/station/app/subserver/conversation/subserver.go`
  exposes `/mls/distribute` with random delivery idempotency suffixes.
- `apps/station/app/subserver/envelope/infrastructure/repo.go`
  owns outbox/inbox tables but has no shared transition unit-of-work boundary.

### 5.3 Follower And Federation

- envelope federation transport persists cross-Station envelopes and forwards
  them through Relay;
- inbound delivery enqueues recipient inbox facts;
- no canonical conversation follower-head transaction binds replicated
  membership projection and recipient transition delivery;
- existing federation acceptance scripts primarily exercise legacy Sender Keys
  flows.

### 5.4 Desktop

- `apps/desktop/src-tauri/src/domain/mls_group.rs`
  merges `add_members`/`remove_members` pending commits immediately.
- `apps/desktop/src/components/chat/CreateGroupModal.tsx` and
  `ChatDetailPanel.tsx` sequence membership API calls and
  `imServiceV1.mlsGroup.distribute` separately.
- `apps/desktop/src/services/im-service.ts`,
  `src-tauri/src/interface/tauri_commands/mls.rs`,
  `src-tauri/src/interface/http_gateway/mod.rs`, and `src-tauri/src/main.rs`
  expose the independent distribution surface.
- SQLCipher persists established MLS sessions but has no durable pending/applied
  transition ledger or bounded reorder state.

### 5.5 Acceptance

- `tooling/acceptance/gates.yaml` registers `federation-three-node-e2e`;
- that gate invokes missing Make target `testnet-p5-federation-e2e`;
- current federated Desktop group gates name and exercise Sender Keys;
- profiles `one`, `two`, and `three` point at three remote Station URLs and one
  shared Relay, but no current MLS convergence report proves deployed commit,
  peer IDs, or state heads.

## 6. Responsibility Workstreams

### D13-C0 — Canonical Contract Cutover

**Responsibility**: Model owns the only shared transition semantics.

**Deliverables**:

- replace add/remove/leave membership payloads with
  `MembershipTransitionCommand`;
- define transition changes, Welcome artifacts/descriptors, accepted result,
  committed event fields, and typed rejection details;
- bind `transition_id`, authority sequence, from/to membership and MLS epochs,
  Commit/Welcome SHA-256, and opaque bytes;
- extend group creation with epoch-1 genesis transition semantics;
- add deterministic idempotency and size/recipient limits;
- generate Go, Desktop TS/Rust, and Mobile contract outputs.

**Failure behavior**:

- stale epoch, invalid hash, target epoch, recipient, size, or transition reuse
  is represented by typed fail-closed errors.

**Deletion obligation**:

- old independent membership command variants and `DistributeMlsRequest` are
  absent from source proto after the atomic cutover.

**Gate**:

```bash
./model/build.sh
rg -n "DistributeMlsRequest|AddMembersCommand|RemoveMembersCommand" model/domain/chat
```

The second command must return zero live contract definitions.

### D13-C1 — Station Transition Unit Of Work

**Responsibility**: Station persistence atomically commits authority truth and
delivery facts.

**Deliverables**:

- add a Station application unit-of-work that coordinates transaction-scoped
  conversation and envelope repositories on one GORM transaction;
- lock the conversation head and validate current epochs;
- atomically allocate sequence, mutate members, advance epoch, append the
  committed event, and insert deterministic outbox rows;
- add uniqueness for conversation sequence, transition identity, and logical
  recipient delivery;
- compute pre/post recipient snapshots so removed members receive their eviction
  Commit and added devices receive Welcome;
- expose post-commit wakeup only; no network call occurs inside the transaction.

**Failure behavior**:

- injected failure at every write boundary rolls back every affected table;
- crash after commit leaves retryable outbox rows;
- exact duplicate returns the original accepted result;
- same identity with different hash returns conflict and writes nothing.

**Gate**:

- transaction failure-injection table proves zero partial rows;
- duplicate/concurrent transition tests prove one sequence and logical outbox;
- Go race tests cover concurrent transitions for one group.

### D13-C2 — Authority Validation And Command Service

**Responsibility**: the authority Station is the only transition mutation
authority.

**Deliverables**:

- validate subject, role, Federation membership, group authority, current head,
  epochs, SHA-256, admission limits, and recipient routes;
- submit local commands or signed remote proposals to the same authority
  transition service;
- return accepted sequence/epochs/hashes for client pending-commit merge;
- derive deterministic replication and key-delivery identities;
- reject writes while authority/group state is degraded or read-only;
- remove public Commit/Welcome sequencing from `/mls/distribute`.

**Failure behavior**:

- follower/home Stations cannot mutate remote group truth;
- malformed or forged proposals fail before the unit of work;
- authorized but semantically invalid MLS bytes remain opaque and are handled
  by recipient fail-closed semantics.

**Gate**:

- local and remote proposal contract tests produce the same committed event;
- stale and mismatched epoch/hash tests return typed rejection;
- admission tests cover 128 KiB Commit, 8 MiB Welcome total, and 200 deliveries.

### D13-C3 — Follower Projection And Convergence

**Responsibility**: follower Stations apply authority facts in order and make
local delivery durable.

**Deliverables**:

- persist `FollowerGroupHead` with sequence, event hash, membership/MLS epochs,
  transition id, and Commit hash;
- verify authority identity/signature and active Federation membership;
- atomically apply follower projection/head and local recipient inbox rows;
- exact duplicates are no-ops;
- future events enter a bounded 128-event buffer and trigger authority resync;
- hash conflicts activate fork-protected read-only state;
- ACK only after local transaction commit;
- restart resumes from last durable apply, not last receive.

**Failure behavior**:

- gap, overflow, invalid authority, or conflicting hash blocks post-gap writes;
- authority unavailable preserves read-only projection per D-05.

**Gate**:

- L2 duplicate/reorder/gap/restart tests compare follower heads and local inbox;
- same-sequence different-hash negative enters read-only and emits evidence.

### D13-C4 — Desktop Pending Transition Runtime

**Responsibility**: Desktop owns device-local OpenMLS transition lifecycle and
user-visible crypto readiness.

**Deliverables**:

- split OpenMLS prepare from merge for create/add/remove/leave/device changes;
- persist pending transition identity, exact opaque bytes/hash, and pre-state;
- submit one authority transition command through App/Web parity;
- merge and save only after exact authority acceptance;
- rejection discards pending state and refreshes membership projection;
- receive applies authority sequence with durable applied markers and bounded
  reorder state;
- duplicate Commit/Welcome is a no-op;
- gap or OpenMLS rejection exposes establishing or crypto-desynced read-only
  state and blocks sends;
- migrate CreateGroupModal and ChatDetailPanel to the one transition path.

**Failure behavior**:

- process crash before acceptance cannot advance durable MLS state;
- process crash after acceptance can recover and merge/replay idempotently;
- optimistic UI cannot become membership truth.

**Deletion obligation**:

- remove Desktop `mls_distribute` service, Tauri command, HTTP command, main
  registration, and all callers.

**Gate**:

- focused Rust tests for pending/reject/accept/restart;
- App and Web integration tests for create/add/remove;
- tree search for `mls_distribute` returns zero live Desktop references.

### D13-C5 — Deterministic L2 Fault Matrix

**Responsibility**: prove the transition design before remote deployment.

**Deliverables**:

- inject failures before and after each transaction write;
- run duplicate proposal, concurrent proposal, out-of-order follower delivery,
  partial ACK, process restart, buffer overflow, forged hash, and invalid
  OpenMLS Commit cases;
- expose machine-readable authority/follower/client public-head snapshots;
- scan Station DB/logs and evidence for plaintext and private key markers.

**Gate**:

- all C-4 transaction invariants pass;
- all C-5 convergence and fail-closed assertions pass;
- report stored under `tooling/acceptance/reports/` with no secrets.

### D13-C6 — Three-Station Testnet And MLS L3 Gate

**Responsibility**: acceptance tooling proves the deployed architecture.

**Deliverables**:

- restore an executable `testnet-p5-federation-e2e` topology gate for profiles
  `one`, `two`, and `three`;
- deploy the exact same commit to all three Stations and record distinct peer
  IDs plus healthy Relay membership;
- add an MLS-native `chat-mls-three-station-convergence` gate;
- provision authority, follower A, and follower B actors through product auth;
- execute create, add, remove, remote send, duplicate, reorder, disconnect,
  partial ACK, follower restart, and reconnect;
- compare authority/follower heads and recipient public MLS group context/tree
  hashes;
- prove removed-member send/read/decrypt denial;
- generate a report with topology, commit, fault schedule, transitions, heads,
  hashes, rejections, and leakage results.

**Failure behavior**:

- unavailable or non-distinct Station/Relay/peer identity fails the gate;
- missing required fault injection or state hash is `UNPROVEN`, not skipped;
- old Sender Keys gates cannot satisfy this workstream.

**Gate**:

```bash
python3 tooling/scripts/acceptance-run.py --gate federation-three-node-e2e
python3 tooling/scripts/acceptance-run.py --gate chat-mls-three-station-convergence
```

### D13-C7 — Atomic Deletion And Readiness Closure

**Responsibility**: leave one membership/MLS source of truth.

**Deliverables**:

- delete Station `/mls/distribute`, its social-gate action/extractor, and old
  API contracts;
- delete old Desktop sequencing surfaces and callers;
- delete or rewrite Sender Keys acceptance scripts/reports that claim current
  federated group coverage;
- update architecture, execution status, operational knowledge, and acceptance
  capability registry;
- run completion audit against D-13, C-4, and C-5.

**Gate**:

```bash
rg -n "mls_distribute|/mls/distribute|DistributeMlsRequest" model apps tooling
rg -n "Sender.Key|sender_key|SKDM" tooling/acceptance/gates/chat
```

Both searches must return zero live paths that claim current strict-MLS
membership coverage.

## 7. End-To-End Lifecycle Mapping

| Lifecycle Step | Owner | Workstream |
| --- | --- | --- |
| actor/device publishes KeyPackages | client + Station directory | retained substrate |
| device prepares OpenMLS transition | Desktop crypto runtime | C4 |
| local/remote transition reaches authority | Home/authority Station | C2 |
| validation and admission | authority service | C2 |
| business/event/outbox commit | Station unit of work | C1 |
| acceptance merges sender pending Commit | Desktop crypto runtime | C4 |
| async cross-Station delivery | envelope/Relay | C1/C3 |
| follower ordered apply + local inbox | follower Station | C3 |
| recipient Commit/Welcome apply | Desktop crypto runtime | C4 |
| post-transition send | authority gate + client MLS | C2/C4 |
| duplicate/reorder/disconnect/restart | all runtime units | C3/C4/C5/C6 |
| removed-member denial | authority + recipient crypto | C2/C4/C6 |
| final old-path deletion | all consumers | C7 |

No lifecycle step is intentionally owned by Mobile in this closure. Mobile
runtime implementation is the following phase and consumes the same accepted
contract.

## 8. Dependency DAG

```text
D13-C0 Canonical contracts
  ├──> D13-C1 Station transaction substrate
  ├──> D13-C3 Follower convergence substrate
  ├──> D13-C4 Desktop pending transition runtime
  └──> D13-C6 acceptance harness structure

D13-C1 ──> D13-C2 Authority service
D13-C2 ──> D13-C3 remote authority integration
D13-C2 + D13-C3 + D13-C4 ──> D13-C5 L2 fault matrix
D13-C5 ──> D13-C6 three-Station L3
D13-C6 ──> D13-C7 deletion/readiness closure
```

Parallel units after C0:

- C1 transaction substrate;
- C3 follower storage/apply substrate that does not depend on authority API;
- C4 local OpenMLS pending-state implementation;
- C6 topology/harness scaffolding without readiness claims.

Integration remains dependency-ordered through C2, C5, C6, then C7.

## 9. Atomic Cutover Matrix

| Concern | New Source Of Truth | Cutover Condition | Old Path Deleted | Proof |
| --- | --- | --- | --- | --- |
| membership + MLS order | authority transition event | C0-C4 integration passes | add/remove/leave split sequencing | proto/tree search |
| accepted delivery durability | transactional outbox | C1 failure matrix passes | post-event best-effort submit | zero partial-state tests |
| follower state | authority-signed follower head | C3 convergence tests pass | receive-only inbox without projection head | duplicate/fork tests |
| Desktop MLS merge | durable pending transition | App/Web restart tests pass | immediate merge before authority acceptance | Rust/TS search |
| federated MLS evidence | new C-4/C-5 gate | three Station report passes | Sender Keys acceptance claims | registry/report search |

Rollback uses Git/deployment rollback plus development data reset. No permanent
dual-write or compatibility mode is permitted.

## 10. Verification Matrix

| Cell | Required Command / Evidence | Claim |
| --- | --- | --- |
| Model | `./model/build.sh` | shared contracts generate |
| Station conversation | `go test ./app/subserver/conversation/...` | authority validation/transaction |
| Station envelope | `go test ./app/subserver/envelope/...` | deterministic outbox/inbox |
| Station federation | relevant federation/relay tests | authority identity and transport |
| Desktop Rust | focused MLS pending/reorder/restart tests | local crypto lifecycle |
| Desktop TS | im-service/runtime/component tests | App/Web command parity and state |
| Desktop App/Web | live create/add/remove/send/restart | real modern-IM journey |
| L2 fault report | machine-readable C-4/C-5 report | atomicity and convergence |
| L3 topology | three distinct Station peer IDs, same commit, Relay healthy | environment validity |
| L3 MLS | `chat-mls-three-station-convergence` | C-4/C-5 acceptance |
| Security | DB/log/storage/evidence scans | no plaintext/private MLS state |
| Deletion | zero-live-reference searches | single source of truth |

The existing repository-wide Desktop check has known unrelated React/provider
baseline failures. Changed-path diagnostics and focused gates remain mandatory;
the final report must preserve the unrelated baseline rather than hiding it.

## 11. Evidence Artifacts

Required report fields:

- source commit and deployed commit per Station;
- Station URLs and distinct peer IDs;
- Relay URL/peer ID and membership status;
- transition ids, group sequence, from/to membership and MLS epochs;
- event, Commit, and Welcome hashes;
- injected failure/reorder/disconnect schedule;
- per-Station follower heads;
- per-client public MLS group context/tree hashes;
- duplicate/fork/rejection outcomes;
- removed-member send/read/decrypt outcomes;
- DB/log/storage plaintext/private-key scan results;
- test commands, exit codes, durations, and unproven cells.

Reports must not contain access tokens, private keys, raw MLS secret state, or
message plaintext beyond unique non-sensitive leakage markers.

## 12. Risks And Escalation

| Risk | Mitigation / Escalation |
| --- | --- |
| conversation and envelope repositories cannot share one transaction without ownership leakage | use a Station application unit-of-work; if impossible without cross-domain schema duplication, return `DESIGN_AMENDMENT_REQUIRED` |
| OpenMLS cannot preserve pending Commit across authority latency/restart | prove API behavior in C4 before consumer migration; otherwise return `DESIGN_AMENDMENT_REQUIRED` |
| Relay transport cannot preserve authority identity/signature | stop before C3 integration and amend design |
| transaction contention regresses message latency | measure transition-only lock duration; message path remains separate |
| authorized device submits semantically invalid Commit | recipient OpenMLS fail-closed read-only + resync evidence |
| remote environments drift or share peer identity | topology gate fails before chat mutations |
| stale development rows conflict with hard cutover | reset only approved development chat/federation data; no application migration code |
| plan grows into UI redesign or Mobile implementation | reject as out of scope and route to the owning later phase |

## 13. Status

| Workstream | Status | Evidence |
| --- | --- | --- |
| D13-C0 Canonical Contract Cutover | pending | — |
| D13-C1 Station Transition Unit Of Work | pending | — |
| D13-C2 Authority Validation And Command Service | pending | — |
| D13-C3 Follower Projection And Convergence | pending | — |
| D13-C4 Desktop Pending Transition Runtime | pending | — |
| D13-C5 Deterministic L2 Fault Matrix | pending | — |
| D13-C6 Three-Station Testnet And MLS L3 Gate | pending | — |
| D13-C7 Atomic Deletion And Readiness Closure | pending | — |

## 14. Final Readiness Claim

This plan may claim `P3-S3 C-4/C-5 complete` only when:

- all C0-C7 workstreams are done;
- one source of truth remains;
- all three Stations run the same commit with distinct peer IDs;
- authority/follower/client public heads converge under every required fault;
- removed-member and fork negatives fail closed;
- no Station/evidence plaintext or private MLS state is found;
- the plan and G0 evidence tables are updated with report paths.

Until then, C-4/C-5 remain `PARTIAL` or `UNPROVEN`. Mobile and parent P4 remain
not completed.

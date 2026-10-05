# D-17 Generic Conversation Command Proposal — Execution Plan

> **Status**: complete
> **Version**: v0.1
> **Created**: 2026-08-03 | **Updated**: 2026-08-03
> **Owner**: Architecture Team

---

## 1. Accepted Inputs

Accepted architecture:

- `docs/context/architecture/chat/federated-im/README.md`
- `docs/context/architecture/chat/federated-im/design.md`
- `docs/context/architecture/chat/federated-im/data-model.md`
- `docs/context/architecture/chat/federated-im/integration.md`
- `docs/context/architecture/chat/federated-im/module-layout.md`
- D-17 in `docs/context/architecture/chat/federated-im/decisions.md`

Owner acceptance:

- D-17 explicitly accepted by the user on 2026-08-03.

Operational constraints:

- `docs/knowledge/invariants/actor-identity-boundary.md`
- `docs/knowledge/pitfalls/conversation-ordinary-event-hash-chain.md`
- `docs/client/desktop/runtime-projections.md`
- D-11 hard cut: no compatibility bridge or application data migration.

This is infrastructure/protocol closure over the existing IM product journey.
It introduces no new product surface. Existing
`MessageDeliveryState` values map Home durable acceptance to `SUBMITTED` and
authority acceptance to `COMMITTED`.

## 2. Objective

Replace the membership-only D-14 remote wrapper and retired `GroupProposal`
contracts with one actor-device-signed `ConversationCommandProposal` for every
durable remote command.

The final system must provide:

- one Model contract and one authority command/event truth;
- exact `(conversation_id, command_id, command_sha256)` replay/conflict
  semantics;
- one authority transaction containing command receipt, effects, event, and
  deterministic fan-out outbox;
- durable Home Station proposal/result recovery;
- device-local signing owned outside MLS-specific transport;
- remote MLS ciphertext send/decrypt through three real Stations;
- zero live membership-only or legacy proposal paths.

## 3. Scope

In scope:

- durable `ConversationCommand` kinds:
  `send_message`, `edit_message`, `retract_message`, `dissolve`,
  `update_settings`, `react`, `pin_message`, and `membership_transition`;
- Model, Station, Desktop Rust, Desktop Web, generated Mobile contracts;
- command receipt and Home proposal/result persistence;
- auth, expiry, retry, admission, FIFO/fairness, restart, and result recovery;
- D-17 hard deletion and D13-C6 runtime evidence.

Out of scope:

- Mobile runtime/OpenMLS implementation;
- typing persistence; typing remains D-10 signaling;
- receipt redesign; receipts retain their typed API;
- authority handover or multi-writer groups;
- compatibility aliases, dual writes, or application migration of development
  proposal rows;
- unrelated Desktop TypeScript baseline cleanup.

## 4. Traceability

| Requirement | Architecture source | Decision / invariant | Required evidence |
| --- | --- | --- | --- |
| One signed remote command wrapper | `design.md` §6.2-6.3 | D-17 | generated contract + local/remote equivalence |
| PTID-only actor boundary | `module-layout.md` §3-5 | actor identity invariant | boundary searches + tests |
| Exact command replay/conflict | `data-model.md` §6.3 | D-17 | duplicate/lost-response/concurrent tests |
| Atomic receipt/event/outbox | `data-model.md` §9.2 | D-17, ordinary hash-chain pitfall | every-write-boundary rollback matrix |
| Durable Home result recovery | `design.md` §6.2.2 | D-17 | response-loss + Home restart test |
| Actor signer outside MLS transport | `module-layout.md` §2-5 | D-17/D-15 | Rust identity/restart/multi-window tests |
| Bounded queue/admission/fairness | `design.md` §6.2.1 | D-17 | overload and noisy-conversation test |
| Membership pending Commit preserved | `design.md` §6.3 | D-13/D-14/D-16 | existing + migrated MLS transition tests |
| No old proposal path | `integration.md` §8 | D-11/D-17 | tree-wide zero-reference gate |
| Three-Station remote MLS send | `integration.md` §10 | D13-C6 | secret-free C6 PASS report |

## 5. Current-State Inventory

### 5.1 Contracts

- `model/domain/chat/conversation.proto`
  - canonical `ConversationCommand`;
  - D-14 `MembershipTransitionProposal*` and membership reject enum.
- `model/domain/chat/conversation_api.proto`
  - membership-only submit request/response.
- `model/domain/chat/group_chat.proto`
  - retired `GroupProposal` / accept-proposal contracts.
- Generated Go/Desktop/Mobile artifacts contain both old surfaces.
- `EnvelopePayloadType` has no generic command-result delivery.

### 5.2 Authority And Delivery

- `DefaultService.SubmitCommand` hashes ordinary events transactionally but
  submits fan-out after commit.
- Ordinary commands have no durable command receipt lookup/conflict journal.
- D-13 membership transitions already commit membership, event, and outbox in
  one unit of work.
- Follower projection, durable inbox, reorder buffer, resync, and public heads
  already exist.

### 5.3 Remote Trust Path

- `transition_proposal*.go` verifies and forwards membership transitions only.
- Home/authority routes and token scope are membership-specific.
- Actor `DeviceStore`, signed profile publication, and verified key hydration
  are reusable and remain identity-owned.

### 5.4 Desktop

- `MlsGroupManager` owns the actor Ed25519 signer and persistence.
- `mls_submit_membership_transition` signs and submits only membership
  transitions.
- `im-service.ts` branches membership remote/local; ordinary commands call the
  authenticated Home Station directly.
- `socialRealtime`/`imRuntime` own chat projection freshness and must own
  command-result event/reconciliation consumption.

### 5.5 Acceptance

- C5 deterministic L2 matrix passes.
- C6 membership/device/leave convergence has a partial PASS report.
- The enhanced C6 fault harness is implemented but not run because the three
  deployed Station commits currently differ.
- Remote ordinary send remains unproven.

## 6. Responsibility Workstreams

### D17-W1 — Authority Command Transaction Foundation

Responsibility:

- make every durable authority command exact-replay-safe and atomically
  distributable without changing public proposal contracts yet.

Deliverables:

- command receipt model/repository keyed by conversation + command ID/hash;
- generic command unit of work using the shared Conversation and Envelope DB;
- receipt lookup/conflict before sequence allocation;
- command effects, event hash-chain append, receipt, and deterministic
  inbox/outbox rows in one transaction;
- D-13 transition specialization preserved inside the same discipline;
- post-commit notifier wakes workers but owns no durability.

Failure behavior:

- exact retry returns the original event;
- hash reuse returns `COMMAND_CONFLICT` before mutation;
- every receipt/effect/event/outbox write failure rolls back all visibility;
- process crash after commit resumes existing outbox rows.

Gate:

```bash
cd apps/station/app
go test -race ./subserver/conversation/... ./subserver/envelope/...
```

Evidence:

- focused command replay/concurrency/write-boundary tests;
- no new event with missing 32-byte hash;
- no network call inside the unit of work.

Merge boundary:

- independently mergeable; no wire change.

### D17-W2 — Actor Device Identity Ownership

Responsibility:

- move the durable Ed25519 actor-device signer out of MLS-specific ownership.

Deliverables:

- actor-scoped `actor_device_identity` domain owner;
- signer persistence and PTID/device continuity moved without key rotation;
- `MlsGroupManager` consumes the signer/credential interface;
- generic proposal signer can consume the same identity;
- no private key bytes cross Rust-to-TypeScript or window boundaries.

Failure behavior:

- wrong actor/device scope fails closed;
- corrupted or mismatched persisted identity does not generate a replacement;
- restart restores the same public key/signing key ID;
- concurrent windows produce distinct command IDs over one device identity.

Gate:

```bash
cd apps/desktop/src-tauri
cargo test --bin peers-touch-desktop actor_device_identity
cargo test --bin peers-touch-desktop mls
```

Evidence:

- pre/post extraction public-key continuity test;
- restart and multi-window signing tests;
- existing MLS identity/KeyPackage/transition tests remain green.

Merge boundary:

- independently mergeable; no wire change.

### D17-W3 — Proto-First Hard-Cut Contract

Responsibility:

- establish the only allowed D-17 cross-runtime contract.

Deliverables:

- `ConversationCommandProposal`, deterministic signing input, result, generic
  reject enum, submission state, result delivery;
- Home submit/result query and peer authority request/response;
- command expiry, retryability, required heads, and authority evidence;
- command-result envelope payload type;
- D-14 membership-only proposal types removed with names/field numbers
  reserved as required;
- retired `GroupProposal` contracts removed/reserved;
- Go/Desktop/Mobile generated artifacts regenerated only from proto.

Gate:

```bash
./model/build.sh
./tooling/scripts/proto-gen-mobile.sh
```

Merge boundary:

- begins the atomic protocol cutover; MUST NOT merge until W4-W6 close.

### D17-W4 — Station Generic Proposal And Result Runtime

Responsibility:

- authenticate, queue, forward, commit, and recover every D-17 command through
  Home and authority Stations.

Deliverables:

- generic proposal verifier with exact command-kind/field/hash binding;
- user Home route, peer authority route, and durable result query;
- one `conversation-command-proposal` peer-token scope;
- verified actor-key hydration retained;
- Home proposal outbox/result store and retry worker;
- immutable device-signed expiry and short-lived token remint;
- atomic Home result + addressed device inbox notification;
- bounded per-actor/per-conversation/global admission;
- FIFO per conversation and fair scheduling across conversations;
- local-authority and remote-authority commands use one authority service.

Failure behavior:

- invalid Station/actor/device/key/kind/hash/epoch binding rejects before UoW;
- temporary key/read-only/rate-limit outcomes retry without terminal receipt;
- expiry, revocation, conflict, unsupported kind, stale command, and permission
  denial are terminal;
- Home/authority response loss and restart recover the same command result.

Gate:

```bash
cd apps/station/app
go test -race ./subserver/conversation/... ./subserver/envelope/... ./subserver/federation/...
```

Evidence:

- local/remote equivalence;
- exact duplicate and concurrent conflict;
- Home outbox restart, result-inbox atomicity, token expiry/remint;
- overload/fairness and all negative trust cases.

Dependency:

- W1 and W3.

### D17-W5 — Desktop Generic Command And Result Runtime

Responsibility:

- make Desktop App/Web submit all durable commands through the accepted
  authority-aware D-17 path.

Deliverables:

- generic Rust command encode/hash/sign/submit function owned by Conversation;
- registration in native Tauri and Rust HTTP gateway;
- Desktop Web service routes remote durable commands through the generic Rust
  signer and local-authority commands through canonical authority submission;
- membership prepare/accept/discard remains exact and uses the generic result;
- command result notification consumed by the social runtime;
- periodic/result-query reconciliation covers missed events, hidden windows,
  process pause, and reconnect;
- existing message delivery states project Home/authority progress.

Failure behavior:

- no plaintext or raw-text fallback;
- no pending MLS merge on Home acceptance, transport ACK, or retryable reject;
- terminal membership rejection discards pending Commit;
- restart/result loss resolves by the same command ID;
- window close does not cancel Home-durable work.

Gate:

```bash
cd apps/desktop/src-tauri
cargo test --bin peers-touch-desktop

cd apps/desktop
pnpm exec vitest run src/services/im-service.test.ts
```

Evidence:

- deterministic signing bytes and App/Web normalization;
- remote send, membership, retryable/terminal result, restart, and
  multi-window tests;
- targeted TypeScript diagnostics contain no D-17 errors.

Dependency:

- W2, W3, and W4 contract/API.

### D17-W6 — Atomic Consumer Cutover And Deletion

Responsibility:

- close the W3-W6 protocol migration with one live source of truth.

Deliverables:

- delete membership-only Station service/handler/forwarder/scope/routes;
- delete `mls_submit_membership_transition` native/Web commands and TS branch;
- delete retired GroupProposal generated/current contracts and handlers;
- delete active membership-only fixtures/report claims or rewrite them generic;
- update architecture, operational knowledge, and parent-plan status;
- reserve removed proto names/field numbers;
- no application compatibility alias, dual write, or data migration.

Deletion gate:

```bash
rg -n \
  'MembershipTransitionProposal|SubmitMembershipTransitionProposal|membership-transition|mls_submit_membership_transition|AcceptGroupProposal|\\bGroupProposal\\b' \
  model apps tooling \
  --glob '!**/target/**' \
  --glob '!**/node_modules/**'
```

Expected result:

- zero live source/generated/runtime references; historical architecture text
  may remain explicitly marked superseded.

Additional gates:

```bash
./model/build.sh
cd apps/station/app && go test -race ./subserver/conversation/... ./subserver/envelope/...
cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop
cd apps/desktop && pnpm exec vitest run src/services/im-service.test.ts
```

Dependency:

- W3, W4, and W5.

Merge boundary:

- W3-W6 merge only as one architecture-conformant cutover closure.

### D17-W7 — Deterministic Fault, Security, And Leakage Closure

Responsibility:

- prove D-17 failure semantics before remote runtime claims.

Deliverables:

- every generic receipt/effect/event/outbox write boundary;
- dropped response and exact retry;
- command-ID/hash conflict and concurrent submissions;
- wrong Station/Federation/actor/device/key/kind/hash/epoch;
- temporary versus terminal result classification;
- expiry/token remint, Home/authority restart, queue limits, FIFO/fairness;
- direct remote client-to-authority and typing-through-proposal rejection;
- DB/log/report scans for plaintext, private signer, MLS private state, token,
  and proposal payload leakage.

Evidence:

- `tooling/acceptance/reports/d17-command-proposal-fault-matrix.json`.

Dependency:

- W6.

### D17-W8 — Three-Station Remote Send And C6 Closure

Responsibility:

- prove the accepted architecture on one identical deployed commit.

Deliverables:

- fail-closed preflight verifies identical Station builds;
- provision Alice/Bob/Charlie and isolated Bob2 through product auth;
- remote Bob MLS ciphertext command traverses Desktop Rust, Home Station,
  authority, follower Stations, and recipient OpenMLS decrypt;
- local/remote command event equivalence and exact duplicate proposal replay;
- disconnect/durable resume, reversed event/material, partial ACK, duplicate
  delivery, Desktop restart, follower Station restart, reconnect;
- authority/follower public heads and active client OpenMLS public hashes match;
- removed device/departed actor send/read/decrypt denial;
- secret-free report includes fault schedule, rejections, heads, hashes,
  deployed commit, and leakage results.

Gate:

```bash
make testnet-p5-federation-e2e
PT_C6_DEPLOYED_COMMIT=<exact-commit> \
  make chat-mls-three-station-convergence
```

Evidence:

- `tooling/acceptance/reports/chat-mls-three-station-convergence.json`
  with `status = pass`.

Dependency:

- W7 and one identical deployment on Stations `one`, `two`, and `three`.

## 7. End-To-End Lifecycle Mapping

| Lifecycle | Workstream |
| --- | --- |
| Actor/device bootstrap and signer restore | W2 |
| Local durable command | W1 |
| Remote device sign and Home durable accept | W3-W5 |
| Home forward/token remint | W4 |
| Authority replay/authorization/commit/fan-out | W1/W4 |
| Membership pending Commit accept/discard | W4/W5 |
| Result notification/query/reconnect | W4/W5 |
| Recipient event/material apply and decrypt | retained D13-C3/C4 + W8 |
| Response loss, retry, duplicate, conflict | W1/W4/W7 |
| Queue overload and fairness | W4/W7 |
| Multi-window and process shutdown/restart | W2/W5/W7 |
| Old-path deletion | W6 |
| Three-Station deployment/restart evidence | W8 |

No lifecycle step may bypass the Home Station trust boundary or authority
single-writer service.

## 8. Dependency DAG

```text
Accepted D-17
  ├──> W1 Authority Command Transaction Foundation ──┐
  └──> W2 Actor Device Identity Ownership ──────────┤
                                                    ▼
                                 W3 Proto Hard Cut [atomic closure starts]
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
             W4 Station Proposal Runtime   W5 Desktop Runtime substrate
                         └────────────┬────────────┘
                                      ▼
                             W6 Cutover + Deletion
                           [atomic closure mergeable]
                                      ▼
                             W7 L2 Fault/Security
                                      ▼
                             W8 Three-Station C6
                                      ▼
                             Parent D13-C7
```

Parallelism:

- W1 and W2 run independently.
- After W3 establishes generated contracts, W4 and W5 implementation may
  proceed in parallel, but W5 integration gates consume W4 API semantics.
- W8 harness development may continue in parallel; its runtime claim waits for
  W6/W7 and exact deployment.

## 9. Atomic Cutover Matrix

| Concern | New source | Old path deleted | Cutover proof |
| --- | --- | --- | --- |
| Remote command contract | generic proposal/result | D-14 membership proposal types | proto/generated zero-reference search |
| Authority command durability | generic command UoW + receipt | post-commit `SubmitEvent` durability | write-boundary fault matrix |
| Home retry/result | generic durable outbox/result/inbox | synchronous membership-only forwarder | restart/response-loss tests |
| Device signer | actor device identity | generic signing through `MlsGroupManager` | key continuity + ownership search |
| Desktop submission | generic Conversation Rust command | `mls_submit_membership_transition` | App/Web tests + zero references |
| Historical proposal | canonical command/event | `GroupProposal` / `GroupEvent` acceptance | zero live handlers/contracts |
| Runtime evidence | D17/C6 reports | partial remote-send claim | three-Station PASS report |

Rollback is version/deployment rollback of the whole W3-W6 closure. No permanent
dual path is permitted.

## 10. Status

| Workstream | Status | Evidence |
| --- | --- | --- |
| D17-W1 Authority Command Transaction Foundation | done | Every durable `ConversationCommand`, including membership transitions, requires `command_id`, resolves exact receipt replay/hash conflict before sequence allocation, and atomically commits effects + event + receipt + deterministic inbox/outbox. Exact transition replay returns one canonical event/receipt; transition-ID reuse under another command fails closed. Ordinary and membership every-write-boundary rollback matrices plus Conversation/Envelope race suites pass. |
| D17-W2 Actor Device Identity Ownership | done | Actor-scoped `ActorDeviceIdentity` is the sole durable Ed25519 signer/credential owner; `MlsGroupManager`, native Tauri, and the Desktop Web gateway consume the same shared identity without exporting private key bytes. Existing serialized signer bytes remain field-compatible, wrong/corrupt scope fails closed, and shared-consumer continuity is covered. `cargo test --bin peers-touch-desktop actor_device_identity` passes 3 tests, `cargo test --bin peers-touch-desktop mls_group::tests` passes 16 tests, and the MLS-focused Rust suite passes 26 tests. |
| D17-W3 Proto-First Hard-Cut Contract | done | Model now defines the only D-17 `ConversationCommandProposal`, deterministic signing input, command kind, generic result/reject state, Home submission/result query, authority forward request/response, and addressed result delivery. The command-result envelope QoS is generated for Go, Desktop TS/Rust, and Mobile TS. D-14 membership proposal and retired `GroupProposal` source contracts are deleted. `./model/build.sh` and `./tooling/scripts/proto-gen-mobile.sh` pass; the Mobile generator now skips nonexistent native Android/iOS trees and generates the actual Tauri Mobile TS contract. W3 remains unmergeable until W4-W6 close. |
| D17-W4 Station Generic Proposal And Result Runtime | done | Conversation owns one generic verifier and `conversation-command-proposal` token scope. Home Station persists proposals before forwarding, retries with fresh peer tokens, enforces immutable expiry and bounded global/actor/conversation admission, selects one FIFO item per conversation per fair worker pass, exposes result query, and atomically stores terminal result plus addressed device inbox. Authority and Home routes use only the W3 contract. Conversation/Envelope/Federation race suites pass. |
| D17-W5 Desktop Generic Command And Result Runtime | done | Conversation-owned Rust code deterministically hashes/signs every durable remote command with shared `ActorDeviceIdentity`; native Tauri and Desktop Web register the same submit/result commands. TypeScript assigns command IDs, routes local authority directly and remote authority through Rust, persists Home-accepted IDs, consumes result envelopes, and periodically queries missed results. Membership pending Commit accepts/discards only from exact generic authority results. Targeted TS tests pass 13/13, Rust MLS tests pass 26/26, and targeted diagnostics contain no D-17 errors. The full Rust suite passes 228 tests serially but retains five unrelated Atelier environment-test failures as a repository release non-claim. |
| D17-W6 Atomic Consumer Cutover And Deletion | done | D-14 membership proposal contracts/routes/forwarder/Desktop command and retired `GroupProposal` contracts are deleted with no aliases. Model/Go/Desktop/Mobile generation passes, Station race suites pass, Desktop focused gates pass, architecture integration text is current, and the tree-wide old-symbol/path search returns zero matches. |
| D17-W7 Deterministic Fault/Security Closure | done | `tooling/acceptance/reports/d17-command-proposal-fault-matrix.json` is `pass`. It records every generic authority write-boundary suite, Home exact replay/hash conflict/lost-response recovery, result-inbox rollback, expiry/revocation/signature/hash/kind/field/station rejections, shared peer-token expiry/audience/scope tests, bounded admission, FIFO/fair selection, Desktop result reconciliation, and zero secret/plaintext/token report matches. |
| D17-W8 Three-Station Remote Send And C6 Closure | done | All three Stations run snapshot `6acefbf39526`. `make testnet-p5-federation-e2e` and `PT_C6_DEPLOYED_COMMIT=6acefbf39526 make chat-mls-three-station-convergence` pass. Report `tooling/acceptance/reports/chat-mls-three-station-convergence.json` is `pass`: Bob Station two encrypted and submitted a remote ordinary MLS command through Desktop Rust -> Home -> Station-one authority; Charlie Station three decrypted the canonical committed-event ciphertext. Charlie disconnect/resume, event/material reversal, partial ACK replay, duplicate delivery/proposal, Bob2 Rust restart, and Station-three restart pass. Authority/follower heads match at sequence 7 / membership+MLS epoch 5, Alice/Charlie public MLS hashes match, removed/departed decrypt is denied, and no access token/private-state marker appears. Runtime discovery also corrected ordinary group fan-out to the exact pre-command active device-leaf set, preventing pre-join ciphertext delivery. |

## 11. Final Readiness Gate

D-17 is complete only when:

- W1-W8 gates pass;
- W3-W6 landed as one source-of-truth closure;
- deletion search returns zero live old paths;
- deterministic L2 report passes with no secrets;
- three Stations run one exact commit;
- C6 report is `pass`, includes remote ordinary MLS send/decrypt, fault
  schedule, Station/client public-head equality, and removed-member denial;
- parent D13-C6 status is `done`;
- D13-C7 deletion/readiness closure is `done`.

Repository-wide release readiness additionally requires the existing Desktop
`pnpm run check`, `pnpm run test`, and `pnpm run build` gates. Current unrelated
TypeScript baseline failures remain an explicit non-claim, not a D-17 waiver.

## 12. Risks And Escalation

| Risk | Mitigation / escalation |
| --- | --- |
| Generic UoW cannot share Conversation/Envelope DB safely | `DESIGN_AMENDMENT_REQUIRED`; do not restore post-commit durability |
| Signer extraction rotates existing identity | stop; preserve serialized key bytes and prove continuity |
| Generic result needs a new visible product state | `PRODUCT_AMENDMENT_REQUIRED`; do not invent UI locally |
| Proto cutover cannot be atomic | stop; no compatibility alias or dual path |
| Fair queue semantics require a new scheduler boundary | `DESIGN_AMENDMENT_REQUIRED` |
| Runtime gate sees different Station commits | fail before actor provisioning |
| External deployment owns a Station | do not overwrite; wait or coordinate one common snapshot |
| Full Desktop baseline remains red | report separately; do not claim repository release readiness |

## 13. Non-Claims

- Architecture and plan acceptance are recorded. W1-W7 are implemented and
  verified at their deterministic gates; W8 runtime deployment evidence remains.
- Existing C6 partial report does not prove remote ordinary send or the enhanced
  fault schedule.
- Mobile runtime parity remains the later parent-plan phase.
- Mobile runtime parity remains a later parent-plan phase.

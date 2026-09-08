# Conversation Authority DDD Hard Cut — Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-06 | **Updated**: 2026-09-07
> **Owner**: Architecture Team

---

## 1. Objective

Land the accepted API ownership correction as one debt-free system change:

- rebuild Station Conversation as a real DDD bounded context;
- consolidate one Conversation authority, event log, command receipt, membership
  model, settings model, read cursor, attachment grant, and delivery-intent UOW;
- remove the retired Station Chat facade and every route or caller owned by it;
- move retained Device, Inbox, Recovery, Key Exchange, Attachment, and Federation
  capabilities to their accepted resource owners;
- retain `packages/messaging-core` as the only Desktop/Mobile device protocol engine;
- complete cross-Station Friend Request through shared durable Federation transport;
- restore W9-D Social, then Chat/Contacts, without aliases, dual writes, fallback reads,
  second truth stores, or platform-specific transport silos.

## 2. Accepted Sources

Architecture:

- `docs/architecture/api-ownership/README.md`
- `docs/architecture/api-ownership/design.md`
- `docs/architecture/api-ownership/decisions.md`
- `docs/architecture/api-ownership/data-model.md`
- `docs/architecture/api-ownership/module-layout.md`
- `docs/architecture/api-ownership/integration.md`
- `docs/architecture/messaging-platform/`
- `docs/architecture/federated-social-activity/decisions.md` (`D-07` only;
  accepted while the broader module remains draft)
- `docs/architecture/federated-social-activity/design.md` §4.1
- `docs/architecture/federated-social-activity/integration.md` §7
- `docs/architecture/federation/`
- `docs/architecture/identity/unified-actor-system.md`
- `docs/global/architecture.md`
- `docs/station/app-layer.md`

Accepted decisions:

- `AO-D01`: one semantic capability, one client-facing API owner;
- `AO-D02`: resource-owned APIs; Conversation is the sole Chat entry point;
- `AO-D03`: machine-readable ownership and fail-closed Gate;
- `AO-D04`: atomic route/contract/store/consumer hard cut;
- `AO-D05`: shared domain-neutral Federation transport;
- `AO-D06`: Conversation DDD bounded context;
- `AO-D07`: canonical creation identity, plan-bound group genesis, durable
  remote command transport, one committed event truth, signed Social mutation,
  and exact replay for destructive public-material reads;
- `MP-D09`, `MP-D10`, revised `MP-D30`;
- Federated Social `D-07`.

Product and Acceptance:

- `docs/architecture/messaging-platform/product-definition.md`
- `docs/architecture/messaging-platform/experience-contract.md`
- `docs/architecture/messaging-platform/product-state-model.md`
- `docs/architecture/messaging-platform/acceptance-matrix.md`
- `docs/architecture/mobile/acceptance-matrix.md`
- `docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation.md`

## 3. Scope And Non-Scope

### In Scope

- Model contracts for canonical Conversation, Actor Device, Device Inbox, Recovery,
  Key Exchange, Federation, and Social Friend Request capabilities.
- Station Conversation DDD reorganization and authority consolidation.
- Decomposition and deletion of `apps/station/app/subserver/conversation/engine/`.
- One Conversation authority table family and one migration owner.
- Desktop and Mobile transport path changes while retaining portable Messaging Core.
- Shared durable Federation outbox/inbox/auth/dispatcher extraction.
- Cross-Station Friend Request send, materialization, accept/reject, result return,
  relationship convergence, and post-accept Direct Conversation creation.
- Acceptance contracts, fixtures, fault proxies, route ownership Gate, evidence, docs,
  knowledge, and directory READMEs.

### Non-Scope

- Replacing `packages/messaging-core` or changing accepted Direct/OpenMLS semantics.
- Federation governance-ledger redesign.
- Agent, Applet, Moments, voice/video, or unrelated Mobile work.
- A new protocol/document/package version.
- Production data migration promises beyond the accepted v1 clean-slate policy.
- Compatibility aliases, proxy routes, dual writes, fallback reads, or feature-flag
  coexistence.

## 4. Repository-Backed Current-State Inventory

| Concern | Current evidence | Target disposition |
|---|---|---|
| Conversation package | about 14K lines in a flat package; HTTP, policy, persistence, transition, follower and federation logic cross boundaries | AO-D06 DDD bounded context |
| Conversation authority | `conversation_*` and `messaging_*` services/tables coexist | one Conversation aggregate/UOW/store family |
| Retired Station Chat facade | 30+ routes in one `subserver.go` across authority, identity, inbox, recovery, attachment, federation, typing, receipt | decompose by owner, then delete directory |
| Public route family | multiple Chat, device, key-exchange, and peer route families coexist | resource-owned canonical routes only |
| Device identity | `actor_devices` explicitly owned by Actor identity; old and new enrollment contracts coexist | actor-signed `/device/*` contract only |
| Device inbox | `device_queue_lanes/items` carry Conversation payloads and are consumed by Messaging Core | `/device/inbox/*`, Conversation Delivery owner |
| Recovery | encrypted archive contains Actor Identity, Message History, Attachment Metadata and Trust | dedicated `/recovery/*` owner |
| Attachments | accepted Conversation authority semantics implemented under Messaging route/package | `/conversation/attachments/*` |
| Key exchange | Direct prekey service plus Conversation and Messaging KeyPackage/DKX paths | one `/key-exchange/*` family |
| Federation | Conversation and Messaging peer routes plus Chat-specific outbox/inbox | shared transport + typed Conversation/Social adapters |
| Friend Request | local Social repository and local notification only | receiver-authority cross-Station Social command/event |
| Clients | Desktop/Mobile native adapters call the duplicate facade plus older routes | canonical resource paths; Messaging Core unchanged internally |
| Acceptance | W11 asserts duplicate routes and only denies older friend/group prefixes | semantic owner Gate + retired-route zero-reference |

## 5. Architecture Traceability

| Plan requirement | Product capability/journey | Architecture decision | Required evidence |
|---|---|---|---|
| One public owner per capability | Chat create/list/send/read/delivery/recovery | AO-D01..AO-D04 | ownership registry + AST route report |
| Conversation DDD | all Direct/Group authority journeys | AO-D06, MP-D09 | domain/application/infrastructure/interface tests + import Gate |
| Single Conversation public owner | Desktop/Mobile Chat lifecycle | AO-D02, MP-D10, MP-D30 | tree-wide zero-reference + route manifest |
| Actor-owned device lifecycle | enroll/list/revoke and fresh recovery | AO-D02, MP-D15 | actor proof tests + device readback |
| Reliable device inbox | send/receive/restart/delivery | MP-D02..MP-D05, MP-D13..MP-D14 | queue lease/fencing/replay + native receiver |
| Shared Federation | cross-Station Chat and Friend Request | AO-D05, MP-D19, Social D-07 | outage/retry/dedup/restart evidence |
| Social authority | W9-D Friend Request | Social D-07 | two-Station receiver materialization and convergence |
| Internal Messaging Engine retained | Desktop/Mobile crypto and durable consumption | MP-D01, MP-D16 | portable core tests + both platform adapters |

## 6. Target Execution Closure

Preparation may add target contracts and test-only composition, but may not register a
second production route or store owner. Production cutover occurs once:

```text
complete ownership inventory and Gate
  -> canonical proto contracts generated
  -> Conversation DDD + resource-owner services pass isolated tests
  -> shared Federation + Social adapters pass isolated tests
  -> Desktop/Mobile adapters compile against canonical routes
  -> atomic production registration and consumer switch
  -> delete Station Messaging facade, old flat owners, old proto types/tables/routes
  -> reset disposable v1 data and run full source/runtime Gates
```

Rollback uses source/deployment rollback of the complete cutover. No production branch
contains both route families or both authority stores after the cutover commit.

Execution evidence is written under:

```text
tmp/evidence/api-ownership/<run-id>/CA-W0/
...
tmp/evidence/api-ownership/<run-id>/CA-W7/
```

Every runtime artifact must bind the source commit, workspace ID, worktree digest,
service attestations, runtime identity, cleanup, and secret scan. Earlier Messaging or
Mobile evidence may establish the current-state inventory, but it cannot prove the
post-cutover target.

## 7. Dependency DAG

```text
CA-W0 Ownership inventory and fail-closed Gate
  |
  v
CA-W1 Proto-first canonical contracts
  |
  +----------------------+-----------------------+
  v                      v                       v
CA-W2 Conversation DDD   CA-W3 Resource owners   CA-W4 Shared Federation + Social
  |                      |                       |
  +----------------------+-----------------------+
                         |
                         v
                  CA-W5 Atomic hard cut
                         |
                         v
                  CA-W6 Runtime Acceptance
                         |
                         v
                  CA-W7 Completion audit
```

Parallelism:

- CA-W2, CA-W3, and CA-W4 may proceed in parallel after CA-W1 contracts stabilize.
- Each may register only test composition before CA-W5.
- Desktop and Mobile adapter preparation may run in parallel inside CA-W5, but route
  registration, consumer switch, and old-path deletion close atomically.
- W9-D Social runs before Chat/Contacts.

## 8. Workstreams

### CA-W0: Ownership Inventory And Mechanical Gate

Responsibility:

- Make route, contract, owner, store, and deletion identity executable before code moves.

Deliverables:

- Complete `station-api-capabilities.yaml` for every current and target route under the
  governed prefixes.
- Add `station-api-ownership` using Go AST or handler registry metadata, not regex-only
  semantic inference.
- Add capability ID, domain owner, exposure, proto family, truth store, allowed ports,
  forbidden aliases, and superseded symbols.
- Add import/layer checks for Conversation DDD.
- Update W11 so current duplication fails instead of passing.

Gate:

```bash
python3 tooling/scripts/acceptance-run.py --gate station-api-ownership
python3 tooling/scripts/acceptance-run.py --gate messaging-platform-contract
```

Definition of done:

- Current source fails for the enumerated expected debt only.
- An undeclared route, duplicate capability, owner mismatch, duplicate truth store, or
  forbidden DDD import fails deterministically.

Non-claim: no product behavior or route cutover.

### CA-W1: Proto-First Canonical Contracts

Responsibility:

- Establish one generated contract family before implementation migration.

Deliverables:

- Consolidate Conversation create/list/prepare/submit/membership/settings/read/typing,
  attachment, delivery receipt, and query contracts.
- Move verified actor-device contracts to the Actor/Device contract owner.
- Define Device Inbox, Recovery, Key Exchange, and generic Federation contracts.
- Define typed Social Friend Request command/event/result Federation payloads.
- Reserve removed field numbers and delete superseded Messaging request families in the
  CA-W5 hard cut, never hand-edit generated files.

Gate:

```bash
./model/build.sh
./tooling/scripts/proto-gen-mobile.sh
```

Definition of done:

- Desktop, Mobile, Station, and portable Messaging Core generated bindings agree.
- Contract catalog maps each request/response to one capability ID.

Non-claim: generated contracts alone do not authorize production route registration.

### CA-W2: Conversation DDD Bounded Context

Responsibility:

- Build the single professional Station owner for Conversation authority.

Deliverables:

- Domain aggregate for lifecycle, membership, roles, member devices, authority head,
  membership/MLS epochs, settings, and command transition invariants.
- Value objects for IDs, sequence, hashes, roles, epochs, endpoint commitments, and
  idempotency identities.
- Domain events and typed errors independent of HTTP, GORM, and generated transport.
- Application command/query services and repository/UOW/device-inbox/federation/identity/
  object-store ports.
- Infrastructure persistence with explicit GORM columns/TableName and one transaction
  owner for aggregate state, events, receipts, inbox intents, and outbox intents.
- Interface adapters containing authentication-bound mapping only.
- Test-only composition proving parity for create/list/send/group/membership/settings/read,
  follower convergence, leave intent, command proposal, and public-head behavior.

Deletion obligation at CA-W5:

- flat `service_impl.go`, `repository.go`, `transition_*`, handler business logic, and any
  superseded follower/proposal owners;
- Messaging authority application/repository/UOW code after semantics move to DDD.

Gates:

```bash
(cd apps/station && go test -race -count=1 ./app/subserver/conversation/...)
./tooling/scripts/check-go-style.sh
```

Definition of done:

- Domain has zero imports of HTTP, GORM, Station frame adapters, or generated API types.
- Every command transition is aggregate-validated and transactionally persisted once.

### CA-W3: Resource-Owner Services

Responsibility:

- Move non-Conversation resources out of the Station Messaging facade without creating
  new business silos.

Independent closures:

1. Actor Identity: actor-signed `/device/enroll`, list, revoke over `actor_devices`.
2. Conversation Delivery: `/device/inbox/claim|ack|reject`, lane fencing, retry and
   dead-letter through Conversation ports.
3. Recovery: `/recovery/revision|latest`, opaque bounded archives, no plaintext/live
   crypto state.
4. Key Exchange: `/key-exchange/*` for Direct bundles, MLS KeyPackages, and DKX.
5. Conversation Attachments/Interactions: `/conversation/attachments/*`, typing, read
   cursor, and delivery receipt under Conversation policy.

Failure behavior:

- stale device proof, lease fencing, duplicate part, corrupt archive, stale KeyPackage,
  unauthorized grant, and overload all fail before forbidden mutation.

Definition of done:

- Each service has one store owner, typed port, handler owner, and focused tests.
- No service imports Station Messaging business services.

### CA-W4: Shared Federation And Cross-Station Social

Responsibility:

- Extract reliability mechanics once and bind typed domain adapters.

Deliverables:

- Domain-neutral authenticated Federation frame, outbox, inbox, lease dispatcher, retry,
  dedup, hash-conflict rejection, and typed receiver registry.
- Conversation adapter for authority command, device delivery, endpoint manifest,
  KeyPackage claim, leave intent, sync, and attachment data plane.
- Social Friend Request command/event/result adapter with receiver Home Station authority.
- Same-Station local adapter invoking the same domain receiver.
- Atomic Social command/outbox and request-state/result-outbox transactions.

Gates:

```bash
(cd apps/station && go test -race -count=1 ./frame/core/federation/... ./app/subserver/social/... ./app/subserver/conversation/...)
```

Definition of done:

- Outage, duplicate, restart, hash conflict, wrong source Station, expired manifest, and
  accept/reject return are deterministic and bounded.

### CA-W5: Atomic Production Hard Cut

Responsibility:

- Switch all production owners and consumers exactly once.

Priority prerequisite:

- `CA-W5-P0 Donor Reconciliation` is the first dependency-ready CA-W5 task.
- Treat Draft PR `#107` and donor commit
  `3d4e858ce0c8e28969e01a736e2b238269aedb3b` as read-only evidence from
  `peers-social`; do not merge the branch or cherry-pick the commit.
- Semantically compare and port only the unique Conversation query slice:
  `application/query/service.go`, `application/query/service_test.go`,
  `domain/repository/repository.go`,
  `infrastructure/persistence/repositories.go`,
  `infrastructure/persistence/repositories_query_test.go`,
  `infrastructure/persistence/schema.go`, and
  `interface/http/client_adapter.go`.
- Reconcile the donor behavior against the accepted AO-D07 contract and the
  current production composition. The canonical `peers-group-chat` contract,
  ownership, persistence, and error semantics win every divergence.
- Record the donor's 105-file `conversation/engine/` deletion as the final
  CA-W5 deletion manifest. Apply deletions only after replacement production
  composition has no live imports or behavior dependency.
- Reject donor generated bindings, protected `agent.pb.go`, divergent AO-D07
  documents, and overlapping Desktop/Mobile/Messaging Core implementations.
  Regenerate bindings only from canonical Proto sources in this worktree.
- Complete the focused Conversation query/persistence/HTTP tests and a
  zero-duplicate semantic review before resuming the broader CA-W5 cutover.

Deliverables:

- Register canonical Conversation, Device, Inbox, Recovery, Key Exchange, and Federation
  routes.
- Implement the accepted AO-D07 wire contract as one proto-first consumer cut:
  caller-owned creation/request identities, plan-bound group genesis, one
  local-or-signed command route, `ConversationEvent` as the sole committed
  event, signed Social mutation, and exact destructive-read replay.
- Require Direct creation and Social Friend Request commands to carry the explicit
  `federation_id` used for Home Station membership validation; no implicit or default
  Federation selection is permitted.
- Migrate every Desktop/Mobile transport, Tauri command, Harness, fixture, fault proxy,
  capability contract, and readback query.
- Switch persistence to the canonical Conversation authority and resource-owner stores.
- Delete every route/caller from the retired Station Chat facade,
  `messaging_api.proto` superseded messages, duplicate authority tables, and old flat
  Conversation owners.
- Regenerate all bindings and reset only approved disposable v1 databases/profiles.

Atomic rule:

```text
new routes + new owners + all consumers + old deletion + ownership Gate = one cutover
```

No route redirect, compatibility handler, dual write, fallback read, or mixed production
feature flag is permitted.

### CA-W6: Runtime Acceptance

Responsibility:

- Prove user-visible and durable behavior on the canonical sources.

Execution order:

1. Static ownership/DDD/proto/source gates.
2. Station Conversation, Device, Recovery, Key Exchange, Federation, Social tests.
3. Portable Messaging Core plus Desktop/Mobile adapter tests/builds.
4. Two-Station Chat outage/retry/restart and native receiver proof.
5. W9-D Social Friend Request proof.
6. Only after Social passes, W9-D Chat/Contacts.

Required evidence:

- source/worktree digest, canonical route manifest, store schema inventory, aggregate/UOW
  transaction readback, two Station attestations, both client projections, cleanup, and
  secret scan.

### CA-W7: Completion, Documentation, And Knowledge Audit

Responsibility:

- Prove the change has no remaining architecture debt.

Deliverables:

- Zero-reference reports for the retired Station Chat facade, superseded proto types,
  duplicate authority tables, and replaced flat Conversation owners.
- Updated Messaging, Federated IM, Social, Station, Desktop, Mobile, Acceptance, and
  directory README sources in the same change.
- Operational knowledge pitfall recording how implementation-shaped API namespaces and
  prefix-only Gates allowed the split-brain.
- `pt-acceptance-gap-detector`, `pt-quality-check`, and `pt-completion-auditor` reports.

Definition of done:

- One public owner, one contract, one truth store, one DDD authority, no shim, and current
  source-bound runtime proof.

### 8.1 Workstream Execution Contracts

Commands named below are target entrypoints. CA-W0 must register any missing Gate before
that command can be used as evidence.

| Workstream | Required commands or audits | Evidence path | Done / non-claim |
|---|---|---|---|
| CA-W0 | `python3 tooling/scripts/acceptance-run.py --gate station-api-ownership`; `python3 tooling/scripts/acceptance-run.py --gate messaging-w11` | `CA-W0/` registry, discovered-route, owner/store, and DDD-import reports | Current debt fails only by enumerated target deletions; no product claim |
| CA-W1 | `./model/build.sh`; `./tooling/scripts/proto-gen-mobile.sh` | `CA-W1/` descriptor digests and generated-binding comparison | One canonical contract family; no route or runtime claim |
| CA-W2 | `(cd apps/station && go test -race -count=1 ./app/subserver/conversation/...)`; `./tooling/scripts/check-go-style.sh` | `CA-W2/` aggregate, UOW, repository, import, and parity reports | Conversation transitions and persistence are DDD-owned; no production cutover claim |
| CA-W3 | `(cd apps/station && go test -race -count=1 ./app/subserver/actor_identity/... ./app/subserver/recovery/... ./app/subserver/key_exchange/... ./app/subserver/conversation/...)` | `CA-W3/` device, inbox, recovery, key-exchange, attachment, and receipt reports | Resource owners pass focused tests; no old-path deletion claim |
| CA-W4 | `(cd apps/station && go test -race -count=1 ./frame/core/federation/... ./app/subserver/social/... ./app/subserver/conversation/...)` | `CA-W4/` outbox/inbox, retry, dedup, auth, and Social result-return reports | Shared transport and typed adapters pass fault tests; native convergence remains unproven |
| CA-W5 | `./model/build.sh`; `./tooling/scripts/proto-gen-mobile.sh`; `(cd apps/station && go test ./...)`; `(cd apps/desktop && pnpm run check && pnpm run test && pnpm run build)`; `pnpm mobile:check`; both ownership Gates | `CA-W5/` route, caller, symbol, schema, consumer, and build reports | Production source has one route/store/owner family and zero compatibility path |
| CA-W6 | `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-social-convergence-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-chat-contacts-e2e`; target native cells from the accepted matrices | `CA-W6/` immutable Acceptance runs and runtime attestations | Social passes before Chat/Contacts; static or simulator evidence does not prove physical cells |
| CA-W7 | `pt-acceptance-gap-detector`; `pt-quality-check`; `pt-completion-auditor`; tree-wide zero-reference checks | `CA-W7/` gap, quality, completion, docs, and knowledge reports | Final readiness is reviewable; missing runtime evidence remains `UNPROVEN` |

## 9. End-To-End Lifecycle Mapping

| Lifecycle | Workstreams |
|---|---|
| Device enroll/revoke -> endpoint eligibility | W1, W3, W5, W6 |
| Direct create -> prepare -> submit -> authority event -> device inbox -> ACK | W1, W2, W3, W5, W6 |
| Group genesis/membership -> MLS delivery -> restart | W1, W2, W3, W4, W5, W6 |
| Typing/read/delivery receipt | W2, W3, W5, W6 |
| Attachment begin/chunk/complete/grant/download/resume | W1, W2, W3, W4, W5, W6 |
| Recovery put/latest -> fresh device restore | W1, W3, W5, W6 |
| Cross-Station outage -> retry -> duplicate -> restart | W2, W4, W5, W6 |
| Friend Request send -> receiver pending -> accept/reject -> relationship -> Direct | W1, W2, W4, W5, W6 |
| Shutdown/cleanup -> no leases, sessions, ports, or stale evidence | W3, W4, W6, W7 |

## 10. Atomic Cutover And Deletion Matrix

| Replaced concern | New source | Cutover condition | Required deletion proof |
|---|---|---|---|
| Flat Conversation authority | Conversation DDD aggregate/application/UOW | parity tests and canonical route composition pass | replaced flat services/repos/handlers zero |
| Duplicate Conversation authority | Conversation DDD | modern send/group/federation behavior passes | `messaging_*` authority services/tables zero |
| Duplicate Conversation business routes | `/conversation/*` | Desktop/Mobile adapters pass | retired route/caller/type zero |
| Legacy device enrollment surfaces | Actor Identity `/device/*` | cross-signed lifecycle passes | old handlers/types zero |
| Retired per-device queue surface | `/device/inbox/*` | lease/fencing/replay passes | old route/caller zero |
| Retired recovery surface | `/recovery/*` | valid/corrupt/restart passes | old route/store owner zero |
| Retired attachment surface | `/conversation/attachments/*` | resumable/grant/corruption passes | old route/caller zero |
| Mixed typing and receipt surface | Conversation typing/read/delivery routes | convergence passes | mixed receipt API zero |
| Business-owned peer routes | `/federation/*` typed adapters | two-Station fault matrix passes | old peer routes/transports zero |
| `/keypackage/*`, `/dkx/send` | `/key-exchange/*` | Direct/MLS bootstrap passes | old route/type zero |
| local-only Friend Request | Social + shared Federation | W9-D Social passes | no Social-specific transport stack |

## 11. Acceptance Scenarios

### CA-AS01: Canonical Direct Conversation
- **Precondition**: Alice and Bob have active verified devices.
- **Action**: Alice creates/reopens Direct, sends exact plaintext, Bob replies.
- **Expected**: One Conversation ID, ordered events, per-device inbox rows, exact visible
  plaintext, post-commit ACK, and one canonical Conversation route family.
- **Failure variant**: timeout retains the exact durable command and produces one event.
- **Evidence**: HTTP trace, Station rows, Engine markers, both native projections.
- **Status**: pending

### CA-AS02: Group Genesis And Membership
- **Precondition**: Three actors across two Stations with active MLS devices.
- **Action**: Create group, add/remove/rejoin a device, send after each transition.
- **Expected**: One aggregate sequence, epoch continuity, correct Welcome/retirement, no
  visible epoch-zero group.
- **Failure variant**: stale/expired plan commits zero shared mutation.
- **Evidence**: aggregate events, inbox/outbox rows, native exact plaintext.
- **Status**: pending

### CA-AS03: Device Identity And Inbox Fencing
- **Precondition**: Actor has two devices and one stale consumer lease.
- **Action**: Enroll, claim, ACK/reject, revoke, then attempt stale ACK and future send.
- **Expected**: actor-signed identity, one monotonic lane, stale consumer rejected, revoked
  device receives zero future items.
- **Failure variant**: invalid signature/profile version and lease mismatch fail closed.
- **Evidence**: Actor store, lane rows, typed responses, client projections.
- **Status**: pending

### CA-AS04: Recovery And Restart
- **Precondition**: Existing history/attachments/trust and fresh install.
- **Action**: Store revision, restart, restore, enroll fresh device, continue messaging.
- **Expected**: history restored, live crypto excluded, fresh device identity established.
- **Failure variant**: wrong phrase, corrupt archive, timeout, and cancellation preserve the
  prior valid state.
- **Evidence**: revision hash, SQLCipher readback, device identity, native UI.
- **Status**: pending

### CA-AS05: Attachment Interruption
- **Precondition**: Authorized Direct and Group conversations.
- **Action**: Upload/download with interruption, restart, duplicate chunk, and cancel.
- **Expected**: missing chunks resume, immutable grant remains Conversation-owned, exact
  bytes render only after full validation.
- **Failure variant**: conflicting chunk, wrong ETag, unauthorized actor, and integrity
  failure expose no plaintext and do not ACK.
- **Evidence**: transfer checkpoints, grant rows, hashes, receiver file.
- **Status**: pending

### CA-AS06: Federation Outage And Duplicate
- **Precondition**: Two source-bound Stations.
- **Action**: Submit Chat command during outage, restart dispatcher, inject duplicate and
  same-ID/different-hash frame.
- **Expected**: exact retry converges once; hash conflict is rejected before mutation.
- **Failure variant**: wrong source/target/manifest remains retryable or terminal by type.
- **Evidence**: outbox/inbox rows, attempts, target projection, typed error.
- **Status**: pending

### CA-AS07: Cross-Station Friend Request
- **Precondition**: Alice and Bob have different Home Stations.
- **Action**: Alice sends; Bob sees pending and accepts; repeat separately with reject.
- **Expected**: receiver authority owns decision, result returns durably, both relationship
  projections converge, accepted path creates/reuses one Direct Conversation.
- **Failure variant**: outage, timeout, duplicate, malformed signature, and cancellation
  never fabricate receiver materialization or relationship success.
- **Evidence**: both Social stores, Federation rows, Conversation ID, both clients.
- **Status**: pending

### CA-AS08: Hard-Cut Absence
- **Precondition**: Target source and clean disposable database.
- **Action**: Enumerate handlers, generated contracts, schemas, callers, docs, and Gates.
- **Expected**: the retired Station Chat facade, duplicate authority stores, and
  superseded flat owners have zero live references. Canonical journeys still pass.
- **Failure variant**: any alias, fallback, undeclared route, or missing evidence fails.
- **Evidence**: ownership report, tree scan, schema inventory, Acceptance report.
- **Status**: pending

## 12. Required Verification

```bash
./model/build.sh
./tooling/scripts/proto-gen-mobile.sh
./tooling/scripts/check-go-style.sh
(cd apps/station && gofmt -l . && go test ./...)
(cd apps/desktop && pnpm run check && pnpm run test && pnpm run build)
pnpm mobile:check
python3 tooling/scripts/acceptance-run.py --gate station-api-ownership
python3 tooling/scripts/acceptance-run.py --gate messaging-platform-contract
python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-social-convergence-e2e
python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-chat-contacts-e2e
```

Final target/native cells remain governed by the Messaging and Mobile Acceptance
matrices. Local/static success cannot replace native receiver proof.

## 13. Workstream Status

| Workstream | Status | Evidence |
|---|---|---|
| CA-W0 Ownership inventory and Gate | done | The registry declares 61 retained capabilities and classifies all 65 current governed routes; undeclared routes are zero. Four routes without a target role are explicit deletion obligations. The AST Gate enforces route ownership, canonical proto symbols, target-absent stores, and four registry-driven Conversation DDD import layers, with focused tests covering deterministic failure. Source-bound ownership run `20260906T033402732484Z-ee421c3782b56b551a1c0e828d5a67c8` fails closed with 84 downstream target-debt diagnostics only: 4 forbidden routes, 23 owner-root mismatches, 20 missing canonical proto symbols, 20 superseded proto symbols, and 17 forbidden truth-store identifiers. Source-bound `messaging-platform-contract` run `20260906T033402732485Z-5b16e97d8f829f252e20b7b7c1492ef0`, Gate race tests, and Gate `go vet` pass. |
| CA-W1 Proto-first canonical contracts | done | Canonical Actor Device, Device Inbox, Recovery, Key Exchange, generic Federation, Social Friend Request, and Conversation preparation/read/typing/receipt contracts are defined and generated for Station Go, Desktop TypeScript/Rust, Mobile TypeScript, and portable Messaging Core Rust. The catalog maps 61 capabilities to 122 unique request/response symbols with zero missing canonical symbols or registry-invalid diagnostics. Exact-index generation passed with sorted descriptor SHA-256 `18ed449617ce3a06e0dbc13eb5cb9705344d88326c36441c9cc25babc7fffe1c`; 30 generated artifacts reproduce exactly, and new TypeScript outputs are newline-stable. Exact-index focused Station packages, Messaging Core (30 unit + 2 integration tests), Mobile Rust, Desktop Rust library, Social wire/runtime boundaries, and 14 `messaging-platform-contract` tests pass. The exact-index ownership Gate fails closed only on 148 enumerated CA-W2..CA-W5 debts: 4 forbidden routes, 17 forbidden truth-store identifiers, 23 owner-root mismatches, and 104 superseded proto symbols. Full Mobile TypeScript is blocked by the pre-existing `StationIdentityResult.verifiedAt` mismatch; Desktop full checks remain blocked by unrelated Agent/OAuth/OSS source failures. No production route or store cutover is claimed. |
| CA-W2 Conversation DDD bounded context | done | Conversation now has a test-only Station DDD composition with aggregate, entity, value-object, domain-event, typed-error, repository/UOW, application command/query, persistence, delivery, identity, Federation, and HTTP-mapping boundaries. Focused tests cover deterministic event hashes and optional-field presence, exact accepted/terminal-rejected command replay, authenticated forwarded replay and key-state admission, authority plans, exact delivery commitments, membership/MLS epochs and retirement, delegated leave, follower buffering/convergence/fork rejection, settings/read cursors, aggregate rehydration, PostgreSQL timestamp precision, schema keys, and post-commit notification. `(cd apps/station && go test -race -count=1 ./app/subserver/conversation/...)`, focused `go vet`, `./tooling/scripts/check-go-style.sh`, Desktop/Mobile generated-TypeScript compilation, and isolated proto regeneration pass. Isolated `HEAD + CA-W2-only` tree `faf1879f9f54af6cfa814d2a2d1d4844f8586602` passes the full Conversation race suite; independent command/security, persistence, aggregate, follower, timestamp, and query reviews found no remaining blocker. The ownership Gate fails closed only on the same 148 enumerated CA-W3..CA-W5 debts: 4 forbidden routes, 17 forbidden truth-store identifiers, 23 owner-root mismatches, and 104 superseded proto symbols, with no missing DDD layer or forbidden DDD import. The PostgreSQL runtime test is registered but skipped when `MESSAGING_TEST_POSTGRES_DSN` is absent. No production handler, route, store, consumer, or runtime cutover is claimed before CA-W5. |
| CA-W3 Resource-owner services | done | Actor Identity, Recovery, Key Exchange, Conversation Device Inbox, attachments, interactions, and delivery receipts now have typed owner ports and test-only composition without Station Messaging imports. Device Inbox claims advance a consumer epoch for every lease attempt; stale ACK/reject cannot mutate a reclaimed item. Attachment mutations revalidate Conversation membership and Actor Identity device state inside the owning SQL transaction, actor/message quota admission is serialized, grants commit as one exact batch, verification uses an exclusive bounded lease, and cleanup reclaims expired uploads/parts/verification blobs and unattached objects with fenced retries. The Conversation authority persists the exact per-endpoint delivery commitment set atomically with each event and derives delivery status from authority receipts, excluding originator synchronization markers without fabricating remote queue rows. The exact CA-W3 race command, focused `go vet`, `gofmt`, `git diff --check`, and Go style pass. PostgreSQL contention coverage is registered but remains `UNPROVEN` because `MESSAGING_TEST_POSTGRES_DSN` is absent. No production route/store cutover or old-path deletion is claimed before CA-W5. |
| CA-W4 Shared Federation and Social | done | Shared Federation supplies authenticated frames, durable outbox/inbox leases, retry/dedup/hash-conflict behavior, typed Conversation and Social receivers, and same-Station loopback. Conversation command conflicts return durable authority results bound to the originating command SHA-256; remote Device Inbox lane sequence remains target-owned. Social enforces receiver-local block/existing-relationship policy, atomically persists command/projection/result-outbox state, binds results to exact outgoing command bytes, rejects retryable result frames before durable resolution, and resolves remote actor keys from PTID plus a pinned Home Station profile/locator chain rather than `ActorRef.acct`; cached remote keys are revalidated against the latest signed active-key profile. The exact CA-W4 race command, focused `go vet`, `gofmt`, `git diff --check`, Go style, and `messaging-platform-contract` run `20260906T204614333077Z-6c52a4241e67fb14b3a0663a346aa7a5` pass. Two independent post-fix reviews report zero P0/P1 findings. Live DHT/Relay two-Station convergence remains `UNPROVEN` until CA-W5 production composition and CA-W6 runtime Acceptance. |
| CA-W5-P0 Donor reconciliation | done | `peers-social` remained a read-only donor. The unique Conversation query/persistence/HTTP behavior was reconciled semantically into `peers-group-chat`; divergent contracts, generated bindings, and overlapping Desktop/Mobile/Messaging Core code were rejected. The retired 105-file `conversation/engine/` tree is deleted, and the final source contains no duplicate engine owner. |
| CA-W5 Atomic production hard cut | source checkpoint ready / runtime unproven | AO-D07 is implemented proto-first across Station, Desktop, Mobile, and portable Messaging Core. Canonical Conversation production composition now owns creation, commands, event truth, follower recovery, attachment control/data forwarding, and Device Inbox effects; Key Exchange owns local reservation and exact-replay irreversible remote KeyPackage claims; shared Federation owns authenticated route/relay transport. Retired Envelope, flat Conversation, engine, superseded proto, generated bindings, callers, stores, aliases, and fallbacks are deleted. `proto-build` run `20260907T095814186121Z-b39852f3e6f655416a20f3194dc3699d`, `station-api-ownership` run `20260907T095552389681Z-9035a2fbed82ec5a54b98f5b260fe383`, `station-messaging-unit` run `20260907T095534375916Z-3761b27ef989ec4449bf94b82a4a2523`, `messaging-platform-contract` run `20260907T095650555959Z-0f85322adf5c78105d9ca8f15a4a351b`, `desktop-check` run `20260907T095738644264Z-aa04882b997b2eeb5f7e9b2001600a10`, and `chat-native-visible-static` run `20260907T100757881125Z-070fde35dba471e1da0351dc8d030cb0` pass. Focused Station race/vet, Desktop 540 tests and build, Desktop Rust library check, Mobile full check, Messaging Core 104+2 tests, Go style, and diff checks pass. The Gap Detector correctly keeps product proof `UNPROVEN` until the CA-W6 native receiver gates run. Repository-wide Station tests also contain unrelated pre-existing Frame/vendor failures and live `:18080` tests; they do not establish CA-W6 runtime proof. |
| CA-W6 Runtime Acceptance | in progress / Direct create-reopen, Group preparation, and canonical Group dispatch runtime-proven; genesis sender delivery correction locally proven | Windows Product Closure run `20260908T044521277951Z-0fc6d8073736d98fc571117a45f01feb` at exact source `1824138a83d25dba08a2e2a823c1778b3cf34a90`, binary SHA-256 `82d73b98ffe9b67b4bdad9534f67f27271d98fe6ae258a83d690f26df119f19b`, proved distinct Station binding, Direct create/reopen, committed Group selection, signed-route Group preparation, and canonical `/conversation/group` dispatch. Station returned 400 because genesis marks Alice and Bob as added endpoints while the delivery mapper demanded a Welcome for Alice before recognizing her as the sender. The local correction preserves removed-sender retirement precedence and handles the sender public marker before added-endpoint Welcome delivery. The focused pre-fix regression fails with the exact missing-Welcome error and passes after correction; the interface HTTP race suite and the approved local Chat Gates pass. Runtime cleanup is `DONE/PROVEN`; complete Product Closure and PostgreSQL contention remain `UNPROVEN`. |
| CA-W7 Completion/docs/knowledge audit | pending | — |

## 14. Risks And Escalation

- Any need for a production compatibility interval returns to DESIGN.
- Any undefined aggregate invariant, retry/result state, recovery scope, or Federation
  authentication rule returns to DESIGN.
- Any product-visible behavior change outside accepted Chat/Social journeys returns to
  PRODUCT.
- Existing dirty work must be semantically reconciled, never reset or overwritten.
- Shared `:18080` Station reset remains forbidden.
- Missing source-bound runtime evidence remains `UNPROVEN`.

## 15. Final Readiness Gate

`PLAN_COMPLETE` requires:

1. CA-W0 through CA-W7 are done with current source-bound evidence.
2. All CA-AS01 through CA-AS08 pass.
3. W9-D Social passes before Chat/Contacts.
4. The retired Station Chat facade, duplicate authority stores, superseded contracts,
   and replaced flat Conversation owners have zero live references.
5. Conversation DDD layer/import/transaction Gates pass.
6. No compatibility shim, dual write, fallback read, mock business API, stale evidence,
   or undeclared route remains.

Plan state: `PLAN_APPROVED`. CA-W0 through CA-W5 have a committed source
checkpoint. The CA-W6 MP-D19 and Desktop Direct projection-role corrections are
committed and exact-source Windows evidence now proves deterministic Direct
create/reopen and committed Group selection. The next `group.create.ui` failure
is isolated to loss of the canonical Federation ID in the Desktop local
Conversation projection; its owner-layer correction is locally verified in the
current source checkpoint and awaits exact-source deployment plus rerun. AO-D07 has one generated
wire contract, one Conversation production owner, resource-owned
Actor/Recovery/Key Exchange services, shared Federation transport, migrated
Desktop/Mobile consumers, and zero legacy Messaging/Envelope/engine ownership
diagnostics. CA-W6 runtime proof and CA-W7 remain open. The Acceptance Gap
Detector keeps completion `UNPROVEN` because the required native
receiver/runtime cells have not passed against the corrected source. Production
two-Station convergence, complete Windows native receiver behavior, and
PostgreSQL contention evidence remain `UNPROVEN`; the source checkpoint does
not substitute for those runtime gates.

CA-W6 rerun
`20260908T013805491929Z-5d8f7a0c6d64aec300b72900a1ecd09c`
at exact source `4ff3f78fb4c6a437aa6b1ed645dabab57ca9b57e`
proves the Federation projection correction and advances Group submission to
`POST /conversation/group/prepare`. The 400 response exposed the next Station
boundary: Group preparation and KeyPackage reservation discarded the existing
signed MP-D19 route snapshot and queried the local-only Actor Device table for
remote Bob. The local correction now carries server-derived verified routes
through plan preparation, KeyPackage reservation, same-snapshot response, and
fresh create-time validation. The plan binds both complete signed-manifest
bytes and stable directory state; exact replay precedes plan and network
access; Group create derives name and membership solely from the persisted
plan.

Full Conversation and Key Exchange tests, race suites, focused `go vet`, Go
style, and diff checks pass. Local aggregate
`20260908T032102443647Z-880042c6a33915570b610c7a94d90718`
passes `station-messaging-unit`, `messaging-platform-contract`,
`desktop-check`, and `chat-native-visible-static`; conditional
`station-api-ownership`
`20260908T031556440970Z-1defc692da62374b13b9c5e23f453da2`
also passes. Independent final seam review found no P0/P1 issue. Gap Detector
`20260908T032208866291Z-5c6df6dd6c62ef049d94c8a0f8ef78ac`
keeps Product Closure `UNPROVEN`; cleanup is `DONE/PROVEN`.

CA-W6 rerun
`20260908T033256775430Z-34b2f520c4d47ab9351c6a41bb592255`
at exact source `018491a013277a1bea1d5ba50d7fd3a3aaa75203`,
Windows binary SHA-256
`9db85704bdbdec5432df9798e056c9c1fdd27d89fc2c1aa8426e28a82a2f4092`,
proves the signed Group route preparation and complete cleanup. The first
failure remains `group.create.ui`: after `/conversation/group/prepare` returns
200, Desktop Rust submits the prepared epoch-zero Group command to
`/conversation/command`. The ordinary route returns an HTTP 200 typed
rejection, so PostgreSQL retains the authority plan in `prepared` state and has
no Group Conversation row or command receipt.

The local Desktop transport correction now dispatches only that epoch-zero,
authority-plan-bound membership transition to canonical
`POST /conversation/group`. Ordinary commands and established membership
transitions remain on `POST /conversation/command`; canonical command bytes and
response identity are checked before the durable outbox marks submission
complete. Desktop Rust production check, the four approved local Chat Gates,
and `station-api-ownership` pass at the current working tree. The binary Rust
unit-test target remains blocked before execution by unrelated pre-existing
Auth test-only compile failures. Product Closure and dependent Windows Gates
remain `UNPROVEN` pending checkpoint commit, exact-source deployment, and the
Product Closure-only rerun.

The next exact-source Product Closure run
`20260908T044521277951Z-0fc6d8073736d98fc571117a45f01feb`
proves the Desktop route correction by reaching `POST /conversation/group`.
Station returns 400 before commit because the Group genesis delivery mapper
checks the added-endpoint branch before the sender branch. Since the genesis
plan correctly classifies every post-state endpoint as added, the mapper
incorrectly demands an MLS Welcome for Alice. The client intentionally creates
Welcomes only for the other prospective endpoints.

The local fix keeps removed-sender retirement first, then maps the sending
endpoint to its public event marker before handling other added endpoints as
MLS Welcome recipients. A focused regression reproduces the pre-fix
`welcome_payloads: does not cover every added endpoint` failure and passes after
the reorder. The Conversation HTTP race suite and the approved local Chat
matrix pass. Product Closure and dependent Windows Gates remain `UNPROVEN`
pending a new exact-source checkpoint and rerun; cleanup from the failed run is
`DONE/PROVEN`.

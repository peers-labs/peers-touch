# Phase 1: Federation Ledger — Formal Execution Plan

> **Status**: ready-for-execution
> **Version**: v1.0
> **Created**: 2026-07-21 | **Updated**: 2026-07-21
> **Owner**: Architecture Team
> **Architecture Sources**: design.md (v0.2), data-model.md (v0.2), wire-protocol.md (v0.1), decisions.md, integration.md

---

## 1. Architecture Traceability

| Plan requirement | Architecture source | Decision/invariant | Required evidence |
|---|---|---|---|
| Proto wire contracts for all governance messages | wire-protocol.md §4, §5, §12 | D-01, D-04 | `./model/build.sh` passes; canonical bytes conformance test |
| Federation genesis lifecycle | design.md §5.1; wire-protocol.md §7.4 | D-01 | Integration test: create federation → genesis event persisted |
| Active sequencer ordering | design.md §3.4; wire-protocol.md §5.3 | D-07 | Non-sequencer append rejected; proposal accepted |
| Ledger event hash chain | wire-protocol.md §2; data-model.md §3 | D-04 | Cross-Station replay produces same head_hash |
| Signature verification | wire-protocol.md §3 | D-04 | Invalid signature → event rejected |
| Fork detection | design.md §3.4; wire-protocol.md §6.5 | D-07 | Injected fork → fork_detected state |
| Ledger sync (pull + notify) | wire-protocol.md §6 | D-04 | 3-node sync: all nodes reach same head |
| Projection API for clients | wire-protocol.md §5.5 | D-05 (superseded) | Settings/Dashboard can list federations and capabilities |
| Catalog scoped by federation_id | design.md §6; wire-protocol.md §8.2 | D-08 | Catalog search requires federation_id |
| Governance in app layer, not frame | integration.md §1; design.md §2.1 | D-10 | `go vet` shows no frame→app imports |
| Testnet seed | data-model.md §11 | D-04 | 3-node seed produces verified genesis |

---

## 2. Current-State Inventory (Federation-specific)

### 2.1 Already Exists (DO NOT REBUILD)

| Asset | Location | Status |
|---|---|---|
| Federation auth/keys (Ed25519) | `frame/core/auth/federation/` | Production-ready, 13 files |
| libp2p federation plugin | `frame/core/plugin/native/federation/` | Production-ready, 17 files |
| Touch layer: resolver, cache, profile, invalidation, republisher | `frame/touch/federation/` | Production-ready, 16 files |
| HTTP handlers: /me, /health, /resolve, /visibility, /profile | `frame/touch/` | Production-ready |
| Proto: federation_self, federation_health, federation_resolve, locator, profile, invalidation | `model/domain/federation/` | 6 existing .proto files |
| Desktop: store, runtime, FederationTab, Rust commands | `apps/desktop/` | Working |
| Acceptance gates | `tooling/acceptance/gates/federation/` | Smoke + mutual validation |
| Locales | `packages/locales/{en,zh-CN}/settings.json` | Working |

### 2.2 Does NOT Exist (TO BUILD)

| Asset | Target Location |
|---|---|
| Governance proto files (ledger, service, sync, projection) | `model/domain/federation/` (new files) |
| Federation subserver (app layer DDD) | `apps/station/app/subserver/federation/` |
| Database migrations (ledger, membership, roles, sync) | `apps/station/app/subserver/federation/migration/` |
| Ledger sync protocol implementation | Within federation subserver |
| Projection API handlers | Within federation subserver |
| FederationSelfView extension | Extend existing proto + handler |
| Catalog federation_id scoping | Extend existing Catalog proto |
| Desktop Settings: joined federations list | Extend FederationTab.tsx |
| Dashboard: federation management panel | Within dashboard subserver |
| Testnet seed configuration | `apps/station/app/conf/` + seed scripts |

---

## 3. Responsibility Workstreams

### WS-1: Proto Contracts

**Responsibility**: Define all wire-format messages for governance layer.

- **Current assets**: 6 existing proto files (untouched, only extended).
- **Target deliverables**:
  - `federation_ledger.proto` — LedgerEvent, EventHashInput, all typed payloads (§5), signature inputs
  - `federation_governance_service.proto` — SubmitProposal, FetchHead, FetchEvents
  - `federation_membership_service.proto` — GetMembershipStatus, AcceptInvite
  - `federation_projection_service.proto` — ListFederations, ListMemberStations, CreateFederation, JoinFederation, LeaveFederation
  - `federation_sync.proto` — SyncCursor, FetchEvents pagination types
  - `federation_policy.proto` — PolicyType enum, policy params per type (v1: SingleAdminParams)
  - Extend `federation_self.proto` — add JoinedFederationRef + `actor_signing_public_key` field
  - Extend `federation_health.proto` — add governance_sync_status
  - Extend `realtime/event.proto` — add `LedgerEventDelivered` arm to StreamEvent oneof
  - Extend `actor/actor.proto` — add `signing_public_key` field (Actor 独立签名密钥)
- **Dependencies**: None (first in DAG).
- **Architecture IDs**: D-01, D-04, D-08; wire-protocol.md §2-§7, §13.
- **Deletion obligations**: None.
- **Gate**: `./model/build.sh` passes; generated Go/Rust/TS code compiles; canonical bytes conformance test passes.

### WS-2: Station Federation Subserver (Core Domain)

**Responsibility**: Implement Federation governance domain logic in Station app layer.

- **Current assets**: None (new subserver).
- **Target deliverables**:
  - `subserver.go` — DDD subserver registration, DI assembly
  - `domain/` — Federation aggregate, LedgerEvent entity, Membership value object
  - `domain/hash.go` — Canonical serialization + SHA-256 hash computation
  - `domain/signature.go` — Ed25519 sign/verify for Actor key + Station key + Sequencer key
  - `domain/actor_key.go` — Actor signing key pair 生成、存储（加密）、同步到设备
  - `domain/replay.go` — Ledger replay → materialized state
  - `application/` — CreateFederation, AppendEvent, SubmitProposal, Replay, RoleCheck use cases
  - `infrastructure/` — PostgreSQL repositories (federation, ledger_event, membership, role, sync_cursor, actor_signing_key)
  - `interfaces/` — Hertz HTTP handlers for governance RPCs + projection APIs
  - `migration/` — SQL migrations for governance tables + actor_signing_key table
- **Dependencies**: WS-1 (proto must exist first).
- **Architecture IDs**: D-01, D-04, D-07, D-10; design.md §3-§5; wire-protocol.md §4, §6.
- **Deletion obligations**: None.
- **Gate**: `go test ./apps/station/app/subserver/federation/...` passes; Create→Replay→Projection lifecycle works; Actor signature verified with actor's own key; non-sequencer append rejected.

### WS-3: Sequencer Policy & Fork Detection

**Responsibility**: Implement strategy-based sequencer ordering and detect forks.

- **Current assets**: None.
- **Target deliverables**:
  - `domain/policy/policy.go` — `SequencerPolicy` interface definition (ValidateAppend, ValidateProposal, HandleSequencerUnreachable, ValidateHandover)
  - `domain/policy/single_admin.go` — v1 `single_admin` 策略实现
  - `domain/policy/registry.go` — policy_type → implementation 注册表
  - Sequencer gate in AppendEvent use case (delegates to policy.ValidateAppend)
  - Proposal accept/reject flow in sequencer (delegates to policy.ValidateProposal)
  - Fork detection in event application (hash chain + prev_hash mismatch)
  - SequencerChanged event support (policy.ValidateHandover)
  - Sequencer leave guard (must handover first, enforced by policy)
- **Dependencies**: WS-2 (domain model must exist).
- **Architecture IDs**: D-07; design.md §3.4, §5.8; wire-protocol.md §8.3, §8.5.
- **Gate**: Non-sequencer direct append → error 40002; fork injection → fork_detected; sequencer leave without handover → rejected; policy interface can be swapped without changing callers.

### WS-4: Ledger Sync Protocol (SSE Unified)

**Responsibility**: Enable multi-Station ledger replication via SSE push + HTTP pull, unified with existing realtime architecture.

- **Current assets**: events subserver with SSE infrastructure already exists; `EnvelopeDelivered` pattern already implemented for chat.
- **Target deliverables**:
  - `LedgerEventDelivered` SSE push — Sequencer publishes to connected member Stations via events subserver StreamEvent oneof
  - Station-to-Station SSE client — member Station connects to sequencer's events endpoint with Federation JWT (`federation_governance` scope)
  - Per-federation ring buffer in events subserver — supports cursor replay on reconnect
  - FetchHead RPC handler + client (HTTP/Protobuf)
  - FetchEvents RPC handler + client (HTTP/Protobuf, paginated, cursor-based)
  - Lagging catch-up flow: CURSOR_EXPIRED → batch FetchEvents → resume SSE
  - Event batch verification during catch-up (hash chain + all 3 signatures)
  - SyncCursor persistence + status tracking (healthy / lagging / fork_detected / unreachable)
- **Dependencies**: WS-2 (event store), WS-3 (sequencer assigns seq before push).
- **Architecture IDs**: D-04; wire-protocol.md §7; data-model.md §10.
- **Gate**: 3-node testnet: all nodes reach same head_hash via SSE; lagging node catches up via FetchEvents; unreachable node recovers on reconnect; fork injection halts sync.

### WS-5: Testnet Seed

**Responsibility**: Generate real genesis + membership events for test network.

- **Current assets**: `apps/station/app/conf/federation.yml` exists (discovery layer config).
- **Target deliverables**:
  - Seed script/tool that creates a `peers-testnet` Federation
  - Generates genesis event, 3 StationJoinApproved events
  - Uses real signing with test keys
  - Produces events that pass full verification
- **Dependencies**: WS-2 (domain logic), WS-3 (sequencer logic).
- **Architecture IDs**: data-model.md §11.
- **Gate**: 3 nodes replay seed events → identical head; events pass signature + hash verification.

### WS-6: Projection & Client Integration

**Responsibility**: Expose governance state to Desktop/Dashboard clients.

- **Current assets**: FederationTab.tsx, Dashboard prototype, existing store/runtime.
- **Target deliverables**:
  - Projection API handlers (ListFederations, ListMemberStations, GetDetail)
  - CreateFederation handler (Dashboard only, requires station_owner/federation_admin role)
  - JoinFederation + LeaveFederation handlers
  - Extend existing `/actor/federation/me` to include joined_federations
  - Desktop store extension: add joined federations list
  - Desktop FederationTab: show joined federations (read-only v1)
  - Dashboard: wire federation CRUD to real Station API (replaces mock data)
- **Dependencies**: WS-2 (domain), WS-4 (sync status for health display).
- **Architecture IDs**: D-05 (superseded); wire-protocol.md §5.5; integration.md §2.2.
- **Gate**: Desktop Settings shows real federation list; Dashboard can create federation + list members; capability projection matches actual permissions.

### WS-7: Catalog Federation Scope

**Responsibility**: Add federation_id to Catalog discovery path.

- **Current assets**: Existing Catalog proto (`identity/federation-catalog.md` grass draft).
- **Target deliverables**:
  - Add `federation_id` field to CatalogSearchRequest proto
  - Station Catalog handler validates federation_id presence
  - Legacy handle resolve still works but marked as advanced path
  - Desktop search UI passes federation_id when user is in federation context
- **Dependencies**: WS-1 (proto), WS-2 (membership check for authorization).
- **Architecture IDs**: D-08; design.md §6.
- **Gate**: Catalog search without federation_id → error or fallback warning; search with federation_id → returns only actors from that federation's member stations.

---

## 4. Dependency DAG

```text
WS-1 (Proto)
  │
  ├──→ WS-2 (Subserver + Actor Key) ──→ WS-3 (Sequencer Policy) ──→ WS-4 (SSE Sync) ──→ WS-5 (Seed)
  │                                                                                          │
  │                                     ┌────────────────────────────────────────────────────┘
  │                                     │
  └──→ WS-7 (Catalog Scope) ◄──────────┤
                                        │
  WS-2 ──→ WS-6 (Projection) ◄─────────┘
```

**Parallelizable**:
- WS-7 (Catalog Scope) can start after WS-1, independent of WS-2/3/4.
- WS-6 (Projection) can start after WS-2, parallel with WS-3/4.

**Sequential**:
- WS-1 → WS-2 → WS-3 → WS-4 → WS-5 (critical path).

---

## 5. Atomic Cutovers

| Concern | New Source of Truth | Consumer Inventory | Cutover Condition | Old Path to Delete |
|---|---|---|---|---|
| Federation governance state | `app/subserver/federation/` ledger + replay | Desktop projection, Dashboard, Catalog | All projection APIs return real ledger data | None (new capability) |
| `FederationSelfView` joined list | Extended proto + handler reading federation subserver | Desktop FederationTab, store | `/actor/federation/me` returns real joined_federations | Mock/empty field |
| Catalog federation_id | CatalogSearchRequest.federation_id | Desktop search, public actor browser | Default search path requires federation_id | Implicit global catalog (becomes legacy) |

No compatibility shims or dual paths. Each workstream is internally complete when merged.

---

## 6. Deliverables & Gates Summary

| WS | Key Deliverable | Gate Command | Evidence |
|---|---|---|---|
| WS-1 | Proto files compile | `./model/build.sh && cd apps/desktop && pnpm run check` | Zero errors |
| WS-2 | Federation subserver | `cd apps/station && go test ./app/subserver/federation/...` | All green |
| WS-3 | Sequencer enforcement | Integration test: reject non-sequencer append | Test log |
| WS-4 | 3-node sync | `make seed-testnet && make verify-sync` | 3 nodes same head |
| WS-5 | Testnet seed | Seed script produces verified genesis | Replay check log |
| WS-6 | Client projection | Desktop shows real federation list via API | Screenshot / E2E |
| WS-7 | Catalog scoped | Search without federation_id → 400 or warning | HTTP test |

---

## 7. Final Readiness Gate

Phase 1 is COMPLETE only when ALL conditions are met:

1. Three-node testnet can create and sync `peers-testnet` Federation.
2. Three-node replay produces identical `head_hash` and `head_seq`.
3. Non-sequencer direct append is rejected (error 40002).
4. Proposal path works: submit → sequencer accepts → event appended → synced to members.
5. Fork injection produces `fork_detected` state (does not advance head).
6. Desktop Settings shows real joined federations from Station API.
7. Dashboard can create a new Federation (writes real genesis event).
8. Catalog search requires `federation_id` on default path.
9. All proto files compile on all platforms (Go, Rust, TS).
10. No governance code in `frame/` layer (`grep -r "subserver/federation" apps/station/frame/` returns empty).
11. All existing tests continue to pass (`go test ./...`, `pnpm run check`).

---

## 8. Risks & Anti-Regression

| Risk | Control |
|---|---|
| Canonical bytes drift between Go/Rust/TS | Conformance test: same input → same hash across implementations |
| Ledger becomes ordinary DB table | Invariant test: delete materialized_state → replay → same head |
| Sequencer single point → unavailability | v1 accepts read-only/orphaned; handover is a placeholder |
| frame accumulates governance logic | CI grep gate: frame MUST NOT import subserver/federation |
| Existing discovery layer regression | Existing acceptance gates (`surface_smoke.py`, `mutual_validation.py`) must pass |
| BY_HANDLE actor enumerated by Catalog | Test: BY_HANDLE actor not in Catalog indexed results |
| Relay notification spam | Topic allow-list + rate limit on sequencer publish |

---

## 9. Execution Schedule (Recommended)

| Phase | Workstreams | Estimated Effort | Parallelism |
|---|---|---|---|
| Sprint 1 | WS-1 (Proto) | 1-2 days | Solo |
| Sprint 2 | WS-2 (Subserver Core) + WS-7 (Catalog, parallel) | 3-5 days | WS-7 can parallel |
| Sprint 3 | WS-3 (Sequencer) + WS-6 (Projection, parallel start) | 2-3 days | WS-6 starts |
| Sprint 4 | WS-4 (Sync) + WS-6 (continue) | 3-4 days | Parallel |
| Sprint 5 | WS-5 (Seed) + Final integration + Readiness gate | 2-3 days | Integration |

Total: ~12-17 working days for the complete Phase 1 governance layer.

---

## 10. Non-Claims

This plan does NOT claim:

- Mobile client integration (only Desktop and Dashboard).
- ActivityPub interop.
- Multi-sig or quorum policies (only single_admin).
- Complete federation lifecycle UI polish.
- Production deployment or performance benchmarking.
- Actor independent key support (v1 is Station-delegated).

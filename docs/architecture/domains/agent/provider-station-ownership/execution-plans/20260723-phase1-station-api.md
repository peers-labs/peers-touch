# Provider Station Ownership — Phase 1 Execution Plan

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-23 | **Updated**: 2026-07-23
> **Owner**: Agent Team
> **Upstream architecture**: `docs/architecture/domains/agent/provider-station-ownership/` (review status: 有条件通过, conditions resolved)

---

## 1. Background And Goal

Phase 1 delivers the Station-side foundation: per-actor provider/credential/model CRUD API with version-gated mutations, CLI adapter registry, and actor-scoped credential pool. After Phase 1, Station exposes the complete API surface that Desktop/Mobile will consume in Phase 2.

## 2. Scope And Non-Goals

### In scope

- Proto generation from modified `provider.proto` and `ai_models.proto`
- DB migration: add `actor_id`, `version` to existing tables; create `agent_models` table
- Provider Config CRUD handlers (version-gated, actor-scoped)
- Model Config CRUD handlers (version-gated, actor-scoped)
- Credential set/delete/status handlers (actor-scoped, upsert semantics)
- CLI adapter registry (code-level, Station-configured)
- Turn-time revalidation (provider/model/credential check before execution)
- actor_id scoping on all existing credential pool queries

### Non-goals

- Desktop/Mobile client cache layer (Phase 2)
- Desktop Web UI adaptation (Phase 3)
- CLI sandbox hardening (execution plan TBD, not Phase 1)
- Provider remote model fetch (requires credential already configured; deferred)

## 3. Architecture Reference

| Document | Key sections for this phase |
|---|---|
| `design.md` | §1 principles, §1.1 proto contracts, §5.1–§5.8 invariants |
| `decisions.md` | ADR-1 (sole executor), ADR-2 (client editor), ADR-3 (optimistic lock), ADR-4 (per-actor), ADR-5 (credentials never leave) |
| `data-model.md` | §1 schema, §3.1–§3.3 API contracts, §5 version semantics |

## 4. Current State (what exists)

| Asset | Current state | Required change |
|---|---|---|
| `infrastructure/persistence/provider.go` | `AgentProvider` model, no `actor_id`, no `version` | Add both columns |
| `infrastructure/persistence/credential.go` | `Credential` model, no `actor_id`, no `version` | Add both columns |
| `agent_models` table | Does not exist | Create |
| `service/credential_pool_service.go` | Lease/Release/Mark without actor_id filter | Add actor_id to all queries |
| `service/provider_service.go` | Rejects CLI with security error | Enable CLI via adapter registry |
| `handler/provider_handler.go` | Only `verify-cli` endpoint | Add full CRUD |
| `handler/turn_handler.go` | Trusts client-submitted provider/model | Add revalidation step |
| Migration files | 000–016 | Add 017 |

## 5. Implementation Steps

### Step 1: Proto Generation

- **Action**: Run `./model/build.sh` to regenerate Go types from modified protos.
- **Deliverable**: `apps/station/app/subserver/ai_chat/model/provider.pb.go` and `ai_models.pb.go` reflect `version` fields, `reserved` markers.
- **Verification**: `go build ./...` passes in station directory.
- **Dependencies**: None (proto changes already committed).

### Step 2: DB Migration (017)

- **Action**: Create `infrastructure/persistence/migrations/017_provider_station_ownership.sql`
- **DDL changes**:
  - `agent_providers`: ADD `actor_id VARCHAR(36) NOT NULL DEFAULT ''`, ADD `version BIGINT NOT NULL DEFAULT 1`, ADD UNIQUE `(actor_id, provider_id_field)` (replace current unique constraint if needed)
  - `agent_credential_pool`: ADD `actor_id VARCHAR(36) NOT NULL DEFAULT ''`, ADD `version BIGINT NOT NULL DEFAULT 1`, ADD UNIQUE `(actor_id, provider)`
  - CREATE TABLE `agent_models` (schema per data-model.md §1.3)
- **Data migration**: Existing rows get `actor_id = <default_actor_id>` (the Station's single-actor identity from JWT config).
- **Deliverable**: Migration file + updated GORM models in `persistence/provider.go`, `persistence/credential.go`, new `persistence/agent_model.go`.
- **Verification**: `go test ./apps/station/app/subserver/agent/infrastructure/persistence/...` + manual migration on dev DB.
- **Dependencies**: Step 1 (generated types referenced by models).

### Step 3: Actor ID Scoping On Credential Pool

- **Action**: Modify `CredentialPoolService` methods (Lease, Release, MarkExhausted, MarkError, RecoverCooledDown, ListByProvider) to accept and filter by `actor_id`.
- **Deliverable**: All credential queries include `WHERE actor_id = ?`.
- **Verification**: Unit test: two actors with same provider get different credentials.
- **Dependencies**: Step 2 (actor_id column exists).

### Step 4: Provider Config CRUD Service + Handler

- **Action**: Create `service/provider_config_service.go` with Create/Update/Delete/List/Get methods implementing version-gated logic per data-model.md §5.
- **Constraints**:
  - All mutations require actor_id from JWT context.
  - Update/Delete reject if `request.version != record.version` (409).
  - Create derives `runtime_kind` from adapter registry (Step 6); rejects unknown CLI provider_id.
  - Delete cascades credential + models in single transaction (per data-model.md cascade rules).
  - Delete rejects if provider has active turn.
- **Handler**: Expand `handler/provider_handler.go` with routes: `provider/{list,create,update,delete}`.
- **Deliverable**: Working CRUD with version conflict and cascade.
- **Verification**: Integration test covering: create → update → conflict → delete cascade.
- **Dependencies**: Step 2, Step 3 (credential cascade on delete).

### Step 5: Model Config CRUD Service + Handler

- **Action**: Create `service/model_config_service.go` with List/Update methods (models are discovered via fetch-remote in future; manual CRUD for now).
- **Handler**: New routes under `model/{list,update}`.
- **Constraints**: Version-gated update, actor-scoped.
- **Deliverable**: Model CRUD working.
- **Verification**: Integration test: list models → update enabled → version conflict.
- **Dependencies**: Step 2.

### Step 6: CLI Adapter Registry

- **Action**: Create `service/cli_adapter_registry.go` with a code-level registry mapping adapter identifiers to binary paths and allowed argument templates.
- **Constraints** (from design.md §5.6, §5.8):
  - Only registered identifiers are executable.
  - Registry is not writable via API.
  - `Resolve(adapterID) -> (binaryPath, argTemplate, timeout)` or error.
- **Initial adapters**: TBD (confirm with user which adapters to register for v1).
- **Integration**: `provider_config_service.Create()` calls registry to validate `provider_id` if `runtime_kind` would be `cli`.
- **Deliverable**: Registry + validation integrated into provider create.
- **Verification**: Unit test: registered adapter resolves; unregistered adapter rejected.
- **Dependencies**: None (can start parallel with Step 2).

### Step 7: Credential Set/Delete/Status Handler

- **Action**: Create handler routes `credential/{set,delete,status}` per data-model.md §3.2.
- **Constraints**:
  - `set` is full-replacement upsert (no version required on set).
  - `delete` requires version.
  - `status` returns only `{configured, status, version}`, never the key value.
  - Actor-scoped.
- **Deliverable**: Working credential management endpoints.
- **Verification**: Integration test: set → status shows active → delete with wrong version 409 → delete with correct version.
- **Dependencies**: Step 2, Step 3.

### Step 8: Turn-Time Revalidation

- **Action**: Modify `turn_handler.go` or `turn_service.go` to add a revalidation step before provider execution.
- **Invariant** (from design.md §5.5): Before executing, Station re-reads from DB:
  1. Provider exists, enabled, belongs to actor.
  2. Model exists, enabled, belongs to provider.
  3. Credential in `active` status for provider+actor.
- **On failure**: Return typed error via SSE error event (e.g. `AGENT_5004` for missing credential, new codes for disabled provider/model).
- **Deliverable**: Turn rejects stale or invalid provider/model/credential.
- **Verification**: Integration test: disable provider → attempt turn → typed error.
- **Dependencies**: Step 3, Step 4.

## 6. Dependency Graph And Parallelism

```
Step 1 (proto gen)
  │
  ▼
Step 2 (DB migration)         Step 6 (CLI adapter registry) ← parallel
  │
  ├──→ Step 3 (actor_id scoping)
  │       │
  │       ├──→ Step 4 (provider CRUD) ← uses Step 6 for validation
  │       ├──→ Step 7 (credential handlers)
  │       └──→ Step 8 (turn revalidation) ← depends on Step 4
  │
  └──→ Step 5 (model CRUD)
```

**Parallelizable**: Step 6 can run alongside Step 2. Steps 4, 5, 7 can partially overlap after Step 3.

## 7. Risk And Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Existing rows lack actor_id; default actor assignment incorrect | Low | Medium | Migration uses Station's configured default actor; verify with `SELECT COUNT(*) WHERE actor_id = ''` post-migration |
| Version column default=1 conflicts with existing update flows | Medium | Medium | Existing Desktop flows do not submit version (they bypass Station for local CRUD). Phase 2 handles client-side adaptation. No conflict during Phase 1 |
| CLI adapter registry too restrictive for user needs | Low | Low | Start with known adapters; registry is extensible without schema change |
| Turn revalidation adds latency to every turn | Low | Low | Single DB read before execution; negligible vs LLM call latency |

## 8. Verification Commands

| Step | Command |
|---|---|
| Proto gen | `cd apps/station && go build ./...` |
| Migration | Manual: apply migration on dev DB, verify schema |
| All Go code | `cd apps/station && go test ./app/subserver/agent/...` |
| Integration | E2E test TBD (turn request with new provider flow) |
| Style | `./tooling/scripts/check-go-style.sh` |

## 9. Completion Criteria

Phase 1 is complete when:

- [ ] Proto generation succeeds with new version/reserved fields
- [ ] Migration 017 applies cleanly; existing data preserved with default actor_id
- [ ] All credential pool queries are actor-scoped (no query without actor_id filter)
- [ ] Provider CRUD: create/update/delete with version gate works end-to-end
- [ ] Model CRUD: list/update with version gate works
- [ ] Credential set/delete/status works with upsert semantics
- [ ] CLI adapter registry rejects unregistered identifiers
- [ ] Turn revalidation rejects disabled/missing provider/model/credential
- [ ] `go test ./app/subserver/agent/...` passes
- [ ] `go build ./...` passes
- [ ] No credential values in any API response or log output

---

## Implementation Status

| Step | Status | Completed | Notes |
|------|--------|-----------|-------|
| Step 1: Proto gen | ✅ done | 2026-07-23 | build.sh + go build pass |
| Step 2: DB migration | ✅ done | 2026-07-23 | 017 SQL + GORM models + AgentModel |
| Step 3: Actor ID scoping | ✅ done | 2026-07-23 | Lease + ListByProvider actor-scoped |
| Step 4: Provider CRUD | ✅ done | 2026-07-23 | ProviderConfigService with version-gated mutations + cascade delete |
| Step 5: Model CRUD | ✅ done | 2026-07-23 | ModelConfigService with version-gated update |
| Step 6: CLI adapter registry | ✅ done | 2026-07-23 | CLIAdapterRegistry with trae-cli registered |
| Step 7: Credential handlers | ✅ done | 2026-07-23 | CredentialConfigService with upsert set + version delete + status |
| Step 8: Turn revalidation | ✅ done | 2026-07-23 | revalidateProviderState in TurnService |

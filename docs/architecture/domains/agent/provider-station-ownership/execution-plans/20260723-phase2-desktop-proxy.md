# Phase 2: Desktop Rust — Station API Proxy + Cache

> **Status**: draft
> **Created**: 2026-07-23
> **Architecture source**: `../design.md`, `../integration.md`, `../data-model.md`, `../decisions.md`
> **Phase 1 evidence**: E2E verified on remote Station (commit `c2ddf8b2`)
> **Branch**: TBD (from `feat/agent-chat-e2e` or new)

---

## 1. Scope

**In scope:**
- Replace Desktop Rust local provider persistence (YAML files) with Station-backed proxy + in-memory cache.
- All provider/model/credential CRUD commands become Station API proxies.
- Delete local model catalog management (CLI subprocess model listing).
- Adapt consumers (`chat`, `streaming`, `applets`) to read from new cache.
- First-connect migration: seed Station from existing local YAML overrides.
- Reshape Tauri command contracts for version semantics.

**Not in scope (deferred):**
- Eliminating direct LLM calls from Desktop (`chat_completion` stays — full "Station-sole-executor" is a later migration).
- Desktop Web UI changes for 409 conflict handling (Phase 3).
- Mobile client integration.
- Station CLI subprocess sandboxing.

---

## 2. Architecture Traceability

| Plan requirement | Architecture source | Invariant/Decision |
|---|---|---|
| Station is source of truth for provider config | design.md §1 principle #6 | "Cache for speed, Station for truth" |
| Mutations proxy to Station with version | design.md §1 principle #4 | Version-gated writes |
| Per-actor isolation in all queries | design.md §1 principle #3 | Per-actor isolation |
| No plaintext credentials returned to client | design.md §3 ownership table | Credential status only |
| Tauri command interface stable for Desktop Web | integration.md §9 | Compatibility guarantee |
| CLI model enumeration on Station only | design.md §1 principle #7 | CLI-as-registered-adapter |
| Local cache refreshes on foreground/post-mutation/periodic | design.md §2 diagram "Provider Config Cache" box | Cache contract |

---

## 3. Current-State Inventory (from code audit)

### Files to DELETE (total ~2,012 lines)

| File | Purpose |
|---|---|
| `application/provider/state.rs` (550L) | YAML-based local provider store |
| `application/provider/sync.rs` (69L) | Dead stub for Station sync |
| `application/provider/providers.default.yaml` (287L) | Embedded seed data |
| `application/provider/README.md` (68L) | Outdated docs |
| `application/models/mod.rs` (766L) | Model CRUD + CLI subprocess |
| `interface/tauri_commands/models.rs` (272L) | Tauri model commands |

### Files to REWRITE

| File | Current | Target |
|---|---|---|
| `application/provider/mod.rs` (615L) | Local CRUD orchestrator | Station API proxy orchestrator |
| `application/provider/remote.rs` (762L) | LLM probe + inference | Keep `chat_completion` + `resolve_model_protocol` only |
| `interface/tauri_commands/provider.rs` (256L) | Delegates to local CRUD | Delegates to Station proxy |
| `interface/tauri_commands/model_config.rs` (29L) | Local model-config | Station proxy |
| `application/model_config/mod.rs` (124L) | In-memory map | Station proxy or Station-backed cache |
| `interface/contracts/mod.rs` (~60L provider section) | Local input types | Add version fields |

### Consumer adapters

| File | What changes |
|---|---|
| `application/chat/mod.rs` (866L) | `with_provider_store()` → new cache read |
| `application/chat/streaming.rs` (460L) | Same |
| `application/applets/mod.rs` (9304L) | Same |
| `interface/http_gateway/mod.rs` (7032L) | Provider dispatch block (~80L) → new proxy |

---

## 4. Responsibility Workstreams

### WS-1: Station HTTP Client Module

**Responsibility**: Typed Rust HTTP client for Station provider/model/credential APIs.

- Creates: `application/provider/station_api.rs`
- Depends on: `infrastructure/station_client` (existing HTTP helper)
- Produces: `StationProviderClient` with methods: `list_providers`, `create_provider`, `update_provider`, `delete_provider`, `list_models`, `update_model`, `set_credential`, `delete_credential`, `credential_status`
- All methods take `token: &str` (JWT) and return typed results
- Handles: Station error codes (4009 → version conflict, 4004 → not found)
- Gate: compiles + unit test with mock Station responses

### WS-2: Provider Cache Module

**Responsibility**: In-memory versioned cache that replaces `state.rs`.

- Creates: `application/provider/cache.rs`
- Depends on: WS-1 (to refresh from Station)
- Data: `HashMap<ActorScope, CachedProviderState>` behind `RwLock`
- `CachedProviderState`: providers (with version), models (with version), credential statuses
- API: `get_providers(scope)`, `get_models(scope, provider_id)`, `get_credential_status(scope, provider_id)`, `invalidate(scope)`, `refresh(scope, client, token)`
- Consumers (`chat`, `applets`) use this for credential/protocol resolution
- Cache refresh strategy: on first access, after mutation, on app-foreground event
- Gate: unit tests; no network in tests (mock station_api layer)

### WS-3: Provider Proxy Orchestrator

**Responsibility**: Rewrite `application/provider/mod.rs` to proxy all mutations.

- Depends on: WS-1 + WS-2
- `provider_list(scope)` → cache read (refresh if stale)
- `provider_create(scope, input)` → Station API call → invalidate cache
- `provider_update(scope, input)` → Station API call (with version) → invalidate
- `provider_delete(scope, input)` → Station API call (with version) → invalidate
- `provider_check(scope, input)` → Station API call (new Station endpoint, or keep local for now)
- `provider_list_available_models(scope)` → cache read (flattened)
- Delete: `provider_apply_preset` (presets live on Station)
- Gate: Tauri commands compile; integration test against real Station

### WS-4: Remote.rs Pruning

**Responsibility**: Remove probe/fetch functions, retain inference path.

- Depends on: WS-2 (inference functions read credentials from cache now)
- Delete: `probe_provider()`, `fetch_models()`, all protocol adapter probe logic
- Retain: `chat_completion()`, `resolve_model_protocol()`, helper types
- Adapt: `chat_completion()` takes explicit `base_url`, `api_key`, `protocol` params (no more reading from provider store internally)
- Gate: `chat/mod.rs` and `applets/mod.rs` still compile and pass existing tests

### WS-5: Consumer Migration

**Responsibility**: Adapt chat/streaming/applets to read from WS-2 cache.

- Depends on: WS-2, WS-4
- Replace all `with_provider_store(scope, |store| ...)` calls with cache reads
- Pattern: `cache::get_provider_config(scope, provider_id)` → returns `(base_url, api_key, protocol)`
- For credential access: cache stores only encrypted/status; actual api_key for inference comes from... 

  **Design question**: Does the cache store decrypted credentials for local inference? Or does Desktop no longer call LLMs directly?
  
  **Resolution**: Per architecture principle #1, Desktop should NOT call LLMs directly. BUT `chat/mod.rs` and `applets/mod.rs` currently DO this. Full migration to Station-only execution is out of Phase 2 scope. Therefore: the cache DOES hold decrypted credentials (fetched from a new Station endpoint that returns the key to the authenticated actor). This is a **temporary** state until all inference routes through Station SSE.

  **Alternative**: If we want to enforce principle #1 NOW, we delete the direct inference path. This is a larger change and could break applets. Defer to Phase 5.

- Gate: Desktop build succeeds; agent turn still works E2E

### WS-6: Deletion + Contract Reshape

**Responsibility**: Delete dead files, reshape contracts.

- Depends on: WS-3, WS-4, WS-5 all complete
- Delete files listed in §3 "Files to DELETE"
- Delete `interface/tauri_commands/models.rs` (all model commands proxied through provider commands or removed)
- Reshape `contracts/mod.rs`: add `version: Option<i64>` to mutation inputs
- Update `provider_models_lib.rs`: remove deleted re-exports
- Update `interface/http_gateway/mod.rs` command dispatch: remove old model routes
- Gate: full `cargo build` passes; no dead code warnings

### WS-7: First-Connect Migration

**Responsibility**: Seed Station with local overrides on first authenticated connect.

- Depends on: WS-1
- On login/session-start: check if Station has providers for this actor
- If empty AND local `config/providers/users/<scope>/override.yaml` exists:
  - Read local overrides
  - For each provider: call Station `create_provider` + `set_credential`
  - On success: rename/archive local file
- If Station already has providers: skip (Station is truth)
- Gate: test with fresh Station + existing local overrides → providers appear on Station

---

## 5. Dependency Graph

```
WS-1 (Station HTTP Client)
  │
  ├── WS-2 (Cache Module)
  │     │
  │     ├── WS-3 (Proxy Orchestrator)
  │     │     │
  │     │     └── WS-6 (Deletion + Contract Reshape) ──→ FINAL GATE
  │     │
  │     └── WS-5 (Consumer Migration) ──┐
  │                                      │
  ├── WS-4 (Remote.rs Pruning) ─────────┘
  │
  └── WS-7 (First-Connect Migration) — independent, can parallel with WS-3+
```

**Parallelizable**: WS-7 can run in parallel with WS-3/WS-4/WS-5 (only depends on WS-1).

**Sequential chain**: WS-1 → WS-2 → WS-3 → WS-6 (critical path).

**WS-4 and WS-5**: Can start after WS-2; WS-5 depends on both WS-2 and WS-4.

---

## 6. Atomic Cutover

The cutover is at WS-6 completion:

| Old source of truth | New source of truth | Cutover condition | Deletion |
|---|---|---|---|
| `application/provider/state.rs` (YAML files) | Station DB via cache | All Tauri commands route through proxy; no reference to `with_provider_store` remains | Delete `state.rs` + YAML files |
| `application/models/mod.rs` (local model CRUD) | Station model API via proxy | All model operations route through Station; CLI subprocess removed | Delete `models/mod.rs` + `tauri_commands/models.rs` |
| `application/provider/sync.rs` | WS-1 Station client | Dead code, already non-functional | Delete immediately (WS-6) |
| `providers.default.yaml` (seed data) | Station seeded by WS-7 migration or admin | First-connect migration handles existing users | Delete file |

**Verification**: After cutover, `rg "with_provider_store\|persist_provider_store\|ProviderStore\|ProviderRecord" src-tauri/src/` returns zero matches.

---

## 7. Deliverables Per Workstream

### WS-1 Deliverables
- [ ] `application/provider/station_api.rs` — typed Station HTTP client
- [ ] All 9 Station endpoints wrapped with proper error mapping
- [ ] Unit tests (mocked HTTP layer)
- Gate: `cargo test` passes; `cargo build` passes

### WS-2 Deliverables
- [ ] `application/provider/cache.rs` — versioned in-memory cache
- [ ] `CachedProviderState` struct with providers + models + credential statuses
- [ ] Thread-safe read/write access (`RwLock`)
- [ ] Refresh logic (fetch from Station, update cache)
- [ ] Public API for consumers
- Gate: unit tests pass; no network calls in tests

### WS-3 Deliverables
- [ ] Rewritten `application/provider/mod.rs` (proxy orchestrator)
- [ ] All Tauri commands continue to work (same names, same return shape)
- [ ] Version field included in update/delete flows
- [ ] `provider_apply_preset` removed
- Gate: Desktop build succeeds; Tauri commands callable from Web UI

### WS-4 Deliverables
- [ ] `remote.rs` reduced to inference-only functions
- [ ] `chat_completion` params made explicit (no internal store access)
- [ ] All `probe_*` and `fetch_models` functions deleted
- Gate: consumers compile; no unused import warnings

### WS-5 Deliverables
- [ ] All `with_provider_store()` calls in chat/streaming/applets replaced
- [ ] Credentials resolved from cache (temporary until Station-sole-executor)
- [ ] No regression in agent turn E2E
- Gate: `cargo build` passes; agent turn works against Station

### WS-6 Deliverables
- [ ] Dead files deleted (6 files, ~2012 lines)
- [ ] `contracts/mod.rs` reshaped (version fields added)
- [ ] `provider_models_lib.rs` updated
- [ ] HTTP gateway dispatch block cleaned
- [ ] Zero references to deleted symbols
- Gate: `cargo build --release` passes; `rg` verification

### WS-7 Deliverables
- [ ] First-connect migration logic in session startup
- [ ] Local YAML → Station seeding (idempotent)
- [ ] Archived local files after migration
- Gate: fresh Station + existing YAML → providers appear; second run = no-op

---

## 8. End-to-End Lifecycles

| Lifecycle | Workstreams involved | Verification |
|---|---|---|
| App startup (fresh user) | WS-2, WS-3 | Cache empty → first access triggers refresh → UI shows providers |
| App startup (existing user, local overrides) | WS-7, WS-2 | Migration seeds Station → cache refresh → UI shows |
| Provider create | WS-1, WS-3 | Settings UI → Tauri cmd → Station API → cache invalidate → UI refreshes |
| Provider update (with version) | WS-1, WS-3 | Same + version sent |
| Provider update (conflict) | WS-1, WS-3 | Returns 409 → Rust returns error → UI shows conflict |
| Credential set | WS-1, WS-3 | API key sent → Station stores → cache refreshes status |
| Agent turn | WS-2, WS-5, WS-4 | Agent store picks provider → turn request to Station SSE → response streams |
| Applet AI call | WS-2, WS-5, WS-4 | Applet resolves provider from cache → `chat_completion` with explicit creds |
| Account switch | WS-2 | Cache invalidates → re-fetches for new actor |
| Offline/Station unreachable | WS-2 | Cache serves stale data; mutations fail with clear error |

---

## 9. Risk

| Risk | Impact | Mitigation |
|---|---|---|
| Applet gateway (9304L) has many provider touchpoints | High | Careful search + test; applets are critical path |
| Credential in cache breaks security posture | Medium | Temporary; document as tech debt; Phase 5 eliminates |
| First-connect migration race (two devices) | Low | Station's unique constraint on (actor_id, name) handles idempotency |
| Version conflict UX before Phase 3 | Low | Rust returns typed error; Web shows generic failure until Phase 3 improves UX |

---

## 10. Non-Claims

- This plan does NOT achieve "Station-sole-executor" for all LLM inference (design.md principle #1). Direct LLM calls from Desktop via `chat_completion` remain. This is explicitly deferred.
- This plan does NOT change the Desktop Web UI behavior beyond passing through errors. Phase 3 handles UX improvements.
- This plan does NOT add offline-mode support beyond stale cache reads.

---

## 11. Final Readiness Gate

Phase 2 is complete when ALL:

1. `cargo build --release` passes with zero warnings.
2. `rg "with_provider_store|persist_provider_store|ProviderStore|ProviderRecord" src-tauri/src/` → zero matches.
3. `rg "providers.default.yaml|provider_apply_preset" src-tauri/src/` → zero matches.
4. E2E: Desktop Settings UI → create provider → set credential → list shows it.
5. E2E: Agent turn with provider from Station → SSE response streams correctly.
6. E2E: Version conflict on concurrent update → error returned (not crash).
7. E2E: First-connect migration (local YAML → Station) succeeds.
8. All deleted files confirmed absent from tree.
9. No direct file I/O to `config/providers/` for provider data.

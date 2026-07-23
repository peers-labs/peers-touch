# Provider Station Ownership — Integration

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-23 | **Updated**: 2026-07-23
> **Owner**: Agent Team

---

## 1. Current State (To Be Replaced)

| Component | Current behavior | Target behavior |
|---|---|---|
| Desktop Rust `ProviderStore` | Local SQLite source of truth for providers/models/credentials | Versioned cache of Station config; mutations route to Station API |
| Desktop Rust `agent_execute_turn_stream` | Always forwards to Station `/sub-agent/agent/turn/stream` | No change (already correct) |
| Desktop Rust CLI model fetch | Spawns CLI subprocess locally to enumerate models | Removed; Station handles model enumeration for CLI providers |
| Desktop Web `store/provider.ts` | Calls Rust commands for provider CRUD (local storage) | Calls Rust commands that proxy to Station API |
| Desktop Web `store/agent.ts` `loadModels()` | Reads from local Rust `ProviderStore` | Reads from Station-synced cache (same Rust command, different backend) |
| Station `CredentialPoolService.Lease()` | Queries `agent_credential_pool WHERE provider = ?` | Queries `WHERE provider = ? AND actor_id = ?` |
| Station `agent_credential_pool` table | No actor_id column (implicit single-actor) | Add `actor_id` column; all queries actor-scoped |

---

## 2. Deletion List (Desktop Rust)

Files to be fully deleted:

| Path (relative to `src-tauri/src/`) | Lines | Current purpose | Reason |
|---|---|---|---|
| `application/provider/state.rs` | 550 | In-memory + YAML file persistence for providers/models (NOT SQLite); `with_provider_store()`, `persist_provider_store()`, `ProviderRecord`, `ModelRecord` | Replaced by Station API; no local truth |
| `application/provider/sync.rs` | 69 | Stub for bidirectional Station sync (both functions are TODOs) | Dead code; superseded by Phase 2 proxy |
| `application/provider/providers.default.yaml` | 287 | Embedded seed data for 15+ providers (Ark, OpenAI, Anthropic, Ollama, CLI variants) via `include_str!` | Seed data moves to Station |
| `application/provider/README.md` | 68 | Documents YAML config-file approach | Superseded |
| `application/models/mod.rs` | 766 | Model CRUD + remote fetch + CLI subprocess model listing | All model catalog management moves to Station |
| `interface/tauri_commands/models.rs` | 272 | Tauri commands for model add/update/delete/fetch/toggle | Replaced by Station API proxy |

Total deletable: ~2,012 lines.

---

## 3. Rewrite List (Desktop Rust)

Files that remain but are substantially rewritten:

| Path (relative to `src-tauri/src/`) | Lines | Current purpose | Target behavior |
|---|---|---|---|
| `application/provider/mod.rs` | 615 | Local CRUD orchestrator (list, get, create, update, delete, check, apply_preset, list_available_models) | **Station API proxy**: all mutations forward to Station; reads return Station-cached data |
| `application/provider/remote.rs` | 762 | Dual-purpose: (a) probe LLM for reachability UI, (b) `chat_completion` + `resolve_model_protocol` used by chat/applets | **Retain**: `chat_completion` + `resolve_model_protocol` (active inference path); **Delete**: `probe_provider`, `fetch_models` (moved to Station) |
| `interface/tauri_commands/provider.rs` | 256 | Tauri command wrappers (8 commands) delegating to application layer | Keep same Tauri command names; implementation becomes Station proxy |
| `interface/tauri_commands/model_config.rs` | 29 | Model-config slot assignment (default model for a service) | Proxy to Station or lightweight local cache |
| `application/model_config/mod.rs` | 124 | In-memory map: service-key → provider+model pair | Proxy to Station per-actor model assignment |
| `provider_models_lib.rs` | 64 | Lib crate re-exports for `cargo test --lib` | Remove provider/model re-exports |
| `interface/contracts/mod.rs` (provider structs) | ~60 | Input/output types for Tauri commands | Reshape for Station API proxy semantics (add `version` field to mutations) |

---

## 4. Retention List (Desktop Rust — no change needed)

| Path (relative to `src-tauri/src/`) | Current behavior | Why unchanged |
|---|---|---|
| `application/agent_turn/mod.rs` | Forward turn to Station `/sub-agent/agent/turn/stream` SSE | Already correct; Station owns execution |
| `infrastructure/storage/key_provider.rs` | OS keychain key management (encryption keys) | Unrelated to LLM providers |

---

## 5. Consumer Impact (Desktop Rust)

These files import from `application::provider` and need adaptation:

| File | Lines | What it uses | Required change |
|---|---|---|---|
| `application/chat/mod.rs` | 866 | `with_provider_store()` (resolve provider base_url/api_key/protocol), `chat_completion()` | Replace `with_provider_store()` with new cache-reading API |
| `application/chat/streaming.rs` | 460 | `with_provider_store()`, `resolve_model_protocol()` | Same as above |
| `application/applets/mod.rs` | 9304 | `chat_completion()`, `with_provider_store()`, `ProviderRecord` | Applet gateway reads from new cache |
| `interface/http_gateway/mod.rs` | 7032 | Provider/model command dispatch block (~80 lines) | Rewire to new proxy commands |

---

## 6. Desktop Web Impact

| Path (relative to `apps/desktop/src/`) | Current behavior | Target behavior |
|---|---|---|
| `store/provider.ts` | Zustand store calling Rust Tauri commands | No change (Rust commands stay, backend changes) |
| `modules/providers.ts` | Module registration for settings panel | No change |
| `components/settings/Provider*.tsx` | Settings UI (CRUD, model management) | Handle 409 (version conflict) in UI; otherwise unchanged |
| `services/agent-runtime-config.ts` | Build runtime config for agent turn | No change (already correct) |
| `gen/proto/domain/ai_chat/provider_pb.ts` | Generated proto types | Regenerate after proto changes |

---

## 7. Station Changes (Phase 1 — DONE)

| Component | Status |
|---|---|
| `agent_providers` table: `actor_id`, `version`, `display_name`, `base_url` columns | ✅ Done |
| `agent_models` table (new) | ✅ Done |
| `agent_credential_pool`: `actor_id`, `version` columns | ✅ Done |
| Provider/Model/Credential CRUD API endpoints | ✅ Done |
| Version-gated mutations (optimistic lock) | ✅ Done |
| CLI adapter registry | ✅ Done |
| `CredentialPoolService.Lease()` with `actor_id` | ✅ Done |
| Turn-time revalidation | ✅ Done |

---

## 8. Migration Strategy

### Phase 1: Station API + Per-Actor ✅ COMPLETE

Delivered: Station CRUD API with version-gated mutations, actor-scoped credential pool, CLI adapter registry. E2E verified on remote Station.

### Phase 2: Desktop Rust — Station API Proxy + Cache

Scope: Replace local provider persistence with Station-backed proxy layer.

1. Create thin cache module: fetch provider/model/credential-status from Station, cache in memory with version tracking.
2. Rewrite `application/provider/mod.rs`: all CRUD proxies to Station API; reads return cached data.
3. Delete `state.rs`, `sync.rs`, `providers.default.yaml`, `README.md`.
4. Delete `application/models/mod.rs` (catalog management on Station).
5. Retain `remote.rs` inference functions (`chat_completion`, `resolve_model_protocol`); delete probe/model-list functions.
6. Adapt consumers (`chat/mod.rs`, `chat/streaming.rs`, `applets/mod.rs`) to read from new cache instead of `with_provider_store()`.
7. Reshape Tauri command contracts (add version fields).
8. First-connect migration: seed Station from existing local YAML overrides if Station has no providers for this actor.

### Phase 3: Desktop Web Adaptation

1. Settings UI handles 409 version conflict (re-fetch + retry or notify user).
2. Regenerate proto TS types.
3. Agent store `loadModels()` continues working (Rust cache returns same shape).

### Phase 4: Verify + Clean

1. E2E: create provider on Desktop → credential set → send message → SSE response.
2. E2E: same actor on two devices → concurrent edit → 409 → resolution.
3. Delete dead code (orphan YAML files, unused contract types, local override paths).

---

## 9. Compatibility

- Desktop Web Tauri command interface remains stable — implementation changes underneath.
- Turn execution path (`agent_execute_turn_stream` → Station SSE) is already correct and unchanged.
- Mobile can use Station API directly (no Rust BFF needed for provider config).

---

## 10. Risk

| Risk | Impact | Mitigation |
|---|---|---|
| Station CLI subprocess security | High | Sandbox CLI execution on Station (container or restricted user) |
| Latency increase for provider operations | Low | Acceptable; consistency > latency for config operations |
| Migration breaks existing local-only users | Medium | Phase 2 step 8: first-connect migration seeds Station from local YAML |
| Version conflict UX | Medium | Design clear "config was changed on another device" dialog |
| `chat_completion` in remote.rs still needs credentials | Medium | New cache provides credentials; no direct local YAML access |
| Applet AI calls (9304-line file) depend on provider resolution | High | Test thoroughly; applet gateway is critical path |

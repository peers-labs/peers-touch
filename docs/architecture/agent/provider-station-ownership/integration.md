# Provider Station Ownership — Integration

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-07-23 | **Updated**: 2026-07-27
> **Owner**: Agent Team

---

## 0. Core Ownership Model

| Concept | Owner | Location | Mutability |
|---------|-------|----------|------------|
| **Provider Catalog** (what providers the product supports: protocol, base_url, models, discovery) | Station | `apps/station/app/subserver/agent/catalog/providers.default.yaml` loaded at boot | Read-only at runtime; updated via Station release |
| **User Credentials** (API keys, secrets) | Station | `agent_providers.key_vaults` + `credential/set` / `credential/resolve` API | Per-actor, mutable |
| **User Preferences** (enabled/disabled, custom base_url override) | Station | `agent_providers` row per actor+provider | Per-actor, version-gated |
| **Custom Providers** (user-added providers not in catalog) | Station | Same table, no catalog counterpart | Per-actor, mutable |

**Invariant**: Station is the single source of truth for both the provider catalog and user state. Desktop is a pure renderer — it depends on Station for the provider list and cannot function without connectivity. The catalog is seeded into Station's in-memory registry at boot from an embedded YAML asset. `HandleProviderList` merges catalog + user state (credentials, preferences, hidden_models) and returns the unified view. Desktop never ships or interprets the catalog locally.

**Superseded (v1.1)**: The v1.1 invariant ("catalog ships with the client, never needs to be seeded to Station") is superseded. The architectural decision to make Station the sole owner simplifies the client to a pure renderer and eliminates dual-source merging logic on Desktop.

---

## 1. Current State (Post Phase 2)

| Component | Behavior |
|---|---|
| Desktop Rust `catalog.rs` | Loads embedded `providers.default.yaml` at compile time via `include_str!`; provides `list_catalog()` and `find_in_catalog()` |
| Desktop Rust `provider_list` | Returns catalog entries; overlays Station credential status (best-effort, graceful fallback if Station unreachable) |
| Desktop Rust `provider_get` | Merges catalog entry + Station state (enabled, version, credential) |
| Desktop Rust `cache.rs` | In-memory TTL cache for Station provider state + credential status |
| Desktop Rust `station_api.rs` | Typed HTTP client for 10+ Station agent endpoints |
| Desktop Rust `remote.rs` | Inference-only: `chat_completion` + `resolve_model_protocol` |
| Desktop Web `store/provider.ts` | Calls Rust Tauri commands (unchanged interface) |
| Station `agent_providers` | Per-actor provider preferences + credential storage |
| Station `credential/resolve` | Returns decrypted api_key + base_url + protocol for authenticated actor |

---

## 2. Deletion List (Desktop Rust) — COMPLETED

Files deleted in Phase 2:

| Path (relative to `src-tauri/src/`) | Lines | Reason |
|---|---|---|
| `application/provider/state.rs` | 550 | Replaced by Station API proxy; local YAML persistence removed |
| `application/provider/sync.rs` | 69 | Dead stub; superseded by cache.rs + station_api.rs |
| `application/provider/README.md` | 68 | Superseded by this document |
| `application/models/mod.rs` | 766 | Model catalog now from embedded YAML + Station user models |
| `interface/tauri_commands/models.rs` | 272 | Commands replaced by Station proxy |

**NOT deleted** (corrected from v1.0):

| Path | Lines | Reason retained |
|---|---|---|
| `application/provider/providers.default.yaml` | 287 | **Product catalog** — defines supported providers. This is a product-level asset, not user state. Ships with the client, loaded at compile time by `catalog.rs`. |

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

### Phase 2: Desktop Rust — Catalog + Station Proxy ✅ COMPLETE

Delivered:

1. `catalog.rs` — embedded provider catalog loaded at compile time.
2. `cache.rs` — in-memory TTL cache for Station credential/preference state.
3. `station_api.rs` — typed HTTP client for all Station agent endpoints.
4. `mod.rs` rewritten — `provider_list` / `provider_get` / `provider_list_available_models` return catalog as base, overlay Station state.
5. Deleted `state.rs`, `sync.rs`, `README.md`, `models/mod.rs`, `tauri_commands/models.rs`.
6. Retained `providers.default.yaml` as product catalog (not user state).
7. `remote.rs` retained inference path only; deleted probe/model-list functions.
8. Consumers (`chat`, `streaming`, `applets`) migrated to `cache::resolve_credential`.

**Architectural correction (v1.1)**: v1.0 incorrectly planned to "seed Station from local YAML". This was wrong. The catalog is a product asset that always ships with the client. Station never needs to know "what providers exist in the world" — it only stores what the user configured (credentials + enabled/disabled preferences).

### Phase 3: Desktop Web Adaptation

1. Settings UI handles 409 version conflict (re-fetch + retry or notify user).
2. Regenerate proto TS types.
3. Agent store `loadModels()` continues working (Rust cache returns same shape).
4. Provider list UI renders catalog entries with credential_status overlay.

### Phase 4: Verify + Clean

1. E2E: open Settings → see all 15 catalog providers → configure key → send message → SSE response.
2. E2E: same actor on two devices → concurrent credential edit → 409 → resolution.
3. ~~E2E: Station unreachable → provider list still shows (catalog) → credential status shows "unknown".~~ (Superseded: Station is now required.)
4. Delete orphan contract types and unused local override paths.

### Phase 5: Station-Owned Catalog (v1.2)

Move the provider catalog from Desktop to Station. Desktop becomes a pure renderer.

**Steps**:

1. Move `providers.default.yaml` from `apps/desktop/src-tauri/src/application/provider/` to `apps/station/app/subserver/agent/catalog/`.
2. Create `catalog.go` in Station: parse YAML at boot, hold in-memory registry.
3. Rewrite `HandleProviderList`: merge catalog + actor's `agent_providers` rows (credentials, enabled, hidden_models). Return unified list.
4. Rewrite `HandleProviderGet`: merge single catalog entry + actor state.
5. Simplify Desktop Rust `provider_list` / `provider_get`: just call Station API, return result directly. Remove `catalog.rs`, `cache.rs` overlay logic.
6. Desktop `provider_list_available_models`: call Station (Station filters catalog models by enabled providers + hidden_models).
7. Update `HandleModelHide` / `HandleModelHiddenList`: filter against catalog models (Station now knows the catalog).
8. Delete Desktop `catalog.rs` (no longer needed).
9. Update architecture doc §0, §1, risk table.

**Acceptance**: Desktop Settings page shows all catalog providers (with correct credential status) by calling Station only. No local YAML parsing on Desktop.

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
| Station unreachable | High | Accepted: Desktop cannot function without Station. Show connection error state. |
| Version conflict UX | Medium | Design clear "config was changed on another device" dialog |
| `chat_completion` in remote.rs still needs credentials | Medium | `cache::resolve_credential` fetches from Station; graceful error if not configured |
| Applet AI calls (9304-line file) depend on provider resolution | High | Test thoroughly; applet gateway is critical path |
| Catalog staleness across Station versions | Low | Catalog updates ship with Station releases; version-gated seed logic if needed |

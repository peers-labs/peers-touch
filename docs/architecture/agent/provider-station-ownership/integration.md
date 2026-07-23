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

## 2. Deletion List (Desktop)

These Desktop Rust capabilities will be deleted or gutted:

| Path | Current purpose | Action |
|---|---|---|
| `src-tauri/src/application/provider/state.rs` | Local provider persistence (SQLite) | Replace with Station-cache read/write |
| `src-tauri/src/application/provider/mod.rs` `provider_create/update/delete` | Local CRUD | Rewrite as Station API proxy + cache update |
| `src-tauri/src/application/models/mod.rs` CLI model fetch | Local CLI subprocess for model enumeration | Delete; Station handles |
| Local `providers.json` / SQLite provider tables | Persist provider config | Replace with cache layer (can still use local storage as cache backend) |

---

## 3. Retention List (Desktop)

These remain but change semantics:

| Path | Kept behavior | Changed semantics |
|---|---|---|
| `src-tauri/src/application/agent_turn/mod.rs` | Forward turn to Station SSE | No change |
| `src-tauri/src/application/provider/mod.rs` `provider_list_available_models` | Return flattened model list to UI | Now reads from local cache (populated from Station) |
| Desktop Web `store/agent.ts` | `selectedModel` + `selectedProviderId` | Selected model persisted to Station (per-actor); local state is cache |
| Desktop Web `components/ChatInput.tsx` model picker | UI for selecting model | No change in UI; data source changes from local-only to Station-cached |

---

## 4. Station Changes

| Component | Change |
|---|---|
| `agent_credential_pool` table | Add `actor_id` column; migrate existing rows to default actor |
| `agent_providers` table (new or rename) | Store per-actor provider config with `version` column |
| `agent_models` table (new or rename) | Store per-actor model config with `version` column |
| Provider Config API handlers (new) | CRUD endpoints at `/sub-agent/agent/provider/*` and `/sub-agent/agent/model/*` and `/sub-agent/agent/credential/*` |
| `CredentialPoolService.Lease()` | Add `actor_id` parameter to all queries |
| `TurnHandler` | Extract actor_id from JWT; pass to credential pool |
| CLI provider execution | New: Station spawns CLI subprocess for runtime_kind=cli providers |

---

## 5. Migration Strategy

### Phase 1: Station API + Per-Actor (prerequisite)

1. Update `model/domain/ai_chat/provider.proto` and `ai_models.proto` (version fields, reserved, runtime_kind semantics — already done in this architecture change).
2. Run `./model/build.sh` to regenerate Go types; Station handlers MUST bind to generated types, not hand-written structs.
3. Add `actor_id` to credential pool queries.
4. Create provider/model/credential CRUD API endpoints on Station, using generated proto types.
5. Add version columns to all config tables.
6. Implement version-gated mutation logic.
7. Implement CLI adapter registry (code-level, not client-writable).

### Phase 2: Desktop Rust Cache Layer

1. Replace local provider store with Station-fetching cache.
2. Provider CRUD commands become Station API proxies.
3. Remove local CLI model enumeration (Station handles).
4. Keep Tauri command interface unchanged for Desktop Web.

### Phase 3: Desktop Web Adaptation

1. Settings UI calls same Rust commands (which now proxy to Station).
2. Handle 409 (version conflict) in UI with re-fetch + retry.
3. Agent store `loadModels()` continues working (Rust cache returns same shape).
4. Remove any remaining direct-credential-storage in local provider store.

### Phase 4: Verify + Clean

1. E2E test: create provider on Desktop → credential set → send message → SSE response.
2. E2E test: same actor on two devices → concurrent edit → 409 → resolution.
3. Delete dead code (local CLI execution, local credential storage, orphan provider migration paths).

---

## 6. Compatibility

- Desktop Web Tauri command interface (`provider_list_available_models`, `provider_create`, etc.) remains stable — implementation changes underneath.
- Turn execution path (`agent_execute_turn_stream` → Station SSE) is already correct and unchanged.
- Mobile can use Station API directly (no Rust BFF needed for provider config).

---

## 7. Risk

| Risk | Mitigation |
|---|---|
| Station CLI subprocess security | Sandbox CLI execution on Station (container or restricted user) |
| Latency increase for CLI providers | Acceptable; consistency > latency for config operations |
| Migration breaks existing local-only users | Phase 2 must seed Station from existing local provider store on first connect |
| Version conflict UX | Design clear "config was changed on another device" dialog |

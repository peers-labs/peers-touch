# Provider Runtime Strategy — Execution Plan

> Status: DRAFT
> Architecture source: `docs/architecture/domains/agent/provider-runtime-strategy.md`
> Date: 2026-07-29

## Scope

Implement the Provider Runtime Strategy to achieve per-actor CLI isolation, credential injection, and config persistence. All work extends existing primitives.

## Non-Scope

- Per-actor CLI binary versioning/download
- CLI sandboxing/containerization
- Streaming output support
- New tables or services

---

## Architecture Traceability

| Plan requirement | Architecture source | Evidence |
|---|---|---|
| Per-actor model persist | §3.2 persist, §9 (done) | DB query shows actor-scoped models |
| Idempotent model create | §3.2 persist, §9 (done) | No duplicate errors on re-fetch |
| DB model merge in get_provider | §3.2 discover + persist | Provider response includes DB models |
| model_toggle persistence | §3.2 persist, §9 (done) | Enable/disable survives refresh |
| Per-actor base_url return | §3.1 inject | Provider get returns user's saved URL |
| API key resolve on get | §3.1 inject | Provider get includes decrypted key |
| Actor workspace directory | §4.1 | Directory created per actor+provider |
| Env injection for CLI | §4.2 | CLI subprocess receives actor env vars |
| Credential injection for CLI | §4.3 | `credential_env_key` → env var |
| Output format detection | §5.2 | JSON/text auto-detection |
| Catalog `credential_env_key` | §7 | YAML field, used in injection |

---

## Current-State Inventory

### Rust BFF (`apps/desktop/src-tauri/src/application/provider/`)

| File | Responsibility | Changes needed |
|---|---|---|
| `mod.rs` | CLI execution, provider CRUD, credential enrichment | Add workspace creation, env injection |
| `station_api.rs` | Station HTTP client | No changes needed |
| `remote.rs` | Remote model fetch for Direct providers | No changes needed |

### Station (`apps/station/app/subserver/agent/`)

| File | Responsibility | Changes needed |
|---|---|---|
| `handler/provider_handler.go` | Provider CRUD, model merge | Done (today's fixes) |
| `service/model_config_service.go` | Model CRUD | Done (idempotent create) |
| `service/credential_config_service.go` | Credential vault | No changes needed |
| `catalog/providers.default.yaml` | Provider registry | Add `credential_env_key` field |
| `catalog/catalog.go` | Catalog parser | Parse new field |

### Frontend (`apps/desktop/src/`)

| File | Responsibility | Changes needed |
|---|---|---|
| `components/settings/ProviderDetail.tsx` | Provider settings UI | Done (unified addModel) |
| `store/provider.ts` | Provider store | No changes needed |
| `services/desktop_api.ts` | API layer | No changes needed |

---

## Workstreams

### WS-1: Config Persistence (DONE)

Already completed today:
- [x] CLI model persist via `addModel()` path
- [x] Idempotent `model/create` in Station
- [x] DB model merge in `HandleProviderGet`
- [x] `model_toggle` wired to Station `update_model`
- [x] `base_url` override returned from Station
- [x] API key resolved and injected in Rust BFF `provider_get`

**Gate**: User saves API key + proxy URL → refresh → data still there.

### WS-2: Actor Workspace Creation

**Responsibility**: Create isolated working directory per actor+provider for CLI execution.

**Deliverables**:
- `mod.rs`: Function `ensure_actor_workspace(actor_id, provider_id) -> PathBuf`
- Creates `$APP_DATA/actors/<actor_id>/cli/<provider_id>/workspace/` if not exists
- Returns the path for use as `cwd` in CLI subprocess

**Dependencies**: None (standalone utility).

**Gate**: Directory exists after first CLI call for the actor.

**Files**:
- `apps/desktop/src-tauri/src/application/provider/mod.rs`

### WS-3: CLI Env Injection

**Responsibility**: Inject per-actor identity and workspace into CLI subprocess environment.

**Deliverables**:
- Refactor `execute_cli_models_command` → `execute_cli_command(command, env_overrides, cwd)`
- Build env map: `PEERS_ACTOR_ID`, `PEERS_PROVIDER_ID`, `PEERS_WORKSPACE`, `PEERS_STATION_URL`
- Pass env map + workspace as cwd to subprocess

**Dependencies**: WS-2 (workspace path needed for cwd and env).

**Gate**: CLI subprocess sees correct env vars (testable via `env` command as cli_command).

**Files**:
- `apps/desktop/src-tauri/src/application/provider/mod.rs`

### WS-4: Credential Injection for CLI

**Responsibility**: For CLI providers with `credential_env_key`, resolve the actor's API key and inject as env var.

**Deliverables**:
- Parse `credential_env_key` from catalog YAML
- Add field to `CatalogProvider` struct in `catalog.go`
- In Rust BFF: if `credential_env_key` is present in provider response, resolve credential and add to env map
- Station: include `credential_env_key` in `AgentProviderInfo` response for catalog providers

**Dependencies**: WS-3 (env injection infrastructure).

**Gate**: `codex-cli` receives `OPENAI_API_KEY` from the actor's credential vault.

**Files**:
- `apps/station/app/subserver/agent/catalog/providers.default.yaml`
- `apps/station/app/subserver/agent/catalog/catalog.go`
- `apps/station/app/subserver/agent/handler/provider_handler.go`
- `apps/desktop/src-tauri/src/application/provider/mod.rs`
- `model/domain/agent/provider.proto` (add `credential_env_key` field)

### WS-5: Output Format Normalization

**Responsibility**: Detect and normalize CLI output format (JSON vs plain text).

**Deliverables**:
- Refactor `parse_json_models` → generic `parse_cli_output(stdout, expected_format)`
- For execution responses: detect JSON `{"content": ...}` vs plain text
- Return normalized `CLIResponse { content, model, usage }` struct

**Dependencies**: WS-3 (uses the new execute_cli_command).

**Gate**: Both JSON and plain-text CLI outputs produce the same normalized response struct.

**Files**:
- `apps/desktop/src-tauri/src/application/provider/mod.rs`

---

## Dependency Graph

```
WS-1 (done) ─────────────────────────────────────────────────
                                                              │
WS-2 (workspace creation) ──── no deps ──────────────────────┤
                                     │                        │
WS-3 (env injection) ───────── depends on WS-2 ──────────────┤
              │                                               │
WS-4 (credential inject) ─── depends on WS-3 ────────────────┤
              │                                               │
WS-5 (output format) ──────── depends on WS-3 ────────────────
```

**Parallel units**: WS-4 and WS-5 can run in parallel (both depend on WS-3, independent of each other).

---

## Execution Order

| Step | Workstream | Effort | Parallel? |
|------|-----------|--------|-----------|
| 1 | WS-2: Actor workspace | ~30 min | No |
| 2 | WS-3: Env injection | ~45 min | No |
| 3a | WS-4: Credential injection | ~1h | Yes (with 3b) |
| 3b | WS-5: Output normalization | ~30 min | Yes (with 3a) |

Total estimated: ~2.5h of implementation work.

---

## Final Readiness Gate

All of the following must pass:
1. ByteDance Ark: API key + proxy URL persist across refresh
2. TRAE CLI: "Fetch models" persists 26+ models across refresh
3. CLI execution uses actor workspace as cwd
4. CLI execution env includes `PEERS_ACTOR_ID`
5. `codex-cli` with saved API key: CLI receives `OPENAI_API_KEY` in env
6. Both JSON and text CLI outputs are handled correctly

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Proto change for `credential_env_key` requires `model/build.sh` | Keep field optional; Station returns it in JSON directly if proto update is too heavy |
| Session loss on BFF restart | Use `make desktop` (proper profile) instead of manual binary start |
| Different accounts see different model lists | By design — per-actor scoping is correct |

---

## Status

| WS | Status | Last updated |
|----|--------|-------------|
| WS-1 | DONE | 2026-07-29 |
| WS-2 | DONE | 2026-07-29 |
| WS-3 | DONE | 2026-07-29 |
| WS-4 | DONE | 2026-07-29 |
| WS-5 | DONE | 2026-07-29 |

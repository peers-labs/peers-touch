# Provider Runtime Strategy — Architecture Design

> Status: DRAFT
> Author: AI-assisted
> Date: 2026-07-29

## 1. Problem Statement

Provider model management has two distinct runtime kinds (`direct` and `cli`) but currently shares a single naive code path. This causes:

- CLI-fetched models weren't persisted (fixed today — partial)
- CLI commands run without actor context (shared env, no credential injection)
- Model toggle/enable state wasn't persisted (fixed today)
- No workspace isolation between actors on the same Desktop
- No output format negotiation for CLI providers

## 2. Design Constraint

**Build on existing foundation only.** No new services, no new tables, no new abstractions beyond strategy dispatch.

Existing primitives to reuse:
- `agent_models` table (per-actor model store) — already used
- `agent_providers` table (per-actor provider config) — already used
- `agent_credential_pool` table (per-actor credential vault) — exists, partially wired
- Catalog YAML (`providers.default.yaml`) — provider metadata + defaults
- Rust BFF CLI execution (`execute_cli_models_command`) — local subprocess
- Station `model/create`, `model/update`, `model/list` — CRUD APIs

## 3. Strategy Pattern

Each provider's `runtime_kind` dispatches to a **ProviderStrategy** that governs the full lifecycle:

```
┌─────────────────────────────────────────────────────────┐
│                   ProviderStrategy                        │
├─────────────────────────────────────────────────────────┤
│  discover()      → fetch available models                │
│  inject()        → prepare auth/env for execution        │
│  execute(prompt) → run inference and return response     │
│  parse_output()  → normalize CLI/API response format     │
│  persist()       → store model config to Station         │
│  teardown()      → cleanup workspace/temp resources      │
└─────────────────────────────────────────────────────────┘
```

### 3.1 DirectStrategy (runtime_kind: absent or "direct")

Providers: `ark`, `openai`, `anthropic`, `google`, `deepseek`, `ollama`, `openrouter`, `mistral`, `groq`, `together`, `cohere`

| Concern | Implementation |
|---------|----------------|
| **discover** | Call remote API (OpenAI `/models`, Anthropic models list, etc.) via protocol-specific adapter |
| **inject** | Resolve API key from `agent_credential_pool` for the logged-in actor |
| **execute** | HTTP request to `base_url` with injected key |
| **parse_output** | Protocol-specific response parsing (OpenAI, Anthropic, Gemini formats) |
| **persist** | `model/create` per discovered model; `model/update` for toggle |
| **teardown** | N/A |

Key injection flow:
```
Actor logs in → Desktop BFF resolves token → Station credential_pool lookup
→ decrypt key_vaults → inject into HTTP Authorization header
```

Already works today. No changes needed for Direct providers.

### 3.2 CLIStrategy (runtime_kind: "cli")

Providers: `trae-cli`, `codex-cli`, `cursor-cli`, `claude-cli`

| Concern | Implementation |
|---------|----------------|
| **discover** | Execute `models_command` locally, parse output |
| **inject** | Per-actor env vars + workspace isolation |
| **execute** | Execute `cli_command` with actor context |
| **parse_output** | Normalize CLI stdout to unified format |
| **persist** | Same as Direct — `model/create` to Station |
| **teardown** | Cleanup temp files in actor workspace dir |

## 4. CLI Provider: Per-Actor Isolation

### 4.1 Actor Workspace

Each actor gets an isolated working directory for CLI execution:

```
$PEERS_DATA_DIR/actors/<actor_id>/cli/<provider_id>/
├── workspace/      ← CLI working directory
├── config/         ← Provider-specific config files
└── output/         ← Last response cache
```

`$PEERS_DATA_DIR` is the Tauri app data directory (already exists: `~/.peers-touch/` on macOS).

### 4.2 Account Injection

When executing a CLI command for an actor, the Rust BFF injects:

| Env Var | Source | Purpose |
|---------|--------|---------|
| `PEERS_ACTOR_ID` | Session resolver | Actor identity |
| `PEERS_PROVIDER_ID` | Catalog/DB | Which provider is executing |
| `PEERS_WORKSPACE` | Actor workspace path | CLI working dir |
| `PEERS_STATION_URL` | Profile config | Station callback URL |
| `PEERS_AUTH_TOKEN` | Session token (short-lived) | CLI→Station auth if needed |

The CLI command runs with `cwd` set to `$PEERS_WORKSPACE` and receives these env vars. This is the "account injection" — the CLI knows who it's acting for.

### 4.3 Credential Resolution for CLI

Some CLI providers authenticate via their own mechanism (e.g., `claude-cli` uses `~/.claude/credentials`, `codex-cli` uses `OPENAI_API_KEY`). The strategy handles this per-provider:

| Provider | Credential Source | Injection Method |
|----------|-------------------|------------------|
| `trae-cli` | TRAE session (browser cookie) | Already embedded in CLI binary |
| `codex-cli` | OpenAI API key | `OPENAI_API_KEY` env var from `credential_pool` |
| `cursor-cli` | Cursor session | Already embedded in CLI binary |
| `claude-cli` | Anthropic API key | `ANTHROPIC_API_KEY` env var from `credential_pool` |

For providers that embed their own auth (trae, cursor), no extra injection needed.
For providers that need an API key (codex, claude), resolve from `agent_credential_pool` where `provider_id` matches, inject as env var.

## 5. CLI Output Format Contract

### 5.1 Discovery Output (`models_command`)

The CLI MUST output one of:
1. **JSON object** with `models` array: `{"models": ["model-a", "model-b"]}`
2. **JSON array**: `["model-a", "model-b"]`
3. **JSON object array**: `[{"id": "model-a", "display_name": "Model A"}]`
4. **Plain text** — one model ID per line

Already implemented in `parse_json_models()`. No change needed.

### 5.2 Execution Output (`cli_command`)

The CLI receives prompt on stdin and outputs response on stdout. Format:

1. **Plain text** (default) — response body is the full stdout
2. **JSON** — if stdout starts with `{`, parse as `{"content": "...", "model": "...", "usage": {...}}`
3. **Streaming** (future) — line-delimited JSON chunks

The `parse_output()` strategy method handles format detection and normalization.

### 5.3 Per-Provider Output Specifics

| Provider | `cli_command` | Stdin | Stdout Format |
|----------|---------------|-------|---------------|
| `trae-cli` | `traecli exec --skip-git-repo-check -` | Prompt text | Plain text |
| `codex-cli` | `codex exec --skip-git-repo-check -` | Prompt text | Plain text |
| `cursor-cli` | `cursor-agent --print --output-format text --trust` | Prompt text | Plain text |
| `claude-cli` | `claude -p` | Prompt text | Plain text (or markdown) |

All current CLI providers use plain-text stdout. JSON format support is for future extensibility.

## 6. Implementation Location

All changes fit within existing modules:

| Layer | File | Change |
|-------|------|--------|
| Rust BFF | `src/application/provider/mod.rs` | Add `CLIStrategy` struct with workspace + env injection |
| Rust BFF | `src/application/provider/cli_strategy.rs` (new file) | Strategy implementation |
| Rust BFF | `src/application/provider/station_api.rs` | Already has `resolve_credential` |
| Station | `handler/provider_handler.go` | Already patched (DB merge in get_provider) |
| Station | `service/model_config_service.go` | Already patched (idempotent create) |
| Frontend | `components/settings/ProviderDetail.tsx` | Already patched (unified addModel path) |
| Config | `catalog/providers.default.yaml` | Add `credential_env_key` field per CLI provider |

## 7. Catalog Extension

Add optional field to CLI providers in the catalog YAML:

```yaml
- id: codex-cli
  runtime_kind: cli
  credential_env_key: OPENAI_API_KEY    # ← NEW: which env var to inject
  cli_command: codex exec --skip-git-repo-check -
  models_command: ""
```

For providers that don't need external credentials (trae-cli, cursor-cli), omit `credential_env_key`.

## 8. Execution Flow (Complete)

```
User clicks "Send" with CLI provider selected
  → Frontend: api.sendMessage(provider_id, model_id, prompt)
  → Rust BFF: resolve actor from session
  → Rust BFF: CLIStrategy.inject(actor_id, provider_id)
     ├── Resolve workspace: $PEERS_DATA_DIR/actors/<actor_id>/cli/<provider_id>/workspace/
     ├── If credential_env_key defined:
     │     └── station_api::resolve_credential(token, provider_id)
     │         → decrypt → set env var
     └── Build env map: PEERS_ACTOR_ID, PEERS_WORKSPACE, credential key
  → Rust BFF: CLIStrategy.execute(cli_command, prompt, env_map, cwd)
     ├── Spawn subprocess with injected env + cwd
     ├── Write prompt to stdin
     └── Read stdout
  → Rust BFF: CLIStrategy.parse_output(stdout)
     └── Detect format → normalize to {content, model, usage}
  → Return to frontend
```

## 9. What's Already Done (Today's Fix)

| Item | Status |
|------|--------|
| Per-actor model persist (CLI + Direct) | ✅ Done |
| Idempotent model/create in Station | ✅ Done |
| DB model merge in HandleProviderGet | ✅ Done |
| model_toggle wired to Station update | ✅ Done |

## 10. What Remains

| Item | Effort | Priority |
|------|--------|----------|
| Actor workspace directory creation | Small | P1 |
| Env injection in `execute_cli_models_command` | Small | P1 |
| Env injection in CLI chat execution path | Medium | P1 |
| `credential_env_key` in catalog + resolve logic | Medium | P2 |
| Output format detection + normalization | Small | P2 |
| Workspace cleanup/teardown | Small | P3 |

## 11. Non-Goals (v1)

- Per-actor CLI binary version management (all actors share the same installed CLI)
- CLI sandboxing/containerization
- Streaming output support
- CLI health monitoring/auto-restart

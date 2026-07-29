# Provider Station Ownership — Architecture Design

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-23 | **Updated**: 2026-07-23
> **Owner**: Agent Team

---

## 1. Core Principles

1. **Station-sole-executor** — All AI provider calls (HTTP, CLI, embedded) execute on Station. No client ever calls an LLM API directly.
2. **Client-as-editor** — Desktop/Mobile are the only UI surfaces for provider/credential/model CRUD. Mutations submit to Station API.
3. **Per-actor isolation** — Each actor's provider config, credentials, and model access are independent. Actor A's data never leaks to Actor B.
4. **Version-gated writes** — Every config record carries a monotonic version. Stale mutations are rejected (optimistic concurrency). Prevents split-brain across multiple devices.
5. **SSE-only AI delivery** — AI responses stream from Station to clients via Server-Sent Events. No polling, no WebSocket for this path.
6. **Cache for speed, Station for truth** — Clients cache provider/model config locally. On conflict or freshness doubt, Station wins.
7. **CLI-as-registered-adapter** — CLI providers are Station-registered runtime adapters, not user-submitted arbitrary commands. Clients select from a provider registry; they cannot submit binary paths, shell fragments, or unconstrained command templates.

---

## 1.1 Proto Source Contracts

Cross-platform data contracts are defined in `model/domain/` proto files. This architecture's contracts map to:

| Contract | Proto source | Notes |
|---|---|---|
| Provider domain model | `model/domain/ai_chat/provider.proto` :: `Provider` | `runtime_kind`, `cli_command`, `version` fields aligned with this design |
| Provider CRUD | `model/domain/ai_chat/provider.proto` :: `Create/Update/Delete/List/GetProviderRequest` | `UpdateProviderRequest.version` and `DeleteProviderRequest.version` carry optimistic lock |
| Model domain model | `model/domain/ai_chat/ai_models.proto` :: `AiModel` | Links to provider via `provider_id`; carries `version` for optimistic lock |
| Turn execution | `model/domain/agent/agent.proto` :: `ExecuteTurnRequest` | `provider` field selects registered provider_id |

JSON APIs in §5 and `data-model.md` are the protobuf JSON mapping representation, not independent contracts.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CLIENT (Desktop / Mobile)                             │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Provider Settings UI                                            │   │
│  │  - List/create/update/delete providers                           │   │
│  │  - Enter credentials                                             │   │
│  │  - Enable/disable models                                         │   │
│  │  - All mutations → Station API (with version)                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Provider Config Cache                                           │   │
│  │  - Versioned local copy of provider/model/credential-status      │   │
│  │  - Refresh: app foreground, post-mutation, periodic sync         │   │
│  │  - On version conflict: discard local, re-fetch                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Agent Chat (SSE Consumer)                                       │   │
│  │  - POST /sub-agent/agent/turn/stream                             │   │
│  │  - Receives SSE: text | tool_call | thinking | done | error      │   │
│  │  - Never calls LLM APIs directly                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS + SSE
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          STATION                                         │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Agent Subserver (/sub-agent)                                     │  │
│  │                                                                    │  │
│  │  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐   │  │
│  │  │ Provider     │  │ Credential Pool  │  │ Turn Execution    │   │  │
│  │  │ Config API   │  │ (per-actor)      │  │ Engine            │   │  │
│  │  │              │  │                  │  │                   │   │  │
│  │  │ CRUD +       │  │ Lease/Release/   │  │ Resolve provider  │   │  │
│  │  │ version gate │  │ Rotate/Exhaust   │  │ → call LLM API   │   │  │
│  │  │              │  │                  │  │ → stream SSE back │   │  │
│  │  └──────────────┘  └──────────────────┘  └───────────────────┘   │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────────────────────────────────┐ │  │
│  │  │ Provider Execution Runtime                                    │ │  │
│  │  │ - HTTP providers: direct outbound HTTP to LLM vendor          │ │  │
│  │  │ - CLI providers: subprocess on Station host                   │ │  │
│  │  │ - Embedded providers: in-process inference (future)           │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  PostgreSQL (per-actor tables)                                     │  │
│  │  - agent_providers: provider config + version                      │  │
│  │  - agent_credential_pool: encrypted credentials + version          │  │
│  │  - agent_models: model list per provider + version                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Sources Of Truth And Ownership

| Capability | Source of truth | Mutation authority | Read authority |
|---|---|---|---|
| Provider config (id, name, type, base_url, enabled) | Station DB `agent_providers` | Client via Station API (version-gated) | Client (cached), Station |
| Credentials (api_key, secret, token) | Station DB `agent_credential_pool` | Client via Station API (version-gated) | Station only (never sent to client) |
| Credential status (configured/exhausted/error) | Station DB | Station (runtime updates) | Client (status projection only) |
| Model list (per provider) | Station DB `agent_models` | Client via Station API + Station remote-fetch | Client (cached), Station |
| Model capabilities (vision, tools, reasoning) | Station DB `agent_models` | Station (from provider remote-fetch) | Client (cached) |
| Selected model per actor | Station DB (agent session/config) | Client via Station API | Client (cached) |
| Turn execution | Station runtime (in-memory) | Station only | Client (SSE stream) |
| Provider execution (LLM API calls) | Station runtime | Station only | N/A |

---

## 4. Runtime Units And Boundaries

### 4.1 Runtime Units

| Unit | Process | Owner | Lifecycle |
|---|---|---|---|
| Desktop Web (React) | Browser/WebView | Client | User session |
| Desktop Rust (Tauri) | Native process | Client | App lifecycle |
| Station Agent Subserver | Go process | Station | Server uptime |
| Station Provider Runtime | Go goroutines + subprocesses | Station | Per-turn |
| PostgreSQL | Separate process | Station infra | Always-on |

### 4.2 Trust Boundaries

```
Client ←──[TLS + JWT]──→ Station
  │                          │
  │ (untrusted network)      │ (trusted internal)
  │                          │
  └── never sees credentials  └── holds credentials, calls LLM vendors
```

- Client presents JWT (actor identity) on every request.
- Station validates JWT, resolves actor, scopes all queries to that actor.
- Credentials never leave Station. Client sees only `{configured: true/false, status: ok/exhausted/error}`.

### 4.3 Allowed Calls

| From | To | Method | Purpose |
|---|---|---|---|
| Client | Station `/sub-agent/agent/provider/*` | HTTP POST | Provider CRUD |
| Client | Station `/sub-agent/agent/model/*` | HTTP POST | Model CRUD |
| Client | Station `/sub-agent/agent/credential/*` | HTTP POST | Credential set/delete |
| Client | Station `/sub-agent/agent/turn/stream` | HTTP POST → SSE | Execute AI turn |
| Station | LLM vendor API (OpenAI, Anthropic, etc.) | HTTP | Provider execution |
| Station | CLI subprocess (trae, codex, etc.) | spawn | CLI provider execution |

### 4.4 Forbidden Calls

| From | To | Reason |
|---|---|---|
| Client | LLM vendor API | All execution is Station-owned |
| Client | CLI subprocess for AI turn | All execution is Station-owned |
| Station | Client (push) for config | Client pulls; Station does not push config |
| Actor A request | Actor B credentials/config | Per-actor isolation |

---

## 5. Contracts And Invariants

### 5.1 Version-Gated Mutation Contract

```
POST /sub-agent/agent/provider/update
{
  "provider_id": "trae-cli",
  "version": 3,
  "changes": { "enabled": true, "base_url": "..." }
}

→ 200 OK: { "provider_id": "trae-cli", "version": 4, ...updated fields... }
→ 409 Conflict: { "error": "VERSION_CONFLICT", "current_version": 5 }
```

Invariants:
- Version is monotonic per record per actor.
- Mutation without version field is rejected (not treated as "force").
- On 409, client must re-fetch and re-apply.

### 5.2 SSE Turn Stream Contract

```
POST /sub-agent/agent/turn/stream
Authorization: Bearer <jwt>
Content-Type: application/json
Accept: text/event-stream

{
  "conversation_id": "...",
  "agent_id": "...",
  "provider": "trae-cli",
  "model": "Test-O-New-Thinking",
  "user_input": "hello",
  "effort": "medium"
}

→ 200 OK (SSE stream)
event: text
data: {"text": "Hello! ", "model": "Test-O-New-Thinking"}

event: text
data: {"text": "How can I help?"}

event: done
data: {"model": "Test-O-New-Thinking", "turn_id": "turn_abc123"}
```

Error events:
```
event: error
data: {"error": "[AGENT_5004] no credentials registered for provider \"trae-cli\"", "code": "AGENT_5004"}
```

### 5.3 Credential Security Invariants

1. Credential values (api_key, secret) are never included in any client-facing API response.
2. Client submits credentials via dedicated endpoint; response confirms success without echoing the value.
3. Station encrypts credentials at rest.
4. Credential status (configured/exhausted/cooldown/error) is exposed to client for UI display.
5. Logs never contain credential values.

### 5.4 Per-Actor Isolation Invariants

1. All provider/credential/model queries include actor_id filter.
2. JWT actor_id is the sole identity source — cannot be overridden by request body.
3. A request for actor A must never return or mutate actor B's records.
4. Global/shared providers (if any) are explicitly marked and read-only from client perspective.

### 5.5 Turn-Time Revalidation Invariant

Station MUST revalidate provider/model/credential state from DB at turn execution time. Client-submitted `provider` and `model` in the turn request are **selection intent only**, not execution authority. Specifically:
1. Provider must exist, be enabled, and belong to requesting actor.
2. Model must exist, be enabled, and belong to the specified provider.
3. Credential must be in `active` status for that provider+actor.
4. If any check fails, the turn is rejected with a typed error before execution begins.

### 5.6 CLI Execution Safety Invariants

1. Station MUST NOT execute any binary not present in its adapter registry.
2. Every CLI adapter invocation MUST have a bounded timeout. Timeout expiry triggers process group termination.
3. Station MUST be able to reclaim (kill) any spawned adapter process at any time (turn cancellation, shutdown, resource pressure).
4. Adapter stdout/stderr MUST NOT be forwarded to clients without sanitization. Credential values, internal paths, and environment variables must be stripped.

### 5.7 SSE Disconnect And Turn Lifecycle Invariant

Station owns turn and subprocess lifecycle independent of client connection state:
1. Client SSE disconnect triggers turn cancellation on Station.
2. Turn cancellation triggers subprocess cleanup (SIGTERM → SIGKILL after grace period) for CLI providers.
3. Station MUST NOT leave orphan subprocesses after turn completion, cancellation, or error.

### 5.8 Runtime Kind Write Restriction

`runtime_kind` for CLI-type providers is derived from Station's adapter registry, not freely assigned by clients:
1. When a provider's `provider_id` maps to a registered CLI adapter, Station sets `runtime_kind = "cli"` regardless of client-submitted value.
2. Clients MUST NOT change a non-CLI provider to `runtime_kind = "cli"` unless it corresponds to a registered adapter.
3. Station rejects `runtime_kind = "cli"` for any provider_id not in the adapter registry.

---

## 6. Component Relationships

### 6.1 Client: Provider Settings UI

- **Responsibility**: Render provider/model/credential settings; submit mutations to Station.
- **Owner**: Desktop Web / Mobile UI
- **Inputs**: Cached provider config (from local cache or fresh fetch)
- **Outputs**: Mutation requests to Station API
- **Dependencies**: Station Provider Config API
- **Source of truth it mutates**: Station (via API)
- **Must NOT**: Store credentials locally, call LLM APIs, resolve provider execution

### 6.2 Client: Provider Config Cache

- **Responsibility**: Keep a versioned local copy of provider/model config for fast UI rendering.
- **Owner**: Desktop Rust (Tauri) / Mobile native layer
- **Inputs**: Station API responses (with version)
- **Outputs**: Cached data for UI layer
- **Dependencies**: Station Provider Config API
- **Lifecycle**: Refresh on app foreground, post-mutation, periodic sync
- **Must NOT**: Be treated as source of truth for execution decisions

### 6.3 Client: Agent Chat (SSE Consumer)

- **Responsibility**: Send turn requests, receive and render SSE stream.
- **Owner**: Desktop Web / Mobile UI
- **Inputs**: User message, selected provider/model (from cache)
- **Outputs**: Rendered AI response
- **Dependencies**: Station Turn Stream endpoint
- **Must NOT**: Execute provider calls, store turn state as authoritative

### 6.4 Station: Provider Config API

- **Responsibility**: CRUD for provider/model config, version-gated writes, per-actor scoping.
- **Owner**: Agent subserver
- **Inputs**: Client mutations (with version + JWT actor_id)
- **Outputs**: Updated config with new version
- **Dependencies**: PostgreSQL
- **Must NOT**: Accept writes without version, return credentials in responses

### 6.5 Station: Credential Pool Service

- **Responsibility**: Store, lease, rotate, and recover credentials per actor per provider.
- **Owner**: Agent subserver
- **Inputs**: Turn execution requests (provider + actor_id)
- **Outputs**: Leased credential for turn execution
- **Dependencies**: PostgreSQL `agent_credential_pool`
- **Must NOT**: Expose credential values to any external API, share across actors

### 6.6 Station: Turn Execution Engine

- **Responsibility**: Resolve provider + model + credential → execute LLM call → stream SSE response.
- **Owner**: Agent subserver
- **Inputs**: Turn request (provider, model, messages, actor_id)
- **Outputs**: SSE event stream (text, tool_call, thinking, done, error)
- **Dependencies**: Credential Pool, Provider Execution Runtime
- **Must NOT**: Return credentials in error messages, execute without valid credential lease

### 6.7 Station: Provider Execution Runtime

- **Responsibility**: Call LLM vendor APIs or invoke registered CLI adapters.
- **Owner**: Agent subserver
- **Inputs**: Resolved provider config + leased credential + request payload
- **Outputs**: Raw LLM response stream
- **Runtime kinds**: HTTP (OpenAI-compatible), CLI (Station-registered adapter), Embedded (future)
- **CLI constraint**: Only pre-registered adapter binaries may execute. The adapter registry is Station-configured (code or config file), not client-writable. `cli_command` field stores the adapter identifier, not an arbitrary path or shell command.
- **Must NOT**: Be called directly by clients, retain state across turns, execute unregistered binaries

---

## 7. Forbidden Relationships

1. Desktop/Mobile must NOT execute any LLM API call or spawn CLI for AI turns.
2. Desktop/Mobile must NOT persist credentials locally (ephemeral form state only).
3. Station must NOT serve provider config without actor_id scoping.
4. Station must NOT accept config mutations without version field.
5. Station must NOT return credential values in any API response.
6. Station must NOT execute turns with another actor's credentials.
7. Client must NOT treat local cache as authoritative when version is stale.
8. Client must NOT hardcode default provider/model lists.
9. Station credential pool must NOT log credential values.
10. Client must NOT submit arbitrary binary paths, shell fragments, or command templates as `cli_command`. Only Station-registered adapter identifiers are accepted.
11. Station must NOT execute a CLI adapter identifier that is not present in its local adapter registry.

---

## 8. Quality Outcomes And Evidence Requirements

| Outcome | Evidence required |
|---|---|
| Per-actor isolation | Test: Actor A creates provider; Actor B cannot see/use it |
| Version conflict rejection | Test: Two concurrent updates from different devices; second gets 409 |
| Credential security | Test: No API response or log entry contains credential values |
| SSE delivery | Test: Turn request produces streaming SSE events received by client |
| CLI provider execution on Station | Test: CLI-type provider executes subprocess on Station host and streams result |
| Cache invalidation | Test: After mutation, client cache reflects new version within one refresh cycle |
| Error surfacing | Test: Missing credential produces typed error (AGENT_5004) visible in client UI |

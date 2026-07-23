# Provider Station Ownership — Data Model

> **Status**: draft
> **Version**: v1.0

---

## 1. Station Database Schema

### 1.1 `agent_providers`

Per-actor provider configuration.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(36) PK | UUID |
| actor_id | varchar(36) NOT NULL | Owner actor |
| provider_id | varchar(64) NOT NULL | Logical provider name (e.g. "trae-cli", "openai", "anthropic") |
| display_name | varchar(128) | Human-readable name |
| runtime_kind | varchar(16) NOT NULL | "http" \| "cli" \| "embedded" |
| base_url | varchar(512) | API base URL (for HTTP providers) |
| cli_command | varchar(256) | CLI binary name (for CLI providers) |
| enabled | boolean NOT NULL DEFAULT true | |
| config_json | jsonb | Provider-specific config (model defaults, timeout, etc.) |
| version | bigint NOT NULL DEFAULT 1 | Monotonic version for optimistic locking |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint: `(actor_id, provider_id)`

### 1.2 `agent_credential_pool`

Per-actor credentials. Values encrypted at rest.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(36) PK | UUID |
| actor_id | varchar(36) NOT NULL | Owner actor |
| provider | varchar(64) NOT NULL | FK → provider_id |
| api_key_encrypted | bytea NOT NULL | Encrypted API key |
| status | varchar(16) NOT NULL DEFAULT 'active' | "active" \| "exhausted" \| "error" \| "cooldown" |
| request_count | bigint NOT NULL DEFAULT 0 | Total requests made |
| cooldown_until | timestamptz | When exhausted/error, retry after this time |
| version | bigint NOT NULL DEFAULT 1 | Monotonic version |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint: `(actor_id, provider)`

### 1.3 `agent_models`

Per-actor model list within a provider.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(36) PK | UUID |
| actor_id | varchar(36) NOT NULL | Owner actor |
| provider_id | varchar(64) NOT NULL | FK → provider_id |
| model_id | varchar(128) NOT NULL | Model identifier (e.g. "gpt-4.1", "Test-O-New-Thinking") |
| display_name | varchar(256) | |
| enabled | boolean NOT NULL DEFAULT true | |
| capabilities_json | jsonb | {"vision": true, "tools": true, "reasoning": true, ...} |
| context_window | integer | Token limit |
| version | bigint NOT NULL DEFAULT 1 | Monotonic version |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint: `(actor_id, provider_id, model_id)`

---

## 2. Client Cache Schema (Local)

Desktop Rust / Mobile stores a local projection (no credentials):

```rust
struct CachedProvider {
    provider_id: String,
    display_name: String,
    runtime_kind: String,
    enabled: bool,
    version: u64,
}

struct CachedModel {
    provider_id: String,
    model_id: String,
    display_name: String,
    enabled: bool,
    capabilities: ModelCapabilities,
    context_window: u32,
    version: u64,
}

struct CachedCredentialStatus {
    provider_id: String,
    configured: bool,     // has credential on Station
    status: String,       // "active" | "exhausted" | "error" | "cooldown"
}
```

---

## 3. API Contracts

### 3.1 Provider Config CRUD

```
POST /sub-agent/agent/provider/list
→ { providers: [CachedProvider...] }

POST /sub-agent/agent/provider/create
{ provider_id, display_name, runtime_kind, base_url?, cli_command?, config_json? }
→ { provider: {..., version: 1} }

POST /sub-agent/agent/provider/update
{ provider_id, version, changes: { enabled?, display_name?, base_url?, config_json? } }
→ 200: { provider: {..., version: N+1} }
→ 409: { error: "VERSION_CONFLICT", current_version: M }

POST /sub-agent/agent/provider/delete
{ provider_id, version }
→ 200: { deleted: true }
→ 409: { error: "VERSION_CONFLICT", current_version: M }
```

### 3.2 Credential Management

```
POST /sub-agent/agent/credential/set
{ provider_id, api_key }
→ 200: { provider_id, status: "active", version: N }

POST /sub-agent/agent/credential/delete
{ provider_id, version }
→ 200: { deleted: true }

POST /sub-agent/agent/credential/status
{ provider_id }
→ { provider_id, configured: true, status: "active", version: N }
```

Note: No endpoint returns the actual credential value.

### 3.3 Model CRUD

```
POST /sub-agent/agent/model/list
{ provider_id }
→ { models: [CachedModel...] }

POST /sub-agent/agent/model/fetch-remote
{ provider_id }
→ { models: [...newly discovered models...], version: N }

POST /sub-agent/agent/model/update
{ provider_id, model_id, version, changes: { enabled?, display_name? } }
→ 200: { model: {..., version: N+1} }
→ 409: { error: "VERSION_CONFLICT", current_version: M }
```

### 3.4 Turn Stream (unchanged path, for reference)

```
POST /sub-agent/agent/turn/stream
Authorization: Bearer <jwt>
Accept: text/event-stream
{ conversation_id, agent_id, provider, model, user_input, ... }
→ SSE stream
```

---

## 4. SSE Event Types

| Event | Data fields | Semantics |
|-------|-------------|-----------|
| `text` | text, model? | Incremental text chunk |
| `thinking` | text | Reasoning/thinking content |
| `tool_call` | toolCallId, toolName, arguments | Tool invocation request |
| `tool_result` | toolCallId, result | Tool execution result |
| `done` | model, turn_id, usage? | Turn completed successfully |
| `error` | error, code? | Turn failed; stream ends |

---

## 5. Version Semantics

- Version starts at 1 on record creation.
- Every successful mutation increments version by 1.
- Version is per-record (not global).
- Client must read version before mutating.
- Server MUST reject mutation where `request.version != record.current_version`.
- On 409, client MUST re-fetch the record, then may re-submit with new version.

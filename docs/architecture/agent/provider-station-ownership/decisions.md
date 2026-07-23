# Provider Station Ownership — Decisions

> **Status**: draft
> **Version**: v1.0

---

## ADR-1: Station Is The Sole Provider Executor

**Context**: Prior design split execution between Desktop (CLI providers) and Station (HTTP providers). This created two code paths, prevented Mobile from using CLI providers, and made credential management inconsistent.

**Decision**: All provider execution moves to Station. Desktop/Mobile never call LLM APIs or spawn AI CLI processes.

**Rationale**: 
- Single execution path simplifies reliability, monitoring, and credential management.
- Mobile gains full AI capability without duplicating Desktop's CLI execution.
- Credentials stay on Station — never transit to or persist on client devices.
- Station can enforce rate limiting, rotation, and quota uniformly.

**Alternatives considered**:
- Keep CLI on Desktop, HTTP on Station (prior design) — rejected: splits execution, blocks Mobile, complicates credential sync.
- Hybrid with Desktop fallback when Station unreachable — rejected: complexity of dual-path; offline AI is a non-goal.

**Consequences**:
- Station must support CLI subprocess execution (new capability).
- Existing Desktop Rust CLI execution paths must be removed.
- Latency increases slightly for CLI providers (network hop to Station + back). Acceptable for the consistency gain.

---

## ADR-2: Client Is The Only Config Editing Surface

**Context**: Station has no admin dashboard for provider config. Users configure providers through Desktop or Mobile settings.

**Decision**: Desktop/Mobile settings UI is the sole editing surface for provider/credential/model config. All mutations submit to Station API.

**Rationale**:
- Users already interact with settings on their device.
- Building a separate Station admin UI duplicates effort and creates a second editing path to reconcile.
- Station remains a headless service for this domain.

**Alternatives considered**:
- Station Dashboard provider admin page — rejected: extra UI to maintain, most users access from Desktop/Mobile anyway.
- Config file on Station host — rejected: not per-actor, not version-gated, requires SSH access.

**Consequences**:
- Station provider APIs must support full CRUD, not just read.
- Client must handle 409 (version conflict) gracefully.

---

## ADR-3: Optimistic Concurrency Via Monotonic Version

**Context**: Same actor may edit provider config from Desktop and Mobile concurrently. Without coordination, last-write-wins causes silent data loss.

**Decision**: Every config record carries a monotonic `version` field. Mutations must include the version read by the client. Station rejects if submitted version ≠ current version (409 Conflict).

**Rationale**:
- Optimistic locking is lightweight — no distributed locks needed.
- Conflict is rare (same actor editing same provider from two devices simultaneously).
- On conflict, client simply re-fetches and re-applies, preserving user intent.

**Alternatives considered**:
- Last-write-wins without version — rejected: silent data loss.
- Distributed lock (pessimistic) — rejected: over-engineered for low-contention single-actor edits.
- CRDT merge — rejected: provider config is not a collaborative document; conflict resolution is trivial (re-fetch + re-apply).

**Consequences**:
- Every provider/credential/model table needs a `version` column.
- Client must handle 409 and implement re-fetch + re-apply UX.
- First deployment requires migration adding version columns with initial value 1.

---

## ADR-4: Per-Actor Credential Isolation

**Context**: Multi-actor Station serves different users. Each user may have different API keys for the same provider (e.g., both Actor A and Actor B use OpenAI but with their own keys).

**Decision**: Credential pool is scoped by `actor_id`. Queries always include actor filter. No global credential sharing by default.

**Rationale**:
- Prevents credential leakage between actors.
- Each actor pays for their own usage.
- Simplifies billing and quota enforcement.

**Alternatives considered**:
- Global credential pool shared by all actors — rejected: security risk, billing confusion.
- Admin-managed shared pool with per-actor override — deferred: can be added later as an explicit opt-in feature without breaking per-actor default.

**Consequences**:
- Every credential table query adds `AND actor_id = ?`.
- Station must never fall back to "any available credential" when actor-specific one is missing.
- Error message must clearly state "no credentials for provider X" rather than silently using another actor's key.

---

## ADR-5: Credentials Never Leave Station

**Context**: Client needs to submit credentials (user types API key in settings). After submission, should the client cache it?

**Decision**: After credential submission, Station stores it and responds with success status only. Credential values are never returned in any API response. Client shows only `{status: "configured"}`.

**Rationale**:
- Minimizes attack surface — compromised client device cannot extract stored credentials.
- Credential rotation on Station doesn't require client update.
- Aligns with first-principles: no secrets in logs, validate auth for all handlers.

**Alternatives considered**:
- Return masked credential (last 4 chars) — acceptable for UX, can be added later without architecture change.
- Store credential locally for offline — rejected: offline AI is a non-goal; credentials on client is a security risk.

**Consequences**:
- Settings UI shows "API key configured" / "not configured", never the actual key.
- To update a credential, user must re-enter the full value (cannot "edit" existing).
- If user forgets their key, they must obtain it from the provider again.

# Social Gate Policy Layer

> **Status**: draft
> **Layer**: Architecture
> **Owner**: Station
> **Upstream**: `docs/global/architecture.md`, `docs/global/first-principles.md` (L0-4), `docs/global/coding-guide/api-field-placement.md`

---

## 1. Problem Statement

All conversation and social subserver handlers currently perform only JWT identity extraction. Business-level access control (relationship gates, role enforcement, block/ban, rate limiting, federation trust) is either:
- Missing entirely (e.g., `createDirect` has zero relationship check)
- Inline-hardcoded in individual handlers (e.g., membership check in `handleMlsDistribute`)
- Documented in `group-lifecycle.md` contracts but not consistently enforced

This violates L0-4: "Validate auth/ownership checks for all read/write handlers."

The Access Gate Chain (`docs/architecture/platform/station/access/`) is explicitly scoped to pre-login admission and cannot be reused for in-shell social policy.

---

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence |
|-------|-------|----------|------------|
| `handleCreateDirect` has no friendship check | `verified_fact` | Source: `subserver.go` line 174-193 | High |
| `handleMlsDistribute` does inline membership check | `verified_fact` | Source: `subserver.go` line 429-438 | High |
| Access Gate is pre-login only | `verified_fact` | Source: `adding-an-access-gate.md` | High |
| L0-4 requires auth/ownership on all handlers | `verified_fact` | Source: `first-principles.md` | High |
| Station owns all authorization decisions | `verified_fact` | Source: `architecture.md` Section 3.3 | High |
| `group-lifecycle.md` defines role hierarchy rules | `verified_fact` | Source: `group-lifecycle.md` Section 5 | High |
| Federation JWT provides inter-station trust | `verified_fact` | Source: `authfed` package implementation | High |
| No in-shell policy middleware exists | `verified_fact` | Grep: zero `PolicyMiddleware`/`SocialGate` in codebase | High |

---

## 3. Scope

### In Scope
- Unified policy evaluation layer for all social/conversation operations
- Relationship gates (friendship, group membership, invitation validity)
- Role-based action authorization (owner > admin > member)
- Block/ban enforcement
- Federation trust policy (which remote stations can deliver/request)
- Rate limiting for anti-spam/abuse
- Policy configuration by Station operator (via Dashboard)

### Non-Scope
- Pre-login access gates (existing Access Gate Chain)
- JWT issuance/verification (existing `frame/core/auth`)
- MLS/Double Ratchet cryptographic operations
- Message content moderation (future domain)
- End-user UI for privacy settings (client-layer)

---

## 4. Sources of Truth & Ownership

| Source of Truth | Owner | Mutation Authority |
|----------------|-------|-------------------|
| Policy rules (what's allowed/denied) | Station operator | Dashboard → Station API |
| Relationship state (friendships) | Station | Friend request/accept flow |
| Group membership + roles | Station | Conversation service |
| Block/ban records | Station | User action → Station API |
| Federation trust policies | Station operator | Dashboard + Federation Ledger |
| Rate limit counters | Station (ephemeral) | Request arrival |

---

## 5. Runtime Units & Boundaries

```
┌────────────────────────────────────────────────────────────────┐
│  Client Request                                                 │
│  (JWT in Authorization header)                                  │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  1. JWT Middleware (existing)                                  │
│     → Extracts Subject{ID, SessionID} into context            │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  2. Social Gate Evaluator (NEW)                               │
│     ─ server.Wrapper implementation                           │
│     ─ Route → PolicySet → Evaluate(ctx, subject, request)     │
│     ─ Returns: Allow / Deny(reason) / RateLimit               │
│     ─ Runs BEFORE handler body                                │
└──────────────────────┬───────────────────────────────────────┘
                       │ (if Allow)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  3. Handler (existing)                                        │
│     ─ Business logic only                                     │
│     ─ No inline permission checks (removed)                   │
└──────────────────────────────────────────────────────────────┘
```

For **federation inbound** (remote station delivering envelopes):

```
┌──────────────────────────────────────────────────────────────┐
│  Remote Station Request                                       │
│  (Federation JWT in Authorization header)                     │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  1. Federation JWT Verifier (existing)                        │
│     → Extracts FederationClaims into context                  │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  2. Federation Trust Gate (NEW)                               │
│     ─ Is this station in our trust list?                      │
│     ─ Is the claimed sender a known actor on that station?    │
│     ─ Rate limit per remote station                           │
└──────────────────────┬───────────────────────────────────────┘
                       │ (if Allow)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  3. Federation Handler                                        │
└──────────────────────────────────────────────────────────────┘
```

### Trust Boundaries

| Boundary | Trust Level | Gate Required |
|----------|------------|---------------|
| Client → Station (authenticated) | Subject verified | Social Gate |
| Remote Station → Local Station | Federation JWT verified | Federation Trust Gate |
| Station → Client (response) | Station is authority | None (no gate) |

### Forbidden Relationships

- Handler MUST NOT perform its own relationship/role checks — all policy via Gate
- Client MUST NOT cache or enforce policy decisions — server-only
- Gate MUST NOT mutate business state — read-only evaluation
- Gate MUST NOT block on external network calls per-request (use cached state)

---

## 6. Contracts & Operational Semantics

### 6.1 Gate Evaluation Interface (process-internal, not proto)

The gate is a **process-internal Wrapper** — it does not cross process/language boundaries, so it uses a plain Go interface rather than proto:

```go
// frame/core/social_gate/gate.go

type SocialGate interface {
    Evaluate(ctx context.Context, op Operation) error
}

type Operation struct {
    Action         string // "create_direct", "send_message", "add_member", "remove_member", etc.
    TargetActorDID string // target user DID (empty for list/self operations)
    ConversationID string // target conversation (empty for create operations)
}
```

- **Subject**: extracted from `ctx` via `coreauth.GetSubject(ctx)` — not a field
- **Return `nil`**: allow (pass through to handler)
- **Return `*PolicyDeniedError`**: deny → HTTP 403
- **Return `*RateLimitedError`**: rate limited → HTTP 429

```go
type PolicyDeniedError struct {
    Code   string // machine-readable, e.g. "RELATIONSHIP_REQUIRED"
    Reason string // human-readable, for server logs only
}

type RateLimitedError struct {
    RetryAfterSec int
}
```

### 6.2 Client-Facing Deny Response (proto, crosses language boundary)

Only the **deny response body** needs proto — it crosses Client↔Station:

```proto
// model/domain/social_policy/policy.proto

message SocialPolicyDenyResponse {
  string code = 1;             // "RELATIONSHIP_REQUIRED", "BLOCKED", "RATE_LIMITED"
  int32 retry_after_sec = 2;   // >0 for rate limit, 0 otherwise
}
```

### 6.3 Policy Rules (configurable by operator)

| Rule ID | Operation | Condition | Default |
|---------|-----------|-----------|---------|
| `R-DM-01` | `create_direct` | Requires mutual friendship OR same-group membership | **Enforce** |
| `R-DM-02` | `create_direct` | Target not blocked by subject | **Enforce** |
| `R-DM-03` | `send_message` (direct) | Active conversation member + not blocked | **Enforce** |
| `R-GRP-01` | `create_group` | Subject has group creation privilege | **Allow all** |
| `R-GRP-02` | `add_member` | Subject is owner/admin of the group | **Enforce** |
| `R-GRP-03` | `remove_member` | Subject outranks target in role hierarchy | **Enforce** |
| `R-GRP-04` | `send_message` (group) | Active member + not muted | **Enforce** |
| `R-GRP-05` | `dissolve` | Subject is owner | **Enforce** |
| `R-KP-01` | `fetch_key_package` | Target is in a shared conversation with subject | **Enforce** |
| `R-FED-01` | Federation deliver | Source station in trust list | **Enforce** |
| `R-FED-02` | Federation KP fetch | Source station in trust list | **Enforce** |
| `R-RATE-01` | All operations | Per-actor sliding window (configurable/op) | **100/min default** |
| `R-BLK-01` | All targeting ops | Target has not blocked subject | **Enforce** |

### 6.3 Failure Semantics

- **Deny** → HTTP 403 with `SocialPolicyDecision` in body
- **Rate Limited** → HTTP 429 with retry-after header
- **Gate evaluation error** (DB failure, cache miss) → **Fail closed** (deny)
- Gate errors logged with full context for operator diagnosis

### 6.4 Caching & Performance

- Relationship state (friendships, blocks): cached per-actor, TTL 30s, invalidated on mutation
- Group membership: already in memory from handler context (no extra query)
- Rate counters: in-memory sliding window, no persistence needed
- Federation trust list: loaded at startup from env/config, hot-reloadable

---

## 7. Component Relationships

### SocialGateEvaluator

| Aspect | Value |
|--------|-------|
| **Responsibility** | Evaluate policy for any social operation before handler executes |
| **Interface** | `server.Wrapper` — wraps the handler in the chain |
| **Inputs** | `context.Context` (with Subject), route name, request body (for target extraction) |
| **Outputs** | Allow (pass through) or Deny/RateLimit (short-circuit with error response) |
| **Dependencies** | RelationshipCache, BlockStore, RateLimiter, FederationTrustConfig |
| **Source of truth** | Reads only; never mutates business state |
| **Lifecycle** | Instantiated per-subserver at Init; stateless per-request |
| **Concurrency** | Thread-safe reads on shared caches |
| **Must NOT** | Import handler business logic, call external services per-request, mutate DB |

### RelationshipCache

| Aspect | Value |
|--------|-------|
| **Responsibility** | Provide fast lookups: "are A and B friends?", "are A and B in a shared conversation?" |
| **Data source** | Friendship table + conversation_member table |
| **Invalidation** | On friendship accept/remove, on member add/remove |
| **TTL** | 30s with stale-while-revalidate |
| **Concurrency** | sync.RWMutex-guarded map |

### BlockStore

| Aspect | Value |
|--------|-------|
| **Responsibility** | "Has actor A blocked actor B?" |
| **Data source** | Block records table |
| **Interface** | `IsBlocked(ctx, actorA, actorB) bool` |

### RateLimiter

| Aspect | Value |
|--------|-------|
| **Responsibility** | Per-actor sliding window rate limiting |
| **Algorithm** | Token bucket or sliding window counter |
| **Storage** | In-memory (lost on restart — acceptable for rate limiting) |
| **Configuration** | Per-operation limits from Station config |

### FederationTrustGate

| Aspect | Value |
|--------|-------|
| **Responsibility** | Verify remote station is trusted before accepting federation requests |
| **Data source** | Trust list from `PEERS_FEDERATION_PEER_MAP` + configurable deny list |
| **Interface** | Separate `server.Wrapper` for federation endpoints only |

---

## 8. Quality Outcomes & Gates

| Scenario | Gate | Method |
|----------|------|--------|
| Unauthenticated actor cannot create DM | Unit test | Submit createDirect without friendship → 403 |
| Blocked actor cannot message target | Unit test | Block B, then B tries sendMessage to A → 403 |
| Non-member cannot fetch KP of stranger | Unit test | fetchKeyPackage for unrelated actor → 403 |
| Gate evaluation adds < 1ms P95 latency | Benchmark | Measure with/without gate wrapper |
| Fail-closed on cache miss | Unit test | Force cache error, verify deny |
| Rate limit fires at threshold | Unit test | Exceed configured limit → 429 |
| Unknown federation station rejected | Unit test | Federation deliver from unlisted peer → 403 |

---

## 9. Decisions

### D-SG-01: Gate as server.Wrapper (not handler-internal)

**Context**: Current checks are inline in handlers. Two options: (a) keep inline but standardize, (b) extract to Wrapper middleware.

**Decision**: Extract to `server.Wrapper` that runs before handler.

**Rationale**: Single enforcement point; handlers become pure business logic; impossible to forget; testable in isolation.

**Negative consequences**: Request body must be partially parsed in wrapper to extract target/conversation IDs. Adds one deserialization pass for requests that need target extraction.

**Alternative rejected**: Handler-internal standardized helper functions — still relies on developer remembering to call them; no enforcement guarantee.

### D-SG-02: Fail-closed on gate evaluation error

**Decision**: If the gate cannot evaluate (DB down, cache corrupt), deny the request.

**Rationale**: L0-4 demands auth validation; allowing through on error creates bypass vulnerability.

**Negative consequences**: Temporary outage of relationship cache causes all social operations to fail.

**Mitigation**: Stale-while-revalidate cache strategy; health monitoring on cache freshness.

### D-SG-03: Relationship requirement for DM is "mutual friendship OR shared group"

**Decision**: To create a direct conversation, subject must share at least one relationship path with target (friend, or co-member of any group).

**Rationale**: Prevents cold-spam DMs from strangers; still allows DMs between group co-members who haven't added each other.

**Alternative rejected**: "Friends only" — too restrictive for federated social network; "open to all" — enables spam.

### D-SG-04: Proto only for cross-boundary deny response

**Decision**: Gate evaluation interface is plain Go (process-internal). Only `SocialPolicyDenyResponse` is proto (crosses Client↔Station boundary).

**Rationale**: Proto-First applies to inter-app communication. The gate is an in-process Wrapper — using proto for internal function calls is over-engineering with no type-safety benefit beyond what Go's type system already provides.

### D-SG-05: Rate limiter is in-memory, not persisted

**Decision**: Rate limit counters stored in-process memory only.

**Rationale**: Rate limiting is best-effort abuse prevention, not a security boundary. Persistence adds complexity without proportional value. Station restart resets counters — acceptable.

---

## 10. Required Documents

- [x] `README.md` (this file)
- [x] `design.md` (this file serves as combined README + design)
- [x] `decisions.md` (D-SG-01 through D-SG-05 above)
- [ ] `data-model.md` — policy rule schema, block/friendship storage model (to be added)
- [ ] `integration.md` — migration plan for existing handlers (to be done by execution planning)

---

## 11. Design Acceptance Gate

### Checklist

- [x] Evidence ledger distinguishes fact/inference/hypothesis/proposal
- [x] Scope, ownership, runtime boundaries explicit
- [x] Forbidden relationships defined
- [x] Contracts cover deny, rate limit, fail-closed
- [x] Quality outcomes have executable evidence requirements
- [x] Decisions include negative consequences and alternatives
- [x] No execution phases disguised as architecture

### Status: `DESIGN_READY_FOR_REVIEW`

Awaiting owner/reviewer acceptance before execution planning begins.

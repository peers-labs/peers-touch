# API Field Placement Standard

> **Status**: active
> **Layer**: Specification (coding guide)
> **Applies to**: All Station HTTP subserver APIs

---

## Principle

Every field in an HTTP request has exactly one correct location. The location is determined by the field's **semantic role**, not by developer convenience or framework defaults.

Misplaced fields create security vulnerabilities (identity spoofing), inconsistency (same concept in different locations across APIs), and coupling (payload carries transport metadata).

---

## Decision Framework

For any field in a request, ask these questions in order:

```
1. Is this value derivable from the authenticated session?
   → YES: Server-populated from context. MUST NOT appear in request.

2. Is this value the same across all operations for this caller?
   → YES: HTTP Header. Extracted once by middleware into context.

3. Does this value identify the resource being acted upon?
   → YES (read/idempotent): URL path or query parameter.
   → YES (mutating + side effects): Body is acceptable.

4. Is this value unique to this specific operation?
   → YES: Request body.
```

If a field matches multiple rules, the **first matching rule wins** (higher rule = stronger constraint).

---

## Categories

### Category A: Identity-Derived (from auth context)

**Rule**: The server populates these from the verified JWT Subject or session state. They MUST NOT be accepted from the client request in any location.

**Rationale**: If the server accepts an identity claim from the request body, any future code path that forgets to overwrite it with the verified identity creates an impersonation vulnerability.

**Examples**:
- `sender_actor_did` — always `coreauth.GetSubject(ctx).ID`
- `sender_station_peer_id` — always `localStationID`
- `actor_did` when it means "the caller themselves" (e.g., "my key packages")

**Proto treatment**: If the field exists in a domain model (e.g., `ConversationCommand.sender_actor_did`), the API request message should either:
- Exclude it (assemble the full domain object in the handler), or
- Include it with a proto comment `// server-populated; client-supplied value is ignored and overwritten`

---

### Category B: Caller Context (HTTP Header)

**Rule**: Values that identify the calling context (not the operation target) and repeat unchanged across multiple API calls belong in headers. A middleware extracts them into `context.Context` once.

**Rationale**: Centralizes extraction and validation; prevents per-handler duplication; aligns with HTTP semantics where headers carry metadata about the request, not about the resource.

**Standard headers**:

| Header | Semantics | Middleware |
|--------|-----------|------------|
| `Authorization: Bearer <jwt>` | Caller identity | JWT middleware (existing) |
| `X-Device-ID: <uuid>` | Calling device | Device middleware (new) |
| `Idempotency-Key: <uuid>` | Deduplication token | Idempotency middleware (new) |

**When NOT to use a header**: If the value identifies the **target** rather than the **caller** (e.g., `target_device_id` for a revoke operation), it belongs in the body — it's operation payload, not caller context.

---

### Category C: Resource Identifier (URL)

**Rule**: The primary resource being addressed by the request should appear in the URL. For read operations (GET), all identifying parameters go in path or query. For mutating operations, the primary resource identifier may appear in path or body.

**Path params** (when framework supports): `/conversation/:id`, `/device/:id`
**Query params** (current framework): `?conversation_id=xxx&after_seq=0&limit=50`

**When to use query params for POST**: Acceptable when the framework doesn't support path params. The field is still a resource identifier, just expressed differently due to tooling constraints.

---

### Category D: Operation Payload (Body)

**Rule**: Data that is unique to this specific operation instance and defines what the operation does (not who is doing it or what resource it targets) goes in the request body.

**Examples**:
- `encrypted_payload` — the message content
- `opaque_bytes` — MLS cryptographic material
- `members[]` — list of actors to add to a group
- `name` — group name for creation
- `home_station_peer_id` — routing hint for federation

---

## Conflict Resolution

When a field could arguably fit multiple categories:

1. **Security wins over convenience**: If placing a field in the body creates a spoofing vector (even theoretical), move it to a higher category.
2. **Consistency wins over optimization**: If 8 out of 10 APIs put `device_id` in a header, the remaining 2 should also use the header — even if the body "would work fine."
3. **Domain model ≠ Wire model**: A domain object (e.g., `StationEnvelope`) may have fields that are server-populated at runtime. The API request proto should not blindly expose the full domain model — it should expose only the fields the client legitimately provides.

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| `sender_actor_did` in body, overwritten by server | Creates false API contract; future bugs if overwrite is missed | Remove from request; inject in handler |
| `device_id` in body for some APIs, query param for others | Inconsistency forces client to learn per-endpoint rules | Standardize as `X-Device-ID` header |
| `idempotency_key` inside the payload proto | Mixes transport concern with domain data; prevents generic middleware | Use `Idempotency-Key` header |
| Full domain model as API request type | Exposes server-internal fields; client doesn't know which fields matter | Define separate wire request types or mark server-only fields |
| GET request with resource ID only in body | Violates HTTP semantics; not cacheable; not linkable | Use query param or path param |

---

## Applying to New APIs

When designing a new handler:

1. List all fields the operation needs.
2. For each field, walk the decision framework (A → B → C → D).
3. Verify no Category A field appears in the request.
4. Verify all Category B fields use the standard headers.
5. Proto request message should contain only Category C (if POST) and Category D fields.

When reviewing existing APIs:

1. Grep for identity-derived fields in request protos → flag as P0 security debt.
2. Grep for `device_id` / `idempotency_key` in body → flag as P1 consistency debt.
3. Verify GET handlers don't require body parsing → flag violations.

# OAuth Login Broker - Data Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-30 | **Updated**: 2026-09-30
> **Owner**: Identity and Access

---

## 1. Encrypted Envelope

```json
{
  "version": 1,
  "key_id": "v1",
  "algorithm": "AES-256-GCM",
  "nonce": "<base64url 12 bytes>",
  "ciphertext": "<base64url ciphertext plus tag>",
  "updated_at": "2026-09-30T00:00:00Z"
}
```

Associated data is the canonical string:

```text
oauth-login-broker
\0<version>
\0<key-id>
\0<algorithm>
\0<updated-at>
\0<record-kind>
\0<repository-path>
```

Changing version, key ID, algorithm, update timestamp, nonce, ciphertext,
record kind, or repository path makes decryption fail.

The key ring is loaded from:

```text
OAUTH_CREDENTIAL_ACTIVE_KEY_ID=v1
OAUTH_CREDENTIAL_KEY_V1=<base64 encoded 32 bytes>
OAUTH_CREDENTIAL_KEY_V0=<optional previous key>
```

Environment suffixes are normalized uppercase identifiers. The active key must
exist and decode to exactly 32 bytes.

## 2. Authorization Transaction

Repository path:

```text
oauth-data/transactions/<HMAC-SHA256(state)>.json
```

Encrypted payload:

```json
{
  "schema_version": 1,
  "state_fingerprint": "<hex hmac>",
  "site_id": "default",
  "provider": "github",
  "return_to": "peers-touch://oauth/callback",
  "verifier": "<pkce verifier>",
  "created_at": "2026-09-30T00:00:00Z",
  "expires_at": "2026-09-30T00:10:00Z",
  "consumed_at": null,
  "completion_id": ""
}
```

Raw state is absent. `FindAuthorization(rawState)` recalculates the fingerprint
and reconstructs the transient domain object with the caller-supplied state.

## 3. OAuth Identity

Identity ID:

```text
HMAC-SHA256(site_id + NUL + provider + NUL + provider_user_id)
```

Repository path:

```text
oauth-data/identities/<identity-id>.json
```

Encrypted payload:

```json
{
  "schema_version": 1,
  "identity_id": "<hex hmac>",
  "site_id": "default",
  "provider": "github",
  "provider_user_id": "123",
  "union_id": "",
  "username": "alice",
  "display_name": "Alice",
  "avatar_url": "https://...",
  "email": "alice@example.com",
  "email_verified": true,
  "first_login_at": "2026-09-30T00:00:00Z",
  "last_login_at": "2026-09-30T00:00:00Z",
  "login_count": 1
}
```

Identity IDs do not imply cross-provider account linking.

## 4. OAuth Credential

Repository path:

```text
oauth-data/credentials/<identity-id>.json
```

Encrypted payload:

```json
{
  "schema_version": 1,
  "identity_id": "<hex hmac>",
  "site_id": "default",
  "provider": "github",
  "access_token": "<secret>",
  "refresh_token": "<secret or empty>",
  "token_type": "Bearer",
  "scope": "read:user user:email",
  "obtained_at": "2026-09-30T00:00:00Z",
  "access_expires_at": null,
  "refresh_expires_at": null,
  "generation": 1,
  "last_refresh_operation_id": ""
}
```

Only server-side store and refresh use cases may materialize token fields.
Administration projections expose booleans and expiry timestamps only.

## 5. Refresh Operation

Repository path:

```text
oauth-data/refresh-operations/<identity-id>/<HMAC-SHA256(identity-id + NUL + operation-id)>.json
```

Encrypted payload:

```json
{
  "schema_version": 1,
  "identity_id": "<hex hmac>",
  "operation_fingerprint": "<hex hmac>",
  "credential_generation": 2,
  "completed_at": "2026-09-30T00:00:00Z"
}
```

The append-only marker keeps every completed operation idempotent even after a
later refresh replaces the credential. It is committed atomically with the
credential and audit event and never exposes the caller-supplied operation ID.

## 6. Audit Event

Repository path:

```text
oauth-data/audits/YYYY/MM/<event-id>.json
```

Encrypted payload:

```json
{
  "schema_version": 1,
  "event_id": "<stable idempotency id>",
  "event_type": "authorization_started | login_succeeded | login_failed | credential_refreshed",
  "occurred_at": "2026-09-30T00:00:00Z",
  "site_id": "default",
  "provider": "github",
  "transaction_id": "<state fingerprint>",
  "identity_id": "<optional identity id>",
  "code_fingerprint": "<optional keyed hmac>",
  "result": "success | failure",
  "error_code": "<optional typed code>"
}
```

No free-form provider body, stack trace, URL query, token, code, state, verifier,
or key material is accepted by the audit schema.

## 7. Token Set

```go
type TokenSet struct {
    AccessToken      string
    RefreshToken     string
    TokenType        string
    Scope            string
    ObtainedAt       time.Time
    AccessExpiresAt  *time.Time
    RefreshExpiresAt *time.Time
}
```

Provider adapters normalize integer `expires_in` values against the injected
clock. Refresh replacement increments credential generation. Repeating the
same non-empty refresh operation ID returns the committed credential without a
second mutation or audit event. A replacement also carries the generation read
before the provider call and fails with `credential_generation_conflict` when a
newer credential has already committed.

## 8. Administration Projection

```json
{
  "generated_at": "2026-09-30T00:00:00Z",
  "identities": [{
    "identity_id": "<fingerprint>",
    "site_id": "default",
    "provider": "github",
    "username": "alice",
    "display_name": "Alice",
    "email": "alice@example.com",
    "email_verified": true,
    "first_login_at": "2026-09-30T00:00:00Z",
    "last_login_at": "2026-09-30T00:00:00Z",
    "login_count": 1,
    "has_access_token": true,
    "has_refresh_token": true,
    "access_expires_at": null,
    "refresh_expires_at": null
  }],
  "events": [{
    "event_id": "<id>",
    "event_type": "login_succeeded",
    "occurred_at": "2026-09-30T00:00:00Z",
    "site_id": "default",
    "provider": "github",
    "identity_id": "<fingerprint>",
    "result": "success",
    "error_code": ""
  }]
}
```

## 9. Typed Errors

| Code | Meaning | Retry |
|---|---|---|
| `oauth_storage_unavailable` | durable store unavailable | new request after recovery |
| `oauth_storage_conflict` | CAS retries exhausted | new request |
| `oauth_record_corrupt` | schema or ciphertext invalid | operator repair |
| `oauth_key_unavailable` | envelope key ID not configured | restore key/config |
| `invalid_state` | transaction absent | restart login |
| `state_expired` | transaction expired | restart login |
| `state_consumed` | transaction already completed | none |
| `provider_mismatch` | callback provider differs | restart login |
| `credential_not_refreshable` | no refresh token | new login |
| `credential_generation_conflict` | credential changed after refresh began | bounded reread and retry |
| `provider_exchange_failed` | provider rejected exchange | restart login |
| `provider_refresh_failed` | provider rejected refresh | retry or new login |

## 9. Rotation Result

```json
{
  "scanned": 42,
  "rotated": 8,
  "unchanged": 34,
  "failed": 0
}
```

The maintenance command scans every record prefix. It exits non-zero when
`failed` is non-zero and never prints record plaintext or key material.

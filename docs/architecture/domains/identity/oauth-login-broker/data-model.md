# OAuth Login Broker - Data Model

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-30 | **Updated**: 2026-10-01
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
Terminal provider denial writes the failure audit and `consumed_at` in the same
store transaction, so the authorization state cannot later be reused.

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
  "schema_version": 2,
  "identity_id": "<hex hmac>",
  "operation_fingerprint": "<hex hmac>",
  "credential_generation": 1,
  "state": "claimed | released | committed | uncertain",
  "claim_id": "<random owner token>",
  "claimed_at": "2026-10-01T00:00:00Z",
  "completed_at": null,
  "error_code": ""
}
```

The append-only marker is created before the provider call. The random claim ID
allows only the process that created the durable claim to commit or mark its
outcome. `committed` records keep every completed operation idempotent even
after a later refresh replaces the credential. `uncertain` records, and
`claimed` records observed by a different process, prevent another provider
call when the rotating-token outcome cannot be proven. A pre-provider failure
changes `claimed` to `released`; the same operation can then acquire a new
claim owner without blocking another operation for that unchanged credential
generation. Caller-supplied operation and claim IDs never appear in repository
paths.

### 5.1 Station Bridge Assertion Consumption

Station stores a SHA-256 digest of each signed `assertion_id` in
`touch_oauth_bridge_assertion` before actor binding or session issuance. The
record includes the signed purpose, consumption time, and expiry derived from
the assertion timestamp. A duplicate primary-key insert is a replay and fails
closed. The raw assertion ID is not stored.

## 6. Audit Event

Repository path:

```text
oauth-data/audits/YYYY/MM/<YYYYMMDDTHHMMSS.NNNNNNNNNZ>-<event-id>.json
```

The UTC timestamp is fixed-width, so descending path order is identical to
descending event occurrence order before encrypted blobs are fetched. The
HMAC-derived event ID remains an opaque uniqueness suffix; failure event IDs
also bind the occurrence timestamp so separate failed requests remain separate
events. HMAC-only legacy audit filenames are invalid in the active schema.

Encrypted payload:

```json
{
  "schema_version": 1,
  "event_id": "<stable idempotency id>",
  "event_type": "authorization_started | login_succeeded | login_failed | credential_refreshed | credential_refresh_uncertain",
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
| `credential_refresh_uncertain` | provider may have rotated tokens without a durable replacement | new login |
| `provider_exchange_failed` | provider rejected exchange | restart login |
| `provider_refresh_failed` | provider rejected refresh | retry or new login |

## 10. Rotation Result

```json
{
  "scanned": 42,
  "rotated": 8,
  "unchanged": 34,
  "failed": 0,
  "complete": false
}
```

`complete` is true only when the pass exhausted every record path. The
maintenance command continues until that explicit flag is true, exits non-zero
when `failed` is non-zero, and never prints record plaintext or key material.

## 11. Broker Identity Assertion

Canonical signed fields:

```text
bridge_version=v1
site_id=<site>
purpose=account_login|connector_link
assertion_id=<opaque HMAC-derived transaction identifier>
receiver_id=<Desktop loopback session identifier>
receiver_challenge=<base64url SHA-256 of Desktop receiver verifier>
provider=<provider>
provider_user_id=<provider subject>
union_id=<optional provider union>
username=<optional username>
display_name=<optional display name>
avatar_url=<optional HTTPS URL>
email=<optional verified email>
email_verified=true|false
ts=<RFC3339 UTC timestamp>
```

Non-empty fields are encoded with standard URL query escaping and sorted by
key. The lowercase hexadecimal HMAC-SHA256 is carried separately as `sig`.
Station reconstructs these bytes from the protobuf request and rejects any
missing required field, unsupported version, stale timestamp, or signature
mismatch.

The assertion does not contain provider access/refresh tokens or a Station
session. Desktop adds the following unsigned but Station-validated local
binding fields when it forwards the assertion:

```text
station_peer_id
access_attempt_id
gate_id
device_id
lifecycle_generation
credential_delivery_public_key
receiver_verifier
```

The verifier must hash to the signed `receiver_challenge`. Station binds the
resolved actor to the referenced Access Attempt and persists a canonical
`OAuthSessionCandidate`. `BrokerOAuthBridgeResponse` carries the existing OAuth
attempt result, candidate, Access Decision, and encrypted credential envelope;
it never carries an active plaintext token.

The credential envelope is bound to:

```text
candidate_id
session_id
station_peer_id
device_id
access_attempt_id
lifecycle_generation
decision_revision
```

Desktop decrypts and durably persists the session, then submits the existing
OAuth acknowledgement request using `receiver_verifier` as the attempt secret.
Only acknowledgement activates the Station session and clears the recoverable
credential envelope. Replayed acknowledgement is idempotent. Desktop resolves
a lost acknowledgement response by retrying and reading the canonical attempt
state.

Before local account/session mutation, Desktop writes
`data/oauth2/acknowledgement-recovery.json` as an AES-256-GCM envelope protected
by a per-storage-root key from the platform key provider. The file is restricted
to owner access on Unix. Its encrypted payload contains the loopback session ID,
account and actor IDs, OAuth/Access attempt binding, receiver secret, the prior
local account/session/connection snapshot, a
`prepared | local_persisted | cancellation_requested` phase, and the next retry
time. The record is removed only after confirmed activation or successful
rollback of a terminal outcome. Polling and process-start session restoration
both consume this record; an unobservable acknowledgement or cancellation
never deletes the only recoverable local credential.

Station scans expired live attempts at OAuth subserver startup and on a bounded
periodic interval. The existing transactional expiration path revokes the
inactive candidate session, deletes its credential envelope, and clears live
binding keys without requiring another OAuth request.

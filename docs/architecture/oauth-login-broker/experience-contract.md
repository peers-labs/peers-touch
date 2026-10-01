# OAuth Login Broker - Experience Contract

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-30 | **Updated**: 2026-10-01
> **Owner**: Identity and Access

---

## 1. Journey Index

| ID | Journey | Capabilities |
|---|---|---|
| OLB-J01 | Start and complete OAuth across instances | OLB-C01-C04, OLB-C06, OLB-C08 |
| OLB-J02 | Refresh an expired provider credential | OLB-C03, OLB-C05, OLB-C06 |
| OLB-J03 | Inspect login operations | OLB-C02, OLB-C04, OLB-C07 |
| OLB-J04 | Rotate the record encryption key | OLB-C03, OLB-C06 |
| OLB-J05 | Sign in to Desktop through the broker | OLB-C09, OLB-C12, OLB-C13 |

## 2. OLB-J01: Durable Login

1. The caller opens `/api/oauth/{provider}/start` with `site_id` and optional
   `return_to`.
2. The broker validates the site/provider and accepts `return_to` only when its
   normalized scheme, authority, and path exactly match the site's allowlist.
3. The broker generates state and PKCE verifier, stores an encrypted transaction
   addressed by a keyed state fingerprint, and records `authorization_started`.
4. The browser is redirected to the provider with state and, where supported,
   an S256 PKCE challenge.
5. Any Vercel function instance receives the callback and resolves the durable
   transaction by the presented state.
6. The broker rejects missing, expired, consumed, or provider-mismatched state
   before completing the login.
7. The provider exchanges the one-time code using the stored verifier and
   returns identity plus token-set metadata.
8. The broker atomically commits transaction consumption, identity upsert,
   encrypted credential replacement, and `login_succeeded`.
9. Only after the commit succeeds does the broker redirect to `return_to` or
   the configured success URL using the existing signed identity contract.

The raw authorization code is held in memory only for the exchange. Audit may
include a keyed code fingerprint, never the code itself.

## 3. OLB-J02: Credential Refresh

1. A server-side caller requests refresh for one stored identity and supplies
   an opaque idempotency key.
2. The broker durably claims that operation against the current credential
   generation before contacting the provider.
3. The broker decrypts the credential and rejects missing, corrupt, or
   non-refreshable records.
4. The provider refresh endpoint returns a new token set.
5. If the provider omits a new refresh token, the broker retains the previous
   refresh token.
6. Credential replacement, operation completion, and
   `credential_refreshed` audit are committed
   atomically.
7. The use case returns sanitized token metadata to its server-side caller; no
   browser route exposes token values.

An operation left claimed after a process crash or ambiguous provider response
is not retried against the provider. It becomes an explicit
`credential_refresh_uncertain` result and requires fresh authorization.

## 4. OLB-J03: Operator Readback

1. The operator opens `/api/admin` or `/api/admin/data`.
2. Missing or invalid Basic credentials produce `401` and
   `WWW-Authenticate`.
3. Valid credentials show identities, provider/site, last login, login count,
   refreshability, credential expiry, and recent typed events.
4. Every response sends `Cache-Control: no-store`, CSP, frame denial, MIME
   sniffing protection, and `X-Robots-Tag: noindex, nofollow`.
5. HTML and JSON omit token values, raw state, authorization codes, repository
   credentials, encryption material, and full encrypted envelopes.

## 5. OLB-J04: Key Rotation

1. The operator adds a new `OAUTH_CREDENTIAL_KEY_<ID>` environment variable and
   sets `OAUTH_CREDENTIAL_ACTIVE_KEY_ID`.
2. New records immediately use the active key identifier.
3. Reads accept configured previous keys.
4. The operator runs the server-side rotation command, which scans every record
   class and rewrites old envelopes through bounded optimistic commits.
5. The command reports scanned, rotated, and failed counts and can be rerun
   idempotently.
6. Removing an old key before all records are rewritten makes those records
   unreadable and fails closed.

## 6. OLB-J05: Native Desktop Account Login

1. A logged-out Desktop starts an account-login attempt without requiring an
   existing actor or Station token.
2. Desktop opens the broker in the system browser and supplies its run-scoped
   `http://127.0.0.1:<ephemeral>/callback` receiver.
3. The broker accepts that destination only when the site explicitly allows
   the canonical loopback callback template.
4. Provider success is durably committed by the broker before redirect.
5. The broker signs the versioned canonical identity assertion, including
   email-verification state, and redirects to the exact loopback receiver.
6. Desktop forwards the unmodified assertion to Station. Station rejects a
   missing secret, unsupported version, stale timestamp, malformed identity,
   or invalid signature before resolving an actor.
7. Station is the only component that issues the session. Desktop persists the
   local account and session only after that response succeeds.
8. Provider denial returns to the same transaction-owned receiver as a typed
   failure, consumes and audits the transaction, and never becomes a local
   account or session.
9. Provider usernames that do not satisfy the Station handle grammar are
   normalized to a stable provider-scoped handle; display names remain
   presentation data.

Authenticated connector linking uses a separate intent and requires an
existing actor. It cannot enter the account-login session issuance path.

## 7. Failure And Recovery

| Failure | Observable behavior | Durable result |
|---|---|---|
| Invalid/expired/replayed state | typed error redirect or JSON error | no credential mutation |
| Provider exchange failure | typed error redirect | sanitized failure audit when storage is available |
| GitHub conflict | bounded retry | one winning atomic commit |
| GitHub unavailable/rate-limited | login fails; no success redirect | no partial success claim |
| Cipher/authentication failure | internal typed failure | ciphertext retained, no plaintext returned |
| Admin auth failure | `401` | no repository read |
| Unapproved `return_to` | configured success URL is used | no attacker-selected redirect |
| Missing production bridge secret | startup fails | no unsigned identity redirect |
| Missing Station bridge secret | bridge returns unavailable | no actor or session is created |
| Invalid/stale broker assertion | Station returns unauthorized | no local account or session is activated |
| Lost Station acknowledgement response | bounded replay plus attempt-state readback | one active candidate session; no cancellation after observed activation |
| Later Access Gate is abandoned or expires | Desktop reports expiry | pending Desktop entry removed; inactive Station session revoked; envelope deleted |
| Provider denies consent | transaction-owned error redirect | typed failure audit; no provider exchange |
| Provider has no usable email | stable provider-scoped synthetic address | no cross-provider email linking |
| Refresh interrupted after durable claim | `credential_refresh_uncertain` | no second provider refresh call |
| Missing storage config on Vercel | startup fails closed | no memory fallback |
| Refresh token absent | non-refreshable typed error | credential unchanged |

## 8. Forbidden Experiences

- Callback success after only an in-memory or partial write.
- Raw secrets in redirects, logs, errors, audit records, dashboard HTML, or JSON.
- Silently accepting replay because two callbacks raced.
- Falling back to process memory on Vercel.
- Admin actions that mutate identity, credential, audit, or repository state.
- Starting Desktop account login through a command that requires a current
  authenticated actor.
- Persisting an active local OAuth account or connector before Station verifies
  the signed broker assertion.
- Retrying a rotating refresh token after a durable claim has an uncertain
  outcome.

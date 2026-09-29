# OAuth Login Broker - Experience Contract

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-30 | **Updated**: 2026-09-30
> **Owner**: Identity and Access

---

## 1. Journey Index

| ID | Journey | Capabilities |
|---|---|---|
| OLB-J01 | Start and complete OAuth across instances | OLB-C01-C04, OLB-C06, OLB-C08 |
| OLB-J02 | Refresh an expired provider credential | OLB-C03, OLB-C05, OLB-C06 |
| OLB-J03 | Inspect login operations | OLB-C02, OLB-C04, OLB-C07 |
| OLB-J04 | Rotate the record encryption key | OLB-C03, OLB-C06 |

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

1. A server-side caller requests refresh for one stored identity.
2. The broker decrypts the credential and rejects missing, corrupt, or
   non-refreshable records.
3. The provider refresh endpoint returns a new token set.
4. If the provider omits a new refresh token, the broker retains the previous
   refresh token.
5. Credential replacement and `credential_refreshed` audit are committed
   atomically.
6. The use case returns sanitized token metadata to its server-side caller; no
   browser route exposes token values.

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

## 6. Failure And Recovery

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
| Missing storage config on Vercel | startup fails closed | no memory fallback |
| Refresh token absent | non-refreshable typed error | credential unchanged |

## 7. Forbidden Experiences

- Callback success after only an in-memory or partial write.
- Raw secrets in redirects, logs, errors, audit records, dashboard HTML, or JSON.
- Silently accepting replay because two callbacks raced.
- Falling back to process memory on Vercel.
- Admin actions that mutate identity, credential, audit, or repository state.

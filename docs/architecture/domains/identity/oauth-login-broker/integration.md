# OAuth Login Broker - Integration

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-30 | **Updated**: 2026-10-01
> **Owner**: Identity and Access

---

## 1. Delivered Cutover Mapping

| Concern | Pre-cutover | Delivered |
|---|---|---|
| Authorization session | process-local map | encrypted durable transaction |
| State lookup | raw map key | HMAC-derived repository path |
| PKCE | verifier generated but unused | S256 challenge and exchange verifier |
| Token response | access token used transiently | normalized encrypted token set |
| Login identity | redirect only | durable identity plus existing redirect |
| Login history | absent | append-only sanitized audit |
| Callback persistence | separate memory mutation | one atomic store completion |
| Admin operations | absent | Basic-authenticated read-only HTML/JSON |
| Production storage selection | implicit memory | explicit GitHub driver on Vercel |

## 2. Existing Route Compatibility

These routes and query semantics remain:

```text
GET /api/oauth/github/start
GET /api/oauth/github/callback
GET /api/oauth/google/start
GET /api/oauth/google/callback
GET /api/oauth/weixin/start
GET /api/oauth/weixin/callback
GET /api/healthz
```

The callback continues to redirect with the existing identity fields and bridge
signature. Durable completion is a prerequisite for that redirect.

Added routes:

```text
GET /api/admin
GET /api/admin/data
```

## 3. Deployment Configuration

Required for Vercel:

```text
OAUTH_STORAGE_DRIVER=github
OAUTH_GITHUB_STORAGE_OWNER=<owner>
OAUTH_GITHUB_STORAGE_REPO=<private-repo>
OAUTH_GITHUB_STORAGE_BRANCH=<data-branch>
OAUTH_GITHUB_APP_ID=<app-id>
OAUTH_GITHUB_APP_INSTALLATION_ID=<installation-id>
OAUTH_GITHUB_APP_PRIVATE_KEY_B64=<base64 PEM>
OAUTH_CREDENTIAL_ACTIVE_KEY_ID=v1
OAUTH_CREDENTIAL_KEY_V1=<base64 32 bytes>
OAUTH_STORAGE_INDEX_HMAC_KEY=<base64 32+ bytes>
OAUTH_AUDIT_HMAC_KEY=<base64 32+ bytes>
OAUTH_ADMIN_USERNAME=<operator>
OAUTH_ADMIN_PASSWORD_HASH=pbkdf2-sha256$600000$<base64-salt>$<base64-hash>
PEERS_OAUTH_BRIDGE_SECRET=<site result-signing secret>
OAUTH_ALLOWED_RETURN_TO=peers-touch://oauth/callback,https://app.example/oauth/callback
```

`OAUTH_ALLOWED_RETURN_TO` overrides `allowed_return_to` values from file-backed
site configuration. `OAUTH_GITHUB_API_BASE_URL` defaults to GitHub's public API
and must use HTTPS on Vercel; local deterministic fixtures may use HTTP.

For native Desktop loopback, configure the explicit template:

```text
OAUTH_ALLOWED_RETURN_TO=http://127.0.0.1/callback
```

The template authorizes only an ephemeral non-zero port on literal
`127.0.0.1`, fixed `/callback`, no userinfo, and no fragment. It does not
authorize `localhost`, IPv6, alternate paths, or arbitrary HTTP destinations.

The GitHub App installation requires repository `Contents: Read and write`.
The data repository and branch must already exist.

Local development defaults to memory when `OAUTH_STORAGE_DRIVER` is unset.
`OAUTH_STORAGE_DRIVER=memory` is rejected when `VERCEL` is set.

The Station deployment environment must define the same
`PEERS_OAUTH_BRIDGE_SECRET`; `tooling/docker/compose.yml` explicitly injects it
into the Station container. Missing values remain fail-closed at bridge
verification.

## 4. GitHub API Flow

### Authentication

1. Sign a short-lived RS256 GitHub App JWT.
2. Exchange it at
   `/app/installations/{installation_id}/access_tokens`.
3. Cache the installation token only in process memory until shortly before
   expiry.

### Read

- Resolve `git/ref/heads/{branch}`.
- Read record contents at that immutable commit SHA.
- For lists, use the recursive tree when it fits the bounded response budget;
  on overflow or GitHub `truncated=true`, walk non-recursive trees with explicit
  depth and entry limits before fetching matching encrypted blobs.
- Audit filenames begin with a fixed-width UTC occurrence key. Admin readback
  applies its requested event limit to descending paths before fetching
  encrypted audit blobs, including when the newest events share one month.
- HMAC-only legacy audit filenames fail closed. A repository containing that
  pre-release layout must use a separately authorized migration or a fresh data
  branch before rollout; key rotation does not rename records.

### Write

- Create changed blobs.
- Create one tree using the current base tree.
- Create one commit with the current head as parent.
- PATCH the branch ref with `force=false`.
- Retry a conflict against a fresh head.

## 5. Provider Integration

| Provider | PKCE | Exchange | Refresh |
|---|---|---|---|
| GitHub | S256 | form POST plus user API | GitHub token endpoint |
| Google | S256 | OAuth token endpoint plus OIDC userinfo | OAuth token endpoint |
| Weixin | provider flow | access-token endpoint plus userinfo | refresh-token endpoint |

Provider endpoint URLs remain package defaults but are injectable in tests.
Provider errors map to stable codes without returning response bodies.
GitHub calls `/user/emails` only when `/user` omits email and accepts only a
verified address, preferring the primary entry.

## 6. Key Rotation

1. Add the new key variable while retaining old key variables.
2. Change `OAUTH_CREDENTIAL_ACTIVE_KEY_ID`.
3. Redeploy.
4. Run `go run ./cmd/rotate-records` with the same environment.
5. Each pass stops after staging its configured number of old-key envelopes;
   the command reports them as rotated only after the branch update succeeds.
6. The command reruns passes until the store returns `complete=true`; it does
   not infer completion from a retry-affected rotated count.
7. Remove the old environment key in a later deployment.

Git history retains old ciphertext. Rotation does not erase repository history.

## 7. Future Database Cutover

A database adapter must implement the same `OAuthStore` methods and preserve:

- one-time transaction consumption;
- atomic completion and credential replacement;
- event idempotency;
- encrypted credential custody or stronger secret storage;
- sanitized administration projections;
- typed errors and no-secret logging.

The GitHub adapter is then removed from bootstrap selection in one explicit
cutover. Use cases and HTTP routes do not change.

## 8. Failure Semantics

- Missing GitHub App or cryptographic configuration blocks Vercel startup.
- Missing production bridge signing or return-destination policy blocks Vercel
  startup.
- GitHub 401/403/404/409/422/429/5xx responses become typed storage errors.
- Oversized successful responses fail explicitly; tree discovery may fall back
  to bounded non-recursive traversal instead of decoding truncated JSON.
- Retry only transport failures, rate-limit/server responses, and ref conflicts
  within bounded attempts.
- A callback never redirects success after an incomplete durable commit.
- Admin rendering never includes upstream bodies or decryption details.
- Provider denial with valid state is audited and redirected through the
  transaction-owned return destination; missing state remains a JSON error.
- A refresh operation is durably claimed before provider rotation. An
  unresolved claim fails as `credential_refresh_uncertain` without a second
  provider call.

## 9. Desktop And Station Handoff

Native Desktop account login uses one loopback attempt:

```text
Desktop logged out
  -> signed Station identity + Access Attempt
  -> broker /start
  -> provider
  -> broker /callback + durable commit
  -> signed loopback redirect
  -> Desktop Rust
  -> Station /actor/oauth-bridge
  -> Desktop local account/session commit
  -> Station /oauth/mobile/acknowledge
  -> Station session activation + prior-session replacement
```

- `oauth2_start_loopback` accepts an explicit `account_login` or
  `connector_link` intent.
- `account_login` is callable without an existing actor and requires a
  current Access Attempt whose login gate advertises `auth.oauth`.
- `connector_link` requires an existing actor and uses authenticated Station
  assertion verification without issuing a login session.
- The broker and Station share the `bridge_version=v1` canonical signature
  defined in `data-model.md`.
- `/actor/oauth-bridge` is public but signature-required and registered under
  the Actor router.
- Station rejects a route whose account-login or connector-link purpose does
  not match the signed assertion and durably consumes `assertion_id` before any
  actor or session mutation.
- The account-login bridge delegates to the existing Station OAuth candidate
  repository and Access Gate coordinator. It does not call direct session
  issuance or perform a post-hoc allowlist check.
- Desktop binds the bridge to `station_peer_id`, `access_attempt_id`,
  `gate_id`, `device_id`, and `lifecycle_generation`, and supplies an X25519
  credential-delivery key. The signed receiver challenge is the hash of the
  attempt secret used by status, cancellation, and acknowledgement. Station
  verifies the device and lifecycle generation against the referenced Access
  Attempt before creating the OAuth candidate.
- A granted candidate returns the canonical encrypted OAuth credential
  envelope while its Station session remains revoked with
  `credential_delivery_pending`.
- Desktop first persists an encrypted, phase-marked acknowledgement recovery
  record, including the receiver binding and prior local snapshot, then commits
  its local session/account/connector projections before acknowledgement. A
  local write failure rolls back those projections and cancels the pending
  OAuth candidate.
- A later actionable Gate remains attached to the same Access Attempt. Desktop
  submits that action, resumes OAuth status, persists the granted credential,
  and then acknowledges.
- Acknowledgement atomically activates the candidate, deletes its recoverable
  envelope, and revokes replaced sessions. Only then may Desktop mark the
  Station binding complete.
- A lost acknowledgement response preserves the local credential and recovery
  record. Loopback polling and OAuth session restoration both recover through
  idempotent acknowledgement replay and canonical status readback.
- The renderer consumes the native receiver expiry and sends explicit
  cancellation before reporting timeout; cancellation and final activation
  serialize so an activation winner is reported as completed.
- Station runs transactional OAuth expiry cleanup at startup and periodically;
  abandoned candidate sessions and envelopes do not depend on a later request
  for cleanup.
- Missing `PEERS_OAUTH_BRIDGE_SECRET` on Station fails closed.
- Desktop never reconstructs or verifies the HMAC secret.

## 10. Rollback

Rollback uses application deployment/version control. Existing ciphertext
records remain compatible while all referenced key IDs remain configured.
There is no plaintext migration and no destructive repository reset in this
Plan.

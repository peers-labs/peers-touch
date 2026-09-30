# OAuth Login Broker - Integration

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-30 | **Updated**: 2026-09-30
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

The GitHub App installation requires repository `Contents: Read and write`.
The data repository and branch must already exist.

Local development defaults to memory when `OAUTH_STORAGE_DRIVER` is unset.
`OAUTH_STORAGE_DRIVER=memory` is rejected when `VERCEL` is set.

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
- Admin audit readback applies its requested event limit to descending audit
  paths before fetching encrypted audit blobs.

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

## 6. Key Rotation

1. Add the new key variable while retaining old key variables.
2. Change `OAUTH_CREDENTIAL_ACTIVE_KEY_ID`.
3. Redeploy.
4. Run `go run ./cmd/rotate-records` with the same environment.
5. Each pass stops after staging its configured number of old-key envelopes;
   the command reports them as rotated only after the branch update succeeds.
6. Rerun until it reports zero rotated and zero failed records.
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

## 9. Rollback

Rollback uses application deployment/version control. Existing ciphertext
records remain compatible while all referenced key IDs remain configured.
There is no plaintext migration and no destructive repository reset in this
Plan.

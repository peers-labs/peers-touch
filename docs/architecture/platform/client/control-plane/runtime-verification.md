# X Config Runtime Verification

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-10-17 | **Updated**: 2026-10-20
> **Owner**: Client Platform
> **Module**: `apps/x-config/`

---

## 1. Source And Environment

Verification starts from:

- one clean, committed application source revision;
- one clean, committed env revision at
  `peers-touch-infra/x-config-preview/`;
- Home runtime root `$PEERS_RUNTIME_ROOT/x-config-preview`;
- Home origin `$X_CONFIG_HOME_ORIGIN`;
- GitHub repository `$X_CONFIG_DATA_REPOSITORY`;
- OAuth project `peers-touch-oauth`.

Runtime secrets are loaded from the git-crypt env file and never copied into
logs, evidence, argv, or chat.

## 2. Home Preview Deployment

Build the Linux API and console from one clean application commit. Stage them
with one committed env revision, then validate:

```sh
docker compose -f home.compose.yml config
docker compose -f home.compose.yml up -d
docker inspect peers-x-config-api
curl -fsS http://127.0.0.1:18082/healthz
curl -fsS "$X_CONFIG_HOME_ORIGIN/healthz"
```

The release metadata must bind exact application and env commits. The API
container is read-only except for its dedicated operator-state mount. Startup
must fail when the SQLite path, schema migration, state permissions, or record
key is invalid. No secret value enters argv, logs, evidence, or chat.

## 3. OAuth Journey

1. `GET /api/admin/auth/session` returns 401 before login.
2. `GET /api/admin/auth/start` redirects to `peers-touch-oauth`.
3. GitHub login returns through the configured X Config Preview callback.
4. The callback sets secure HttpOnly session and CSRF cookies.
5. Session read returns the configured provider subject.
6. Missing/invalid CSRF denies every mutation.
7. Restart the API container and confirm the same unexpired session remains
   valid.
8. Logout durably revokes the session; restart does not restore it.
9. Replayed handoff, assertion, or callback attempt is denied.

The OAuth broker callback must equal the Home callback. Browser and server-side
redemption use owned domains; no raw `*.vercel.app` hostname is an active Home
dependency.

Capture the shared Git repository paths changed during the Journey. Broker-owned
`oauth-data/**` changes are expected. X Config must not create or update
`x-config/admin-auth/**`; its attempt/session/revocation state must be visible
only through sanitized local-store diagnostics.

Attribute timing separately for X Config start, Broker/provider, Broker
redemption, local session finalization, and session readback. X Config local
spans expose duration only, without state, code, token, subject, or record
identifiers. After one warm-up, collect twenty sequential Home samples; the P95
of local attempt persistence, session finalization, and session readback must
each remain below one second. The Broker span is reported separately and is not
reclassified as X Config latency. A single end-to-end duration without segment
attribution is insufficient.

## 4. Publication Journey

1. Load or create the `stable` draft.
2. Validate the catalog.
3. Save against the current repository revision.
4. Acknowledge the exact content digest.
5. POST `/api/admin/publications`.
6. Assert returned sequence is greater than the prior publication.
7. Inspect one Git commit containing:

```text
x-config/publications/stable/current.json
x-config/publications/stable/<sequence>.json
x-config/snapshots/stable/<sequence>.pb
```

8. Assert metadata digests match the exact persisted bytes.
9. Assert unrelated repository paths are unchanged.

## 5. Public Readback

For the returned sequence:

```text
GET /channels/stable/latest.pb
GET /snapshots/stable-<20-digit-sequence>.pb
```

Both bodies must equal the repository envelope. Latest must be public and
revalidated; immutable must be public and immutable. Both must expose
`application/protobuf`, SHA-256 ETag, and `nosniff`.

The shared Rust verifier consumes the actual body and proves signature,
channel, expiry, tamper denial, and rollback denial using
`apps/x-config/public-keys/publisher-keys.json`.

## 6. Operator Store Recovery

1. Stop the API cleanly and retain the state mount.
2. Start the same exact release and confirm schema/readiness.
3. Confirm the unexpired session remains valid.
4. Revoke the session and restart again; it remains revoked.
5. Copying an older database over newer state is forbidden and is not a
   supported recovery procedure.
6. Recreating the database empty requires a new login and leaves Git-backed
   draft/publication state unchanged.

## 7. Cleanup Verification

Only after the journey passes:

1. Remove the inactive Vercel X Config project under separate destructive
   authorization.
2. Remove old X Config aliases.
3. Keep the shared OAuth repository and Broker project.
4. Query Vercel, Home, and GitHub again.
5. Search active source for Vercel X Config entrypoints and the Git-backed
   operator store.

Vercel inventory must contain no X Config project. Home must contain one active
X Config runtime. The shared GitHub repository remains reachable for OAuth and
publication data. Historical frozen plans are not active runtime references.

## 8. Proof Boundary

This Preview closure proves Home service behavior, not OAuth Broker storage
optimization or native Desktop/Mobile UI. Missing real OAuth, Home restart,
GitHub publication, local operator-state, or signed-byte evidence remains
`BLOCKED/UNPROVEN`; a unit-test PASS is not a substitute.

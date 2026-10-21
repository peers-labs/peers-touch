# X Config - Integration

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-10-17 | **Updated**: 2026-10-20
> **Owner**: Client Platform
> **Module**: `apps/x-config/`

---

## 1. Existing Owners

| Surface | Owner | X Config relationship |
|---|---|---|
| Desktop Station registry | Station Access | adds separate suggestions only |
| Mobile Station registry | Station Access | consumes the same suggestions |
| Peer connection material | Node Connectivity | imports generated contract and verifier |
| OAuth provider login | OAuth Broker | reuses audience-bound operator login |
| GitHub App/CAS | `packages/github-repository` | reuses neutral mechanics |
| OAuth durable records | OAuth Broker | shares repository, keeps `oauth-data/` |
| Operator login/session records | X Config Home runtime | owns local SQLite transaction state |
| Release artifacts | Platform release owner | receives typed descriptors only |
| Deployment placement | env repository | declares Home edge, runtime, state volume, and secrets |

## 2. OAuth Integration

X Config redirects to the existing `peers-touch-oauth` broker with:

- site ID `default`;
- audience `client-control-admin`;
- callback
  `https://<x-config-home-edge>/api/admin/auth/callback`;
- one allowlisted GitHub provider subject.

The broker signs an audience-bound assertion and retains provider credentials.
X Config redeems it, verifies the broker public key, and creates its own
short-lived encrypted session. Station login assertions and bridge secrets are
not reused as X Config sessions.

Changing the X Config callback requires updating the env source and redeploying
the OAuth broker before deleting the old alias.

The Broker remains the only owner of provider callback, state, PKCE, token
exchange, provider credentials, and identity normalization. X Config does not
import provider adapters or expose a second provider callback.

## 3. Operator State Integration

The Home service opens one SQLite database under its mounted state directory.
It owns login attempts, attempt/assertion consumption, session readback, CSRF,
expiry, and revocation. The database is not shared with OAuth Broker, Station,
or another X Config instance.

Startup requires:

- `X_CONFIG_CATALOG_STORAGE_DRIVER=github`;
- `X_CONFIG_OPERATOR_STORAGE_DRIVER=sqlite`;
- `X_CONFIG_OPERATOR_SQLITE_PATH=/var/lib/x-config/operator-auth.sqlite`;
- an available schema migration;
- the dedicated record-encryption key;
- permissions that prevent access by other container users.

Production memory fallback and GitHub operator records are forbidden. A
database initialization failure prevents the API from becoming ready.

## 4. Publication Storage Integration

The existing GitHub App installation remains selected-repository scoped to
`<github-owner>/peers-touch-oauth-client-data`. No second App or repository is
created. The retained X Config namespace contains only catalog and publication
truth:

```text
oauth-data/**       OAuth owner
x-config/catalogs/**       X Config owner
x-config/publications/**   X Config owner
x-config/snapshots/**      X Config owner
```

X Config catalog and publication adapters must prepend `x-config/` to every
record path. Tree-wide and live-repository checks enforce that no publication
record appears elsewhere.
GitHub's repository-wide App permission means path isolation is an ownership
contract, not a security boundary against service compromise.

The active runtime must not read or write `x-config/admin-auth/**`. Historical
Git commits may retain old encrypted development records; they are not migrated
into SQLite and do not authorize any session.

## 5. Publication Integration

```text
console validates and acknowledges exact diff
  -> admin API saves draft if needed
  -> admin API performs repository CAS
  -> service allocates sequence and signs statement
  -> one Git commit stores metadata and exact envelope
  -> public API reads those bytes
```

The operator-visible action is synchronous: success means the signed bytes were
committed. There is no pending approval state. HTTP/CDN readback and client-core
verification remain required runtime evidence before deployment closure.

## 6. Client Integration

Desktop and Mobile use `PEERS_X_CONFIG_URL` as the service origin. Each adapter
constructs `/channels/<channel>/latest.pb`, fetches with a five-second bound,
verifies through `x-config-core`, and persists last-known-good state.

Both clients:

- distinguish suggestions from verified Stations;
- preserve active Station and Session state;
- invoke canonical signed discovery only after selection;
- reject invalid signatures, channel mismatch, expiry, rollback, and
  equal-sequence byte conflict;
- continue launch when remote fetch fails.

## 7. Home Runtime Integration

One Home runtime exists:

```text
Home HTTPS edge
  -> 127.0.0.1:18082
  -> peers-x-config-web
  -> peers-x-config-api
  -> /var/lib/x-config/operator-auth.sqlite
```

Preview runtime values come only from
`env/peers-touch-infra/x-config-preview/runtime.env`. Deployment scripts consume
a committed env revision and exact committed application source. The Compose
runtime mounts a dedicated operator-state directory into the API container.
The edge owns TLS; web and API listeners remain loopback/private.

The OAuth Broker may remain on Vercel. Its owned custom domain is the only
redeem origin configured in Home; X Config does not depend on a raw
`*.vercel.app` hostname.

## 8. Cutover And Cleanup

Cutover order:

1. Commit the X Config source and accepted architecture.
2. Commit the Home env state volume and split storage configuration.
3. Deploy the exact source/env pair without changing the public callback.
4. Prove local attempt/session/revocation persistence across restart.
5. Verify real login, draft persistence, direct publication, public readback,
   and client-core signature.
6. Verify X Config made no `admin-auth` Git mutation during login/logout.
7. Remove the Vercel X Config rollback project only under separate destructive
   authorization.
8. Verify active cloud inventory and source contain no parallel X Config
   runtime or Git-backed operator store.

Cutover is atomic at the X Config operator-store adapter. There is no dual-read,
dual-write, migration, or runtime storage toggle. Rollback uses the prior
versioned Home release and its matching env revision; stale SQLite state is
never restored over a newer database.

## 9. Evidence Boundary

Required Preview evidence:

- current source commit metadata on the deployment;
- committed Home env revision and state-volume identity;
- API readiness after database migration and restart;
- GitHub installation repository selection;
- OAuth login, session, CSRF, logout, replay denial, and restart continuity;
- absence of X Config auth mutations under `x-config/admin-auth/`;
- repository paths under the retained catalog/publication prefixes;
- monotonic sequence and exact envelope digest;
- latest and immutable response headers/bytes;
- client-core signature and rollback checks.

OAuth Broker storage performance, native Desktop/Mobile UI, and destructive
Vercel project deletion remain separate obligations unless explicitly executed
against current source.

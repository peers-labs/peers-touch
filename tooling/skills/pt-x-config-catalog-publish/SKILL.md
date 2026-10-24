---
name: pt-x-config-catalog-publish
description: Publish or republish signed x-config channel catalogs (endpoint seeds, directives, releases, distribution failover origins) through the admin API. Use for x-config catalog publish/republish, targeted directive rollout, channel seed refresh, snapshot mirror/backup-origin or new-origin migration rollout, publishing to corpstable/preview, or guiding an operator through x-config catalog configuration.
---

# X Config Catalog Publish

## Invoke When

- Publishing a new or changed catalog (seeds, directives, releases,
  distribution origins) to an x-config channel (`corpstable`, `stable`, or a
  future channel).
- Refreshing seeds whose `available_until` is approaching expiry.
- Adding or changing a targeting directive (rollout, flavor/region rules).
- Advertising a snapshot mirror/backup origin or migrating clients to a new
  origin via signed `distribution.origins` (XCFG-D06).
- Guiding an operator who asks how to configure an internal channel.

Do not use for: broker/Vercel or OAuth site work (see
`pt-oauth2-client-2-vercel`), deploying/upgrading the x-config service
binary or runtime (see `pt-x-config-deploy`), client-side directive
evaluation, or snapshot verification only.

## Required Discipline

- The console editor covers endpoints/releases only; there is **no directive
  UI**, and the corpstable service hosts **no console at all** (API only).
  The authenticated admin HTTP API is the current canonical write path.
- Catalogs are immutable once published: every publish mints a monotonic
  `sequence`; never overwrite history or lower a sequence.
- Catalog source of truth is a reviewed intent file (this repository), not
  server SQLite drafts. Publish from intent; the server draft is an
  intermediate, never the review surface.
- Publishing requires an operator session for a GitHub subject in the
  channel's `X_CONFIG_OPERATOR_SUBJECTS`. Anonymous public readback needs no
  session.
- Do not handcraft `connection_material_base64`: it is canonical protobuf.
  Build it with an ephemeral Go program against the repository modules and
  delete the program in the same task. No committed publisher CLI is
  maintained.
- Seeds carry short consent windows. Validate uses a one-hour statement, so
  `available_until` must be inside that window; standing channels need
  periodic re-publication. Treat seed refresh as part of every publishing
  run when any seed is within an hour of expiry.
- `distribution.origins` (XCFG-D06) is the only signed channel for snapshot
  failover/migration. Origins are bare base URLs (no path/query/fragment/
  credentials): HTTPS for any host, plain HTTP only for IPv4 loopback/
  RFC1918/link-local literals or IPv6 `[::1]`; up to 4 unique entries, ≤512
  chars each, order = failover preference. Clients merge in this order per
  refresh: `PEERS_X_CONFIG_URL` override, advertised origins, then
  package-baked anchors from `tooling/distribution/channels.json`; an invalid
  or rejected origin never removes the baked tail. Publisher key rotation
  cannot be advertised — it must ship in an app release.

## Inputs

Reviewed intent file per channel. The corpstable format exemplar and
current reviewed intent is `references/corpstable-intent.json`; new channels
follow the same shape and are reviewed with their channel placement.

- `channel`, seed IDs/kinds/display names/regions, relay peer IDs and
  discovery origins;
- directives: closed key (`network.default_relay`,
  `network.default_station`), ordered rules (target clause + rollout) and
  required fallback;
- releases when applicable;
- optional `distribution.origins`: snapshot mirrors for client failover and
  new-origin migration (see Required Discipline for admission limits).

It never carries timestamps or `connection_material_base64`; freshness is
stamped at publish time.

Channel inventory lives in the sibling `env` repository
(`peers-touch-infra/x-config-*`): origin, publisher key id, operator subjects.
Read it in place; never copy secrets into this worktree.

## Workflow

### 1. Resolve channel and operator access

1. Read the channel placement (`inventory.yml`, `runtime.env` keys only) for
   origin, `X_CONFIG_OPERATOR_SUBJECTS`, publisher key id.
2. Open the channel origin in a browser and complete operator login at
   `/api/admin/auth/start` (GitHub handoff through the broker). Pause only
   for human GitHub login/CAPTCHA.
3. Confirm `GET /api/admin/auth/session` returns
   `{"authenticated":true,...}` with an allowlisted subject. The readable
   `peers_xcfg_csrf` cookie is the CSRF token; `peers_xcfg_session` is
   HttpOnly and only travels via same-origin requests.

### 2. Build the catalog from reviewed intent

With a temporary program under the app module (delete before finishing):

- marshal `peer.PublicEndpointConnectionMaterial` deterministically
  (`proto.MarshalOptions{Deterministic:true}` — the server rejects
  non-canonical bytes): schema 1, canonical origin (no path/query/user),
  relay role with empty station root key, live relay peer ID,
  `issued_at = now-1m`, `expires_at = now+6d`;
- `available_until = now+50m` (inside the one-hour validation window and
  before material expiry);
- when the intent carries `distribution.origins`, copy the admitted base
  URLs verbatim into the catalog's `distribution.origins` (same order);
  they are re-validated and canonicalized by the publication builder;
- emit the catalog JSON in the `internal/domain/catalog` shape
  (`schema_version: 1`).

Limits to respect: catalog ≤256 KiB; ≤128 endpoints, ≤64 releases,
≤32 directives / ≤16 rules / ≤8 values per target field; rollout 0..1000
(0 and 1000 both mean full); directive `endpoint_seed_id` values must
reference an existing seed of matching kind; every directive needs a
fallback of the same value kind; target fields are wildcard when empty,
OR within a field, AND across fields; distribution carries ≤4 unique
admitted origins (HTTPS any host, HTTP private IP literals only, no
path/query/fragment/credentials).

### 3. Validate, save, publish

Run authenticated `fetch` calls from a same-origin page **without** an
active restrictive CSP. Admin JSON responses carry
`Content-Security-Policy: default-src 'none'` and block fetch; an ordinary
404 page on the same origin works. Send
`X-CSRF-Token: <peers_xcfg_csrf>` and `credentials: 'same-origin'`.

1. `POST /api/admin/catalog/validate` with the catalog body. Every finding
   blocks; `catalog_trust_invalid` means contract/lifetime failure,
   `endpoint_unavailable`/`endpoint_identity_invalid` means the live
   discovery probe failed (check the origin and IPv6 reachability from the
   service host).
2. Resolve the optimistic-concurrency base: first-ever publish uses
   `base_revision: ""`; every later publish must first
   `GET /api/admin/catalog?channel=<channel>` and use the returned
   `revision`. Then `PUT /api/admin/catalog` with
   `{"base_revision":"<revision>","catalog":{...}}`; record the new
   `revision` and `content_sha256` (409 means the draft moved — re-GET).
3. `POST /api/admin/publications` with
   `{"channel","base_revision":revision,"acknowledged_digest":content_sha256}`.
   201 returns `sequence`, digests, `published_by`, `signing_key_id`.

### 4. Verify the published bytes

1. Anonymous `GET /channels/<channel>/latest.pb` returns the envelope.
2. Unmarshal `SignedXConfigSnapshot`; verify ed25519 over
   `"peers-touch/x-config/v1\x00" + statement_bytes` with the channel's
   publisher public key from
   `apps/x-config/public-keys/publisher-keys.json`.
3. Unmarshal the statement; assert channel, schema 1, expected seeds and
   directives, and (when published) the exact `distribution.origins` list
   in declared order; evaluate representative targeting contexts with
   `xcontrol.EvaluateDirectives` (Go) or the x-config-core evaluator and
   compare against the shared vectors under
   `model/domain/x_config/evaluation-vectors/`.
4. The container healthcheck (`/channels/<channel>/latest.pb`) reports
   healthy once the first snapshot exists.

The executable API reference (stub auth, real handlers, signature and
evaluation checks) is
`apps/x-config/internal/integration/directive_publication_test.go`.

### 5. Close out

- Delete the temporary generator and any local catalog bytes outside the
  reviewed intent file.
- Note the new sequence and the earliest seed `available_until`; schedule
  the next refresh before that instant.
- Intent changes go through normal source review; operator login and the
  publish click remain human-identity actions.

## Failure Semantics

| Observation | Meaning | Action |
|---|---|---|
| `operator_session_required` / 401 on write | No session or wrong origin tab | Re-run `/api/admin/auth/start` on the channel origin |
| CSRF 403 | Missing/mismatched `X-CSRF-Token` | Read `peers_xcfg_csrf` cookie, send exact value |
| `catalog_trust_invalid` | Schema, canonical encoding, lifetime, or `distribution.origins` admission failure | Regenerate material deterministically inside windows; use bare admitted origins only (HTTPS / private-IP HTTP) |
| `endpoint_unavailable` | Live discovery probe failed | Check origin, peer ID, and IPv6/network path from the service host |
| `endpoint_identity_invalid` | Prover identity differs from the seed | Use the relay/station's current live peer ID |
| Draft conflict on publish (409) | Draft revision moved or wrong base | `GET /api/admin/catalog?channel=<channel>`, rebase, re-validate |
| Verify fails client-side | Wrong key, tampering, or wrong channel | Stop; do not point clients at it |

## Anti-Patterns

- Editing catalogs only in the console draft with no reviewed intent.
- Handcrafting or reusing stale `connection_material_base64`.
- Publishing seeds whose `available_until` exceeds the one-hour window, or
  forgetting the refresh cadence.
- Running the publish fetch from a CSP-locked admin JSON page.
- Reusing another channel's publisher key, subjects, or origin.
- Adding directive keys outside the closed registry or rules that
  reference nonexistent seeds.
- Putting paths, query strings, credentials, public-HTTP DNS names, or
  more than four origins into `distribution.origins`; assuming the
  advertised list can replace publisher keys (key rotation still needs an
  app release), or that an empty/mirror set can remove the baked anchors.
- Committing the ephemeral generator, service secrets, or signed snapshot
  bytes as the catalog source of truth.

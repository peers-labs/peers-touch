# Station Object Storage & OSS Subserver

> Status: **v3 (terminal, shipped)**, 2026-04-28
>
> Scope: Domain-neutral object storage mechanics for file objects exchanged
> through a Peers-Touch Station —
> friend / group chat attachments (image, document, audio, video),
> avatars and profile media, applet-managed objects. v3 closes the
> subsystem: full object lifecycle (delete / patch / restore / TTL /
> refcount-based blob GC), out-bound federation (mint + rotate +
> revoke), dashboard admin mutation, observability (healthz / metrics
> / workers heartbeat). After v3 the OSS interior is frozen — future
> work composes on top (E2EE, thumbnails, full-text search, one-time
> external share URLs).
>
> Frontend deferred: the dashboard React tabs (Workers panel + alert
> lights) and desktop UI (MyFiles page, federated visibility badges)
> consume the v3 backend surface but ship in their own iteration. The
> backend-side endpoints they will consume (`/dashboard/api/oss/workers`,
> `/dashboard/api/oss/federation/peers/:id` DELETE) are part of v3.

## 1. Goals

The OSS subserver is the file plane of a Peers-Touch deployment. It
must satisfy four architectural pressures simultaneously:

1. **Home-level decentralization.** The default deployment is one
   physical box with a single station process. The subserver works
   out-of-the-box with no external dependencies — no S3, no CDN, no
   message broker. A NAS or mini-PC is the target hardware.

2. **Small-scale federation.** Multiple stations, owned by different
   households, exchange chat messages. An attachment uploaded to
   station A must be addressable, fetchable and verifiable when
   received by station B's user. The naming scheme embeds enough
   information for the receiver to reach the right station without a
   global registry; the trust model uses Trust-On-First-Use peer keys
   plus optional operator pinning.

3. **Operator configurability.** A power user may want to front the
   file plane with a different hostname, run OSS in its own process,
   cap upload sizes, control TTL / quota / audit retention, and pin
   peer trust manually — all via YAML or the dashboard, never via
   code change.

4. **Operational completeness.** Buckets, files, and remote keys
   support full CRUD; users have self-service over their own files;
   the system runs internal lifecycle workers (TTL, soft delete,
   blob GC, reconcile) and exposes external observability (healthz,
   metrics, audit) so an operator can answer "who stored what, when,
   for whom" without touching SQL.

## 2. Layered model

```
┌─────────────────────────────────────────────────────────────────┐
│ ChatMessageArea / AttachmentItem / MyFilesPage (React)          │
│   - useAttachmentUrl(cid) → src                                 │
│   - api.chatUploadAttachment / api.ossResolveUrl                │
│   - api.ossListMyFiles / patch / delete / restore               │
└──────────────┬──────────────────────────────────────────────────┘
               │  Tauri ipc
┌──────────────▼──────────────────────────────────────────────────┐
│ interface/tauri_commands/oss.rs                                 │
│   pick_chat_attachment / chat_upload_attachment                 │
│   oss_resolve_url / oss_list_my_files                           │
│   oss_patch_file / oss_delete_file / oss_restore_file           │
└──────────────┬──────────────────────────────────────────────────┘
┌──────────────▼──────────────────────────────────────────────────┐
│ application/oss/mod.rs   (federation mint flow lives here)      │
└──────────────┬──────────────────────────────────────────────────┘
┌──────────────▼──────────────────────────────────────────────────┐
│ infrastructure/oss_cache + station_client                       │
│   parses oss:// URI; mints peer-jwt for cross-station origin    │
│   invalidates cache on any mutate                                │
└──────────────┬──────────────────────────────────────────────────┘
               │  reqwest
┌──────────────▼──────────────────────────────────────────────────┐
│ Station: apps/station/app/subserver/oss/                        │
│   POST /sub-oss/upload | /presign-upload | /upload-complete     │
│   POST /sub-oss/multipart/{init,part,complete}                  │
│   GET  /sub-oss/file?key=...                                    │
│   PATCH /sub-oss/file/:key                                      │
│   DELETE /sub-oss/file/:key                                     │
│   POST /sub-oss/file/:key/restore                               │
│   GET  /sub-oss/my-files                                        │
│   POST /sub-oss/federation/token                                │
│   GET  /sub-oss/capabilities  (public)                          │
│   GET  /sub-oss/healthz       (public)                          │
│   GET  /sub-oss/metrics       (operator-bearer)                 │
│   POST /sub-oss/meta          (proto)                           │
└─────────────────────────────────────────────────────────────────┘
```

Each layer has one responsibility: the UI never thinks about hosts or
keys; Tauri commands carry per-window JWTs and are thin pass-throughs;
application owns the protocol (which fields go in payloads, when to
mint a peer-jwt); infrastructure owns physical state (caches, URI
parsing, request signing); the station owns bytes, policy, and the
audit truth.

## 3. The federated `cid` URI

`MessageAttachment.cid` is always either empty or a valid:

```
oss://{origin}/{key}
```

where:

- `origin` is the externally-reachable URL of the OSS subserver,
  either a full `https://files.example.com` or a `host:port` pair.
- `key` is the storage backend's object key (CAS-shaped:
  `<sha256-prefix>/<sha256-rest>.<mime-ext>`). Metadata uniqueness is
  `(owner_actor_id, key)` — two actors uploading identical bytes
  share one on-disk blob but get separate `oss_files` rows so policy,
  visibility, and quota stay per-actor.

### Resolution order on the server

`apps/station/app/subserver/oss/handler.go::resolveOrigin` decides which
origin to embed when responding to upload-success:

1. `Options.HostOverride` (operator config) — wins because in CDN /
   reverse-proxy scenarios the inbound `Host` header is the proxy's
   view, not the public origin.
2. `X-Forwarded-Proto` + `Host` (or `r.Host`) — correct for home
   deployments with one reachable URL.
3. The literal string `"self"` — last resort; clients treat it as
   "same origin as the station I am bound to".

### Parsing on the client

`infrastructure/oss_cache::OssUri::parse` accepts:

- `oss://https://files.example.com/2026/04/26/abc.png` — full form.
- `oss://station.local:9090/abc` — schemeless host.
- `2026/04/26/abc.png` — bare key, pinned to the caller's bound station.

The parser is deliberately tolerant; round-tripping
`parse(uri).to_uri() == uri` holds for any URI we ourselves emit.

## 4. Capabilities discovery

`GET /sub-oss/capabilities` is **public** (no JWT) and returns the v3
document the client uses to pre-validate uploads, choose data paths,
and verify federation tokens:

```jsonc
{
  "version": 3,
  "capability_version": "01KQ73...",   // ULID; bumps on visibility-tighten / quota / federation key rotation

  "host": "https://files.example.com",
  "path_base": "/sub-oss",
  "backend": "local",
  "key_strategy": "random",

  "max_file_size": 33554432,
  "max_files_per_message": 9,
  "signed_url": false,                 // true when sign-secret is set

  "upload_endpoint": "/sub-oss/upload",
  "file_endpoint":   "/sub-oss/file",
  "meta_endpoint":   "/sub-oss/meta",

  "presigned_upload": false,           // true → block below appears
  "presigned_threshold": 8388608,
  "presigned_endpoints": {
    "presign":  "/sub-oss/presign-upload",
    "complete": "/sub-oss/upload-complete"
  },

  "lifecycle_endpoints": {
    "delete":   "/sub-oss/file",
    "patch":    "/sub-oss/file",
    "restore":  "/sub-oss/file/restore",
    "my_files": "/sub-oss/my-files"
  },

  "federation": {
    "outbound":         true,           // false on dev/test stations with no fedkey wired
    "max_ttl_seconds":  60,
    "token_type":       "peer+jwt",
    "local_station_id": "station-abc",
    "mint_endpoint":    "/sub-oss/federation/token"
  }
}
```

Two additional public endpoints are NOT advertised in `/capabilities`
(operators wire them through ops tooling, not via client probes):

```
GET /sub-oss/healthz       — lightweight readiness probe
GET /sub-oss/metrics       — Prometheus exposition (gated by metrics-bearer-token)
```

The `multipart_*` block is reserved for a future iteration; as of v3
the desktop client only consumes the presigned PUT / multipart-init
helpers when the active backend exposes them via the matching
capability interface.

`version` bumps on any breaking shape change so clients fail loudly
rather than silently misinterpret. `capability_version` (separate
field) bumps on **policy** changes (visibility tightening on a file,
quota change on a bucket, federation key rotation) so remote caches
know to re-validate without a hard version step.

The endpoint is public on purpose — the response carries no secrets,
and clients need it before they have a JWT (first login, or peer
station probing for federation).

## 5. Configuration surface

YAML keys (`peers.node.server.subserver.oss.*`):

| Key | Default | Purpose |
| --- | --- | --- |
| `enabled` | `false` | Toggle the entire subserver. |
| `path` | `/sub-oss` | Base path mounted under the station's HTTP server. |
| `rds-name` | (depends) | GORM DSN for the file metadata schema. |
| `store-path` | `<datadir>/oss` | Filesystem root for the local backend. |
| `sign-secret` | `""` | HMAC secret for signed URLs; empty disables. |
| `host-override` | `""` | Public origin to advertise / embed in `cid`. |
| `max-file-size` | `33554432` (32 MiB) | Per-file upload cap, bytes. |
| `max-files-per-message` | `9` | Advisory client-side limit. |
| `backend` | `local` | Storage driver: `local`, `s3`. |
| `presigned-upload-threshold` | `8388608` (8 MiB) | Files ≥ this go through presigned PUT (S3 only). |
| `multipart-upload-threshold` | `104857600` (100 MiB) | Files ≥ this go through multipart (S3 only). |
| `audit-retention-days` | `90` | `AuditTrim` worker window. |
| `soft-delete-grace-days` | `7` | Restore window before blob GC eligibility. |
| `blob-gc-grace-hours` | `24` | Time at `ref_count=0` before physical delete. |
| `worker-ttl-interval` | `1h` | TTL sweeper period. |
| `worker-blobgc-interval` | `1h` | Blob GC period. |
| `worker-reconcile-interval` | `24h` | Bucket usage reconcile period. |
| `metrics-bearer-token` | `""` | Static token gating `/metrics`; empty disables endpoint. |
| `mime-blocklist` | `[]` | List of MIME prefixes (e.g. `application/x-msdownload`) refused on upload. |

For independent deployment (OSS in its own process), the operator runs
a station with **only** the OSS subserver enabled, sets `host-override`
to the public URL of that process, and shares the JWT secret with the
chat-serving station so its tokens are accepted.

## 6. Storage backends

The on-disk plane is a strict interface; drivers may opt into optional
capabilities reflected through `/capabilities`.

```go
// Mandatory. Source of truth: apps/station/frame/core/facility/storage/storage.go
type Backend interface {
    Save(ctx context.Context, key string, r io.Reader) (string, error)            // returns canonical path/URI
    Open(ctx context.Context, key string, rng *Range) (io.ReadCloser, int64, string, error) // body, full-size, mime
    Stat(ctx context.Context, key string) (*StatInfo, error)                      // {Size, Mime, ETag}
    Delete(ctx context.Context, key string) error                                 // idempotent
    Healthz(ctx context.Context) error                                            // lightweight probe
}

// Optional capability interfaces — drivers opt in by implementing them
// and the OSS subserver reflects the capability through `/capabilities`.
type PresignedBackend interface {
    PresignPut(ctx context.Context, key, mime string, size int64, sha256 string, ttl time.Duration) (PresignedRequest, error)
    PresignGet(ctx context.Context, key string, ttl time.Duration) (PresignedRequest, error)
    HeadObject(ctx context.Context, key string) (HeadInfo, error)                 // {Size, Mime, ETag, Sha256}
}
type MultipartBackend interface {
    PresignMultipartInit(ctx context.Context, key, mime string) (uploadID string, err error)
    PresignMultipartPart(ctx context.Context, key, uploadID string, partNum int) (PresignedRequest, error)
    PresignMultipartComplete(ctx context.Context, key, uploadID string, parts []MultipartPart) error
}
type LifecycleBackend interface {
    SetExpiry(ctx context.Context, key string, expiresAt *time.Time) error        // nil clears the hint
}
```

`Backend.Stat` deliberately omits SHA-256 — the hash is a property of how
the bytes were written (CAS keys are derived from it), not something the
driver re-derives on read. Callers that need the hash either trust the
key prefix or load `oss_blobs.sha256` from the DB.

`LifecycleBackend.SetExpiry` is observational: the DB row is the
authoritative source of truth for when an object expires; the sidecar /
lifecycle policy lets out-of-band tooling see "this blob was scheduled
to expire at X" even when the metadata DB is unreachable.

| Driver | `Backend` | `Presigned` | `Multipart` | `Lifecycle` |
| --- | --- | --- | --- | --- |
| `LocalBackend` | ✓ | — | — | ✓ (sidecar `.expires` files; the TTL sweeper still runs as the source of truth) |
| `S3Backend` | ✓ | ✓ | ✓ | ✓ (S3-side lifecycle policy mirrors `expires_at`) |

Per-row dispatch: `oss_files.backend` is the routing key. Both drivers
stay registered for the lifetime of the process so an operator who
flips `local → s3` keeps reading legacy local rows. Unknown backend
name on a row → 410 Gone with a clear log line; the file is
unrecoverable from the active driver and the operator is told so.

`signed_url == true` (HMAC config) and `backend == "s3"` both flip the
client into "do not mirror" mode: the renderer hits the absolute URL
directly because caching short-lived signed bytes locally is wasteful.

## 7. Object lifecycle

```
                    ┌──────────────────┐
       upload ────▶ │ live             │── PATCH(vis|bucket|expiry|name) ─▶ live'
                    │   ref_count++    │
                    │   used_bytes+    │
                    │   expires_at     │
                    └────┬─────────────┘
                         │
            ┌── TTL ─────┘     (worker:    expires_at < now)
            │
            ▼
                    ┌──────────────────┐
   user DELETE ──▶  │ deleted          │── POST /restore (within 7d) ─▶ live
                    │   ref_count--    │
                    │   used_bytes-    │
                    │   deleted_at=now │
                    └────┬─────────────┘
                         │ 7d soft-delete grace expired
                         │ AND ref_count == 0
                         │ AND last_seen_at < now - blob-gc-grace
                         ▼
                    backend.Delete(key)
                    DROP oss_blobs row
                    audit(action=blob_gc)
```

### Upload semantics

1. Validate (`bucket` exists for actor; `visibility` ∈ enum; `chat`
   requires `chat_session_id`; mime not in blocklist; size ≤ cap).
2. Atomically `bucket.used_bytes += size, object_count++` with quota
   predicate (`quota_bytes = 0 OR used_bytes + size ≤ quota_bytes`)
   — fails with `quota_exceeded` if the predicate trips.
3. `backend.Save` → on success, upsert `oss_blobs` (insert or
   `ref_count++`).
4. Insert `oss_files` with:
   - `expires_at = now + bucket.ttl_days × 24h` if `ttl_days > 0` and
     the upload didn't pass an explicit override; else NULL.
   - `(owner_actor_id, key)` unique — duplicate from the same actor
     short-circuits to the existing row (CAS dedup).
5. `audit(action=upload, outcome=ok, size_bytes=...)`.

If step 4 fails after step 3 succeeded, undo: `oss_blobs.ref_count--`
(may delete the row if it was just created); `bucket` usage rollback;
`backend.Delete` only when `oss_blobs.ref_count == 0`.

### Patch

Owner-only; `PATCH /sub-oss/file/:key` with any subset of:

- `visibility` — owner can both tighten and loosen. Tightening
  (`public → chat|private` or `chat → private`) bumps `capability_version`
  so far-side caches drop their copy on next probe.
- `chat_session_id` — only valid if visibility is `chat`.
- `bucket_id` — re-checks target bucket quota; source `used_bytes -= size`,
  target `used_bytes += size`. Same-actor only (cross-actor moves are
  not allowed; the model is owner-scoped).
- `filename` — cosmetic; UI-only effect.
- `expires_at` — extend or shorten; NULL clears expiry.

Always sets `updated_at = now` and writes
`audit(action=patch, reason=<which-field>)`.

### Delete (soft) and restore

`DELETE /sub-oss/file/:key` (owner): set `deleted_at = now`,
`oss_blobs.ref_count--`, `bucket.used_bytes -= size`,
`audit(action=delete)`. The blob stays on disk.

`POST /sub-oss/file/:key/restore` (owner) within `now - deleted_at <
soft-delete-grace-days`: reverse the above. Outside the window: 410
Gone, the row may already be gone (BlobGC has run) or about to be.

### TTL

`oss_files.expires_at` is set on upload from `bucket.ttl_days` (or
explicit). The `TTLSweeper` worker (§10) runs hourly with the
predicate `WHERE expires_at < now() AND deleted_at IS NULL` and applies
the same code path as user delete (refcount--, audit
`action=delete, reason=ttl`). Nothing else expires automatically.

### Blob GC

Per-actor CAS means two actors can share one on-disk blob; deleting
one actor's metadata must not orphan the bytes the other still uses.
`oss_blobs.ref_count` is the authoritative counter. `BlobGC` runs
hourly with `WHERE ref_count = 0 AND last_seen_at < now() -
blob-gc-grace-hours`, calls `backend.Delete(key)`, drops the
`oss_blobs` row, and writes `audit(action=blob_gc)`.

The grace window prevents a delete-then-immediate-reupload race from
churning S3 objects.

## 8. Permission model

### Caller types

| Caller | Identity | Carrier |
| --- | --- | --- |
| anonymous | none | no `Authorization` |
| user | HS256 JWT, `sub = actor_id` | `Authorization: Bearer <user-jwt>` |
| peer | EdDSA peer-jwt, `typ=peer+jwt`, `sub = remote actor`, `iss = remote station` | `Authorization: Bearer <peer-jwt>` |
| dashboard | HS256 dashboard JWT, role = operator | dashboard cookie / header |
| operator-bearer | YAML-configured static token | `Authorization: Bearer <metrics-token>` (only `/metrics`) |

### Decision matrix

Read (`GET /sub-oss/file`):

| visibility | anonymous | user (owner) | user (other) | peer (sub=A) | dashboard |
| --- | --- | --- | --- | --- | --- |
| public | ✅ | ✅ | ✅ | ✅ | ✅ |
| chat | ❌ subject_required | ✅ | resolver(actor, sess) | resolver(sub, sess) | ✅ admin_view |
| private | ❌ | ✅ | ❌ not_owner | ❌ unless sub==owner | ✅ admin_view |

Write paths:

| Operation | Allowed callers |
| --- | --- |
| upload / presign-upload / upload-complete / multipart | user |
| PATCH `/file/:key` | user (owner) |
| DELETE `/file/:key` / restore | user (owner) |
| my-files | user (own only) |
| federation/token mint | user (only for files where the user has read permission per the matrix above) |
| dashboard `POST/PATCH/DELETE /buckets` | dashboard |
| dashboard `PATCH/DELETE /objects/:id` | dashboard (writes `admin_*` audit) |
| federation rotate / forget-peer / pin / unpin | dashboard |

### Reason codes (closed set)

Every denial writes `oss_audit(outcome=denied, reason=<code>)`. The
client always sees a generic 401/403/404 — reasons are an operator-only
diagnostic. Closed set:

```
subject_required        not_owner
not_in_session          session_missing
resolver_error          resolver_missing

peer_token_invalid      peer_token_expired
peer_audience_mismatch  peer_ttl_too_long
peer_key_mismatch       peer_pinned_mismatch

quota_exceeded          size_exceeded
mime_blocked            bucket_visibility_mismatch
expired
unknown_visibility
```

Reason strings are stable — dashboards, alerts, and tests match on them.

`ChatSessionResolver` is an injected interface (`is actor X a
participant of session Y`); the default implementation queries
`friend_chat_sessions` through the same store layer, without importing
friend_chat. This keeps OSS testable in isolation (stub the resolver)
and avoids dependency cycles. `resolver_missing` is fail-closed: a
chat-visibility file with no resolver wired is denied, not allowed.

## 9. Federation

### Out-bound (mint + cross-station GET)

```
desktop                       home station                target station
   │  oss_resolve_url(oss://T/k) │                              │
   │  origin != bound_station    │                              │
   │ ──────────────────────────▶ │ POST /sub-oss/federation/   │
   │                             │      token                  │
   │                             │  user-jwt verified           │
   │                             │  read-permission rechecked   │
   │                             │  audit: federation_mint      │
   │ ◀──── { token, exp } ───────│                              │
   │                                                            │
   │ ─────────── GET /sub-oss/file?key=k ──────────────────────▶ │
   │             Authorization: Bearer <peer-jwt>                │
   │                                                            │ VerifyPeerToken
   │                                                            │   typ check, alg check
   │                                                            │   aud check (== self_id)
   │                                                            │   exp / iat / ttl≤60
   │                                                            │   oss_key == requested
   │                                                            │   TOFU or Pin enforce
   │                                                            │ checkRead(visibility, sub)
   │ ◀───────────── bytes / 302 PresignGet ─────────────────────│ audit: federation_verify
```

Mint payload:

```jsonc
{
  // header
  "alg": "EdDSA", "typ": "peer+jwt", "kid": "<self federation kid>",
  "jwk_pem": "<self federation pubkey PEM>",
  // claims
  "iss": "<self station id>",
  "aud": "<sha256(target_origin)>",
  "sub": "<user.actor_id>",
  "oss_key": "<key user wants to fetch>",
  "iat": <now>, "exp": <now + 60>,
  "jti": "<ulid>"
}
```

The home station re-runs the read-permission check before minting:
the user must currently have read access to the file (per §8 matrix)
**on the home station's view**. This isn't redundant with the target
station's own check — it stops the home station from being a peer-jwt
oracle for files its user could not have read directly.

### In-bound

`/sub-oss/file` accepts both user-jwt and peer-jwt. Peer-jwt routes
through `VerifyPeerToken` (TOFU on first sight of an `iss`, then
strict `kid`+PEM match; pinned rows reject any kid change). Verified
peer-jwts feed the same `checkRead` path with `sub` as the effective
caller, so the §8 decision matrix applies uniformly.

### Local key rotation

`POST /dashboard/api/oss/federation/rotate-local-key` (operator):

1. Generate fresh Ed25519 keypair.
2. Move current `federation_priv_pem` / `federation_kid` to `*_prev`
   columns; write new pair as primary.
3. Stamp `federation_rotated_at = now`.
4. Mint always uses the new key. Verify accepts both new and `_prev`
   keys for 24h (dual-sign window).
5. `KeyRotationFinalizer` worker clears `*_prev` once
   `now - federation_rotated_at > 24h`.
6. `audit(action=key_rotate)`.

Pinned remote peers see `peer_pinned_mismatch` once they fetch a token
signed by the new key — by design. The operator must re-Pin on the
remote side. This is the trade-off for "true pinning means rotation
requires re-pairing."

### Revocation

`DELETE /dashboard/api/oss/federation/peers/:id` drops the
`oss_peer_keys` row entirely. Next request from that peer re-runs TOFU.
There is no immediate revocation of in-flight peer-jwts already
issued — the 60s TTL is the actual revocation window. Anyone needing
faster revocation must operate at a different layer (firewall, DNS).

## 10. Management & observability plane

### Dashboard admin API

All routes use the dashboard JWT (same `authWrapper` as the rest of
the admin surface).

Read:

```
GET  /dashboard/api/oss/buckets                    list buckets
GET  /dashboard/api/oss/buckets/:id                one bucket
GET  /dashboard/api/oss/buckets/:id/objects        objects in bucket
GET  /dashboard/api/oss/objects                    global object listing
GET  /dashboard/api/oss/audit                      audit log (filters)
GET  /dashboard/api/oss/usage                      totals + top owners + visibility mix
GET  /dashboard/api/oss/federation/me              this station's pubkey + kid
GET  /dashboard/api/oss/federation/peers           known remote stations
GET  /dashboard/api/oss/workers                    worker heartbeats
```

Mutate (every mutation writes a `dashboard_audit_logs` row tagged with
the operator actor):

```
POST   /dashboard/api/oss/buckets                   create user bucket
PATCH  /dashboard/api/oss/buckets/:id               update quota/TTL/default_visibility/description
DELETE /dashboard/api/oss/buckets/:id?force=        refuse non-empty unless force=true
PATCH  /dashboard/api/oss/objects/:id               operator visibility override (moderation)
DELETE /dashboard/api/oss/objects/:id               admin_delete with forced refcount--
POST   /dashboard/api/oss/federation/rotate-local-key
POST   /dashboard/api/oss/federation/peers/:id/pin
POST   /dashboard/api/oss/federation/peers/:id/unpin
DELETE /dashboard/api/oss/federation/peers/:id      forget (next call re-TOFUs)
```

### Audit (`oss_audit`)

Append-only. Each row carries `action` (closed set), `outcome`
(`ok|denied|not_found|error`), optional stable `reason`, `ts`,
`actor_id` (NULL for anonymous public reads), `peer_station_id` (when
the request used a peer-jwt), `dashboard_actor_id` (when the request
came from the dashboard), `bucket_id`, `file_key`, `file_id`,
`size_bytes`, `request_id` (correlation across the request lifecycle).

Action enum:

```
upload  presign_put  upload_complete  multipart_init  multipart_part  multipart_complete
get     presign_get
patch   delete   restore   blob_gc
admin_delete   admin_visibility_override
bucket_create  bucket_update  bucket_delete
federation_mint  federation_verify  key_rotate
peer_pin  peer_unpin  peer_forget
healthz_check  worker_run
```

`AuditTrim` worker prunes rows older than `audit-retention-days`.

### Workers

| Worker | Period | Predicate / Job |
| --- | --- | --- |
| `TTLSweeper` | hourly | `expires_at < now AND deleted_at IS NULL` → soft delete |
| `BlobGC` | hourly | `ref_count=0 AND last_seen_at<now-blob-gc-grace-hours` → physical delete |
| `BucketReconciler` | daily | reconcile `bucket.used_bytes` vs `SUM(oss_files.size)`; drift>1% → fix + alert |
| `PeerKeyTrim` | daily | non-pinned + `last_seen_at < now-30d` → drop |
| `KeyRotationFinalizer` | hourly | `federation_rotated_at < now-24h` → clear `*_prev` |
| `AuditTrim` | daily | `ts < now - audit-retention-days` → soft delete |

All workers share an advisory-lock abstraction (Postgres
`pg_try_advisory_lock`, SQLite test fallback to in-memory mutex) so
multi-instance deployments elect a single leader. Each run writes
`audit(action=worker_run, outcome=ok|error, reason=<worker_name>[:err])`.
The `oss_audit` table is the durable heartbeat source — the
`worker.Scheduler` also keeps an in-process snapshot (last run /
duration / outcome / counts per worker) which feeds `/metrics`. The
dashboard `/dashboard/api/oss/workers` endpoint projects per-worker
heartbeats from `oss_audit` (default 24h lookback) so the operator
panel survives process restarts.

### Healthz

`GET /sub-oss/healthz` (public, lightweight):

```jsonc
{ "ok": true, "checks": { "db": "ok", "backend": "ok", "federation_key": "ok" } }
```

Any failed check returns 503. The `backend` check writes a small
sentinel (`__healthz`) and reads it back, so the path includes the
real driver code (not just connectivity).

### Metrics

`GET /sub-oss/metrics` (gated by `metrics-bearer-token` YAML key —
empty token disables the endpoint entirely; we do not allow
unauthenticated metrics scraping). The exposition uses the standard
Prometheus text format (v0.0.4); the wire format is hand-emitted
rather than depending on `prometheus/client_golang` so the OSS
subserver stays free of an external client library for a small,
stable metric set.

Currently exported (v3 baseline):

```
oss_build_info{version, commit}                         gauge, always 1
oss_up                                                  gauge (1 = healthy, 0 = not)
oss_worker_runs_total{worker, outcome}                  counter
oss_worker_errors_total{worker}                         counter
oss_worker_last_run_seconds{worker}                     gauge (unix seconds)
oss_worker_last_duration_seconds{worker}                gauge
```

The richer counter set (per-action upload / read / federation
verify, per-bucket usage, per-blob orphan count) is **planned for
v3.1** — the v3 release intentionally ships the minimum that lets a
Prometheus scraper detect "the OSS subserver is up" and "a worker
died". The full counter set requires either an in-process counter
registry or a periodic SQL aggregation pass; both have non-trivial
design choices that are deferred until the operator UI starts
consuming them.

Until the richer set lands, the durable per-action and per-bucket
truth lives in `oss_audit`, which the dashboard already drills into
through `GET /dashboard/api/oss/usage` and
`GET /dashboard/api/oss/audit`. Dashboard alert lights are therefore
implemented as audit-derived projections, not Prometheus alerts:

- `bucket_quota_ratio > 0.8` → yellow (computed from
  `oss_buckets.used_bytes / quota_bytes`).
- `federation_verify denied rate > 5% / 5min` → red (audit-derived).
- `blob_gc orphan count > 1000` → yellow (BucketReconciler/BlobGC
  surface this through audit).
- `worker_last_run > 2× interval ago` → red (worker died) —
  consumable from both `/metrics` and the workers projection.

## 11. Invariants & non-goals

### Invariants

- **`MessageAttachment.cid`** is always either empty or a valid
  `oss://...` URI. The send path emits the full URI; parsers may still
  accept a bare key when the string lacks an `oss://` prefix
  (pinned to the caller's bound station).
- **Capabilities cache** is keyed by both the origin queried and the
  origin advertised, so probe-host vs canonical-host resolve to the
  same entry.
- **Per-actor metadata uniqueness:** `oss_files` `(owner_actor_id, key)
  WHERE deleted_at IS NULL` is unique. Identical content shares one
  physical blob and key; visibility, quota, ownership stay per-actor.
- **Refcount truth:** `oss_blobs.ref_count == COUNT(oss_files WHERE
  deleted_at IS NULL AND backend|key matches)`. The reconciler is the
  safety net; mutations do not assume the counter is correct without
  the predicate.
- **Bucket usage truth:** `oss_buckets.used_bytes == SUM(oss_files.size
  WHERE deleted_at IS NULL AND bucket_id matches)`. Reconciler corrects
  drift > 1%.
- **Cache layout:** desktop on-disk attachment cache buckets by
  sanitized origin. Two different `oss://` origins with the same `key`
  path segment never clobber each other.
- **Local cache misses** never break rendering: `oss_resolve_url`
  always returns at least an absolute URL when the URI is valid; the
  renderer can always fall back to network fetch.
- **Dashboard mutations** always write `dashboard_audit_logs`; OSS
  audit (`oss_audit`) records the resulting OSS-side action separately
  with `dashboard_actor_id` set. Two-row pattern is intentional — one
  row per concern (operator action vs file effect).
- **Federation mint** never issues a token for a file the home-station
  user cannot currently read. The home station is not a peer-jwt
  oracle.

### Non-goals (out of scope for v3)

- **End-to-end encryption.** Orthogonal — the encryption layer wraps
  `MessageAttachment.cid` like text content. Bytes on disk are
  ciphertext from OSS's perspective; the subserver does not
  participate in the key exchange.
- **Thumbnails / transcoding.** Independent subsystem, possibly an
  applet, possibly a sidecar. Not OSS's concern.
- **Full-text search** over filenames or extracted content. Different
  index, different storage shape.
- **One-time external share URLs** (give a non-actor a link to one
  file). A different security model — likely a signed, audience-less
  short-lived URL minted by the dashboard. Out of scope for the core
  subsystem, will compose on top.
- **Cross-region / multi-master replication.** One station, one
  region. Federation is the answer for cross-station reach.
- **Bulk migration tool** from local backend to S3. Lazy migration
  (per-row `backend` column) is the architectural answer; an explicit
  migration command is a follow-up tool, not part of OSS.

# Chat File Storage & OSS Subserver

> Status: Draft, 2026-04-27
>
> Scope: Friend chat + group chat attachments (image, document, audio,
> video). Avatar / profile-image upload retains its existing path
> (`profile_upload_avatar_oss` → `/sub-oss/upload`) but now benefits
> from the same federated `cid` URI as a side effect.
>
> 2026-04-27: §6 rewritten around the pluggable backend factory and
> the new `PresignedBackend` capability; §6.2 covers the presigned
> upload data path; capabilities response bumped to `version: 2`.

## 1. Goals

The OSS subserver is the file plane of a Peers-Touch deployment. It
must satisfy three architectural pressures simultaneously:

1. **Home-level decentralization.** The default deployment is one
   physical box with a single station process. The subserver must
   work out-of-the-box with no external dependencies — no S3, no
   CDN, no message broker. A NAS or mini-PC is the target hardware.

2. **Small-scale federation.** Multiple stations, owned by different
   households, exchange chat messages. An attachment uploaded to
   station A must be addressable, fetchable and (eventually)
   verifiable when received by station B's user. The naming scheme
   has to embed enough information for the receiver to reach the
   right station without a global registry.

3. **Operator configurability.** A power user may want to:
   - Front the file plane with a different hostname (CDN, reverse
     proxy, separate subdomain).
   - Move OSS into its own process, sharing only the JWT secret with
     the main station.
   - Cap upload sizes per the household's storage budget.

   None of these should require code changes; they are knobs.

This document describes the resulting design, the wire shapes that
make it work, and the OSS subserver’s management and permission
planes.

## 2. Layered model

```
┌─────────────────────────────────────────────────────────────────┐
│ ChatMessageArea / AttachmentItem (React)                        │
│   - useAttachmentUrl(cid) → src                                 │
│   - api.chatUploadAttachment / api.ossResolveUrl                │
└──────────────┬──────────────────────────────────────────────────┘
               │  Tauri ipc
┌──────────────▼──────────────────────────────────────────────────┐
│ interface/tauri_commands/oss.rs                                 │
│   - pick_chat_attachment    (native dialog)                     │
│   - chat_upload_attachment  (per-window JWT)                    │
│   - oss_resolve_url         (URI → local path / URL)            │
└──────────────┬──────────────────────────────────────────────────┘
┌──────────────▼──────────────────────────────────────────────────┐
│ application/oss/mod.rs                                          │
│   - chat_upload_attachment                                      │
│   - oss_resolve_url                                             │
└──────────────┬──────────────────────────────────────────────────┘
┌──────────────▼──────────────────────────────────────────────────┐
│ infrastructure/oss_cache/mod.rs                                 │
│   - OssUri::parse(...)                                          │
│   - capabilities_ensure(origin)  (in-memory, per-origin)        │
│   - attachment_ensure(uri)       (on-disk, cache/files/oss/...) │
└──────────────┬──────────────────────────────────────────────────┘
               │  reqwest blocking
┌──────────────▼──────────────────────────────────────────────────┐
│ Station: apps/station/app/subserver/oss/                        │
│   - POST /sub-oss/upload      (multipart, JWT)                  │
│   - GET  /sub-oss/file        (signed query when configured)    │
│   - GET  /sub-oss/capabilities (public, no JWT)                 │
│   - POST /sub-oss/meta        (proto)                           │
└─────────────────────────────────────────────────────────────────┘
```

Each layer has one responsibility:

- **UI** never thinks about hosts or keys. It receives a `cid` string
  on a message attachment and asks `useAttachmentUrl` to turn it into
  a `src`. Loading states are local; the cache hides round-trips.
- **Tauri commands** carry per-window JWTs and are the only layer
  that pierces the user/actor boundary. They are thin — every command
  is a 5-line wrapper around an application function.
- **Application** owns the protocol (which fields go in the upload
  response, how to fall back when Station omits `cid`).
- **Infrastructure** owns physical state: capabilities maps, on-disk
  attachment bytes, URI parsing.
- **Station** owns the bytes and the policy (limits, signing,
  backend choice).

## 3. The federated `cid` URI

Before this work, `MessageAttachment.cid` was an opaque string —
typically `2026/04/26/abc.png` — that meant nothing to a receiver
who did not happen to be talking to the same station as the uploader.

We now standardize on:

```
oss://{origin}/{key}
```

where:

- `origin` is the externally-reachable URL of the OSS subserver,
  either a full `https://files.example.com` or a host:port pair like
  `station.local:9090`.
- `key` is the storage backend's object key (often CAS-shaped). It is
  unique together with the uploader's actor id in metadata
  `(owner_actor_id, key)` so two actors never share a policy row even
  when the backend reuses one on-disk blob for identical bytes.

### Resolution order on the server

`apps/station/app/subserver/oss/handler.go::resolveOrigin` decides
which origin to embed into the URI when responding to `/upload`, in
this priority order:

1. `Options.HostOverride` — operator config (`host-override` YAML
   key). This wins because in a CDN / reverse-proxy scenario the
   inbound `Host` header is the proxy's view, not the public origin.
2. The request's `X-Forwarded-Proto` + `Host` (or `r.Host`) headers.
   This is correct for home deployments where there is exactly one
   reachable URL and `r.Host` reflects it.
3. The literal string `"self"` — last resort when no host info is
   available (test runs, malformed requests). Clients treat it as
   "same origin as the station I am bound to".

### Parsing on the client

`infrastructure/oss_cache::OssUri::parse` accepts:

- `oss://https://files.example.com/2026/04/26/abc.png` — full form.
- `oss://station.local:9090/abc` — schemeless host.
- `2026/04/26/abc.png` — bare key, pinned to the caller's bound
  station via `station_client::station_base_url` when the URI does
  not include an `oss://` origin.

The parser is deliberately tolerant: it accepts double-slashes and
embedded schemes inside the host segment without reformatting them,
because we want round-tripping (`parse(uri).to_uri() == uri`) for any
URI we ourselves emit.

## 4. Capabilities discovery

`GET /sub-oss/capabilities` returns a JSON document the client uses
to pre-validate uploads and to know how to fetch bytes:

```jsonc
{
  "version": 2,
  "host": "https://files.example.com",
  "path_base": "/sub-oss",
  "backend": "s3",
  "key_strategy": "cas",
  "max_file_size": 33554432,
  "max_files_per_message": 9,
  "signed_url": false,
  "upload_endpoint": "/sub-oss/upload",
  "file_endpoint": "/sub-oss/file",
  "meta_endpoint": "/sub-oss/meta",
  "presigned_upload": true,
  "presigned_threshold": 8388608,
  "presigned_endpoints": {
    "presign":  "/sub-oss/presign-upload",
    "complete": "/sub-oss/upload-complete"
  }
}
```

`version: 2` introduces the presigned upload fields; older clients
that only check `version >= 1` keep working because they ignore
unknown fields. Stations whose active backend does not implement
`PresignedBackend` simply omit the `presigned_*` block — the client
treats that as "fall through to multipart".

Clients cache this in process-memory keyed by origin (no disk
persistence — the document is small, refreshes cheaply, and operator
config rotations should take effect immediately on next launch).

`version` is bumped on any breaking field change so clients can
fail loudly rather than silently misinterpret a new shape.

The endpoint is **public on purpose** — the response carries no
secrets and clients need to be able to query it before they have a
JWT (e.g. on first login, or when probing a peer station for
federation).

## 5. Configuration surface

YAML keys (`peers.node.server.subserver.oss.*`):

| Key                          | Default            | Purpose                                              |
| ---------------------------- | ------------------ | ---------------------------------------------------- |
| `enabled`                    | `false`            | Toggle the entire subserver.                          |
| `path`                       | `/sub-oss`         | Base path, mounted under the station's HTTP server.  |
| `rds-name`                   | (depends)          | GORM data source name for the file metadata table.   |
| `store-path`                 | `<datadir>/oss`    | Filesystem root for the `local` backend.             |
| `sign-secret`                | `""`               | HMAC secret for signed URLs. Empty disables signing. |
| `host-override`              | `""`               | Public origin to advertise / embed in `cid` URIs.    |
| `max-file-size`              | `33554432` (32 MiB)| Per-file upload cap, in bytes.                        |
| `max-files-per-message`      | `9`                | Advisory client-side limit.                           |
| `backend`                    | `local`            | Storage driver: `local` or `s3`.                      |
| `key-strategy`               | `random`           | `random` (legacy date+rand) or `cas` (sha256 dedup).  |
| `presigned-upload-threshold` | `8388608` (8 MiB)  | Bytes ≥ threshold route through presigned PUT.        |
| `presigned-upload-ttl`       | `300` (s)          | Validity window of presigned PUT URLs.                |
| `presigned-download-ttl`     | `300` (s)          | Validity window of `/file` 302 GET URLs.              |
| `s3.endpoint`                | (required if `s3`) | Host:port of the S3-protocol endpoint.                |
| `s3.region`                  | `""`               | Region label sent to the bucket (driver-specific).    |
| `s3.bucket`                  | (required if `s3`) | Bucket name. Single bucket per Station.               |
| `s3.access-key-id`           | (required if `s3`) | IAM-style access key.                                 |
| `s3.secret-access-key`       | (required if `s3`) | Secret key. Read from env, never check in to git.     |
| `s3.use-ssl`                 | `false`            | Toggle TLS. Honors explicit `https://` in endpoint.   |
| `s3.force-path-style`        | `false`            | `true` for non-AWS (MinIO, R2, B2, …).                |
| `s3.key-prefix`              | `""`               | Prepended to every object key (multi-tenant bucket).  |

For independent deployment (OSS in its own process), the operator:

1. Runs a station process with **only** the `oss` subserver enabled.
2. Sets `host-override` to the public URL of *that* process.
3. Shares the JWT secret with the chat-serving station so the chat
   station's tokens are accepted by OSS.

The chat station's clients still upload to whichever station their
JWT is bound to; the indirection only matters when a *different*
station fetches an attachment via `oss://other-host/key`.

## 6. Backends — pluggable storage drivers

The file plane is built around two interfaces and a factory:

```
                ┌─────────────────────────────────────────────────┐
                │  storage.Backend                                │
                │   - Save(ctx, key, r) (string, error)           │
                │   - Open(ctx, key)  (io.ReadCloser, …)          │
                │   - Delete(ctx, key) error                      │
                └────────────────┬───────────────┬────────────────┘
                                 │ implements    │ implements
                                 ▼               ▼
            ┌──────────────────────────┐ ┌──────────────────────────┐
            │  LocalBackend            │ │  S3Backend (minio-go)    │
            │   filesystem at root     │ │   any S3-protocol store  │
            └──────────────────────────┘ │  also implements:        │
                                         │  storage.PresignedBackend│
                                         │   - PresignPut           │
                                         │   - PresignGet           │
                                         │   - HeadObject           │
                                         └──────────────────────────┘
```

Three architectural decisions shape this layout:

1. **Minimal core interface.** `Backend` is the smallest contract a
   storage driver must satisfy. Adding S3 did not require touching
   the interface — just a new file (`s3.go`) that satisfies it.

2. **Capabilities as opt-in interfaces.** `PresignedBackend` is a
   *separate* interface a driver implements only when it can issue
   pre-signed URLs natively. Callers feature-detect:
   `if pb, ok := b.(storage.PresignedBackend); ok { … }`. This means
   the OSS subserver runs against any future driver (a hypothetical
   `IPFSBackend`, an in-cluster proxy, …) without growing a
   monolithic `Backend` interface that every driver has to fake.

3. **Single active backend per Station.** The factory picks one
   driver at process start based on `backend: local | s3`. We
   considered keeping multiple drivers live for "old `local` rows
   stay readable after switching to `s3`" — this round we explicitly
   drop that requirement (operator's call: don't switch backends
   mid-life unless you have an external migration strategy). The
   `FileMeta.Backend` column is still populated faithfully so a
   future migration tool has the provenance it needs.

### 6.1 Drivers

#### `LocalBackend` — the home default

Stores bytes under `store-path/<key>` on the host filesystem. Zero
external dependencies, zero credentials, no per-request signing. It
is the right backend for the home-deployment story spelled out in
§1: a NAS or mini-PC with one process and one disk.

#### `S3Backend` — any S3-protocol store

Implements `Backend` + `PresignedBackend` over `minio-go/v7`. The
"S3" here refers to the **protocol**, not the vendor: anything that
speaks the protocol works.

- AWS S3 — `force-path-style: false`.
- MinIO (self-hosted) — `force-path-style: true`. Aligns naturally
  with the home-decentralization story: a household can run MinIO
  on the same NAS that hosts the Station.
- Cloudflare R2 / Backblaze B2 / GCS S3-compat / Alibaba/Tencent OSS
  S3-compat — `force-path-style: true`, point `endpoint` at the
  vendor's S3-compat host.

Constructor performs *no* network I/O. Misconfigured credentials
surface at the first request, not at process startup, so an OSS
problem cannot block unrelated subservers from starting.

### 6.2 Presigned upload — direct PUT data path

For files at or above `presigned-upload-threshold` (default 8 MiB),
the desktop client bypasses the multipart `/upload` endpoint and PUTs
bytes directly to the underlying storage backend. The Station only
participates by signing URLs and registering metadata afterwards —
its bandwidth cost is `O(1)` per upload regardless of file size.

```
desktop                         station                       S3-bucket
  │                                │                              │
  │── POST /presign-upload ───────▶│                              │
  │   {filename,mime,size,sha256}  │                              │
  │                                │  (CAS dedup hit?)            │
  │                                │  → row exists → return meta  │
  │                                │                              │
  │◀── {url, headers, max_bytes} ──│                              │
  │                                │                              │
  │── PUT {url} (file body) ─────────────────────────────────────▶│
  │   x-amz-checksum-sha256: …     │                              │
  │   Content-Type: …              │                              │
  │◀──────── 200 OK ──────────────────────────────────────────────│
  │                                │                              │
  │── POST /upload-complete ──────▶│                              │
  │   {key, size, sha256, …}       │  HeadObject(key) → validate  │
  │                                │  Create FileMeta             │
  │◀── {cid, host, key, sha256} ───│                              │
```

Properties this gives us, in priority order:

- **Bandwidth offload.** For S3-protocol backends the station never
  sees the bytes. A 100 MB upload costs the station ≈ 1 KB of HTTP
  in / out instead of 100 MB of proxy traffic.

- **End-to-end integrity (CAS).** When `key-strategy: cas`, the
  client must declare the SHA-256 up-front. The station binds it
  into the presigned URL via `x-amz-checksum-sha256` — the underlying
  store rejects the upload if the actual bytes hash to a different
  value. `/upload-complete` then `HeadObject`s the bucket and
  rejects size mismatches as a defense in depth.

- **CAS dedup short-circuit.** When the supplied SHA-256 already
  maps to a `FileMeta` row, `/presign-upload` returns the existing
  meta with `already_uploaded: true`. The client never PUTs. This
  is the core efficiency win that justifies CAS for chat: a popular
  meme uploaded by 50 users transfers bytes only once.

- **Graceful degradation.** When the active backend does not
  implement `PresignedBackend`, the capabilities response omits
  `presigned_*` fields and the client uses multipart for everything.
  When it does, but the presign step fails (network blip, signature
  drift), the client logs and falls back to multipart — the user's
  upload always completes.

The download path is symmetric: when the active backend supports
`PresignGet`, `/sub-oss/file` issues an `HTTP 302` to a short-lived
presigned GET URL. Renderers follow redirects transparently, so the
existing `oss_resolve_url` consumers need no change.

### 6.3 Backend selection at the client

`capabilities.backend` and `capabilities.presigned_upload` together
decide what the desktop client does:

| `backend` | `signed_url` | `presigned_upload` | Upload path                  | Resolve path                      |
| --------- | ------------ | ------------------ | ---------------------------- | --------------------------------- |
| `local`   | false        | false              | multipart (always)           | mirror to `cache/files/oss/…`     |
| `local`   | true         | false              | multipart                    | absolute URL (no mirror)          |
| `s3`      | false        | true               | presigned (≥ threshold)      | absolute URL → station 302 → S3   |

For S3-protocol backends the desktop client **does not mirror to
disk**: S3 itself is the distributed cache, the station's 302
gives the renderer direct access, and a second on-disk copy would
just waste bandwidth.

### 6.4 Switching backends — non-goal

Switching `backend: local` → `backend: s3` (or vice versa) is **not**
a supported live migration. After the switch, old `FileMeta` rows
whose bytes physically live on the previous backend become
unreachable through `/file`. Operators who care about historic
attachments should plan one of:

- Keep the old backend's bytes around (e.g. mount the old `store-path`
  read-only) and accept that `/file` returns 404 for those keys, or
- Run a one-shot migration tool (out of scope for this round) that
  reads old rows via the old backend and writes them through the new
  one, updating `FileMeta.Backend` accordingly.

We chose this trade-off deliberately: a Station with no users yet
has nothing to migrate, and a Station with users should not be
silently re-keying their data without an explicit migration step.

## 7. Management plane

OSS metadata, quota, audit, and operator read paths sit in GORM tables
under the configured `rds-name`. **Bootstrap** runs `AutoMigrate` and
writes `schema_version = v2` into `oss_meta`. It does not enumerate
actors, pre-create per-actor rows, or import prior data — a deliberate
greenfield cut so the subserver never carries one-off compatibility
branches for abandoned shapes.

### Logical buckets

Buckets are **logical** groupings: they define quota, default
visibility for new objects, operator UX, and dashboard filters; they
are not separate physical roots for the active `LocalBackend`.

- **System** buckets (`avatar`, `chat`, `personal`) are defined in
  code, cannot be deleted, and are **ensured lazily on first use for
  each actor** so startup never walks the actor universe or couples OSS
  to friend_chat schema. Quota is checked and `used_bytes` updated
  atomically on upload; exceeding `quota_bytes` fails the request
  before storage writes complete.
- **`user` / `applet`** buckets are operator-managed (applets share the
  same machinery today; the kind exists to reserve a future
  namespace). Operators create and name them; empty user buckets can
  be removed.

Each bucket record carries `default_visibility`, `quota_bytes`,
`used_bytes`, and `ttl_days`. TTL is stored so policy is visible
upfront; enforcement is expected to follow in a later lifecycle pass,
not at read time in this round.

### `oss_audit`

The audit stream is **append-only** (by-value `file_key` / `bucket_id`
/ `actor_id` so rows survive object deletion). Each row has `action`
(`upload`, `get`, `delete`, `presign_put`, `presign_get`,
`admin_delete`), `outcome` (`ok`, `denied`, `not_found`, `error`), an
optional stable `reason` for denials, timestamps, and optional
`peer_station_id` for federation-originated traffic. A time-based
`Trim` prunes old rows; the intended window lives with OSS
configuration (see struct comments in `oss_audit` / repository code)
so operators are not left with an unbounded table.

### Dashboard admin API (read + pin/unpin)

All routes use the **dashboard** JWT (same `authWrapper` as the rest
of the admin surface). The API is **read-only** for OSS data except
federation trust actions:

- `GET /dashboard/api/oss/buckets` — list bucket rows.
- `GET /dashboard/api/oss/buckets/:id` — one bucket.
- `GET /dashboard/api/oss/buckets/:id/objects` — objects in that bucket
  (filters: `owner_actor_id`, `visibility`, `mime`, `page`,
  `page_size`).
- `GET /dashboard/api/oss/objects` — global object listing (filters:
  `bucket_id`, `owner_actor_id`, `visibility`, `mime`, `page`,
  `page_size`).
- `GET /dashboard/api/oss/audit` — audit log (filters: `action`,
  `actor_id`, `bucket_id`, `file_key`, `outcome`, `since`, `until`,
  `page`, `page_size`).
- `GET /dashboard/api/oss/usage` — aggregate totals, top owners, and
  visibility mix.
- `GET /dashboard/api/oss/federation/me` — this station's Ed25519
  **public** key material and `kid` (private key never leaves the
  process).
- `GET /dashboard/api/oss/federation/peers` — known remote stations from
  `oss_peer_keys`.
- `POST /dashboard/api/oss/federation/peers/:id/pin` and
  `.../unpin` — mark a TOFU row as operator-trusted (pin) or allow
  rotation again (unpin); these emit `oss_pin_peer` / `oss_unpin_peer`
  in `dashboard_audit_logs`, not in `oss_audit`.

## 8. Permission model

### Visibility on `oss_files`

Every object row has `visibility ∈ {public, chat, private}` and, when
`visibility = chat`, a non-empty `chat_session_id` (friend_chat session
ULID) describing the session audience. Defaults come from the bucket
when the upload omits an override.

### Read-time enforcement on `GET /sub-oss/file`

Policy is evaluated in the OSS handler after authentication (if any) and
before streaming bytes. Intuition:

- **`public`**: no identity requirement for the visibility decision
  (operator `sign_secret` HMAC, if enabled, is still a separate gate).
- **`private`**: the authenticated subject must match `OwnerActorID`.
- **`chat`**: the subject must be the owner **or** a participant of
  `ChatSessionID` as determined by `ChatSessionResolver` (the owner
  short-circuit keeps owner reads working even if the resolver is
  mis-wired in dev).

Federated fetches from another station present a **peer** JWT; the
verifier maps `iss` / `aud` / `sub` and `oss_key` (see below) and
feeds the same `checkRead` path with the actor carried as the effective
subject so cross-station behavior matches local.

### Denials and `Reason`

Failed reads are logged to `oss_audit` with `outcome = denied` and a
**stable** `Reason` string (not returned to clients; responses stay a
generic 403/401). The closed set used by `checkRead` today includes:
`not_owner`, `not_in_session`, `subject_required` (unauthenticated
caller where identity is required), `session_missing` (chat
visibility without a session id on the row), `resolver_error`,
`resolver_missing` (no resolver for a chat file), and
`unknown_visibility`. Matching on these strings is how operators and
dashboards distinguish a broken resolver from a true policy denial.

`ChatSessionResolver` is an interface with one question: is this actor
a participant of this session? The default implementation queries
`friend_chat_sessions` through the same store layer friend_chat uses,
without importing friend_chat (avoids dependency cycles and keeps tests
able to stub the answer). A future deployment could swap the resolver
for a remote call; the OSS subserver does not embed SQL for chat
membership in the handler itself.

### Federation peer JWTs

Cross-station object reads that cannot use the user's normal HS256
window JWT use a **short-lived Ed25519** JWT: JOSE `typ=peer+jwt` (to
distinguish from user tokens), `alg=EdDSA`, `kid` and optional JWK
material, claims `iss` (issuing station), `aud` (receiving station),
`sub` (on-behalf-of actor), `oss_key` (single file key), and `exp` /
`iat` with TTL clamped to **at most 60 seconds** so replays and leaked
tokens stay bounded. The signing key is a **dedicated** Ed25519
keypair in `oss_meta`, generated lazily; it is **not** the station's
RSA-2048 node-identity key.

The receiver applies **TOFU** on first sight of a new `iss`: the JWK
is recorded in `oss_peer_keys`. Later tokens from that peer must match
the stored `kid` and PEM. **Pin** (via the dashboard) freezes trust:
rotation without re-pairing is rejected for pinned rows, which is why
the pin/unpin endpoints exist.

## 9. Data flow

### Upload (sender)

1. User clicks the paperclip → `pick_chat_attachment` opens the
   native file dialog → returns absolute path.
2. `chat_upload_attachment(path)` → station_client posts multipart to
   `/sub-oss/upload` with the window's JWT.
3. Server saves bytes via `LocalBackend.Save`, persists `FileMeta`,
   computes `cid = oss://{resolveOrigin(r)}/{key}`, returns
   `{cid, key, host, mime, size, filename, url, backend}`.
4. Client embeds the `cid` (and `mime`/`filename`/`size`) in
   `MessageAttachment` and calls `sendFriendMessage` /
   `sendGroupMessage` exactly as for text. The chat layer is
   attachment-agnostic.

### Render (receiver, eventually any peer)

1. `AttachmentItem` receives the `MessageAttachment` proto on
   render. `useAttachmentUrl(cid)` is called.
2. The hook hits its module-level cache; on miss it calls
   `oss_resolve_url(cid)`.
3. `application::oss::oss_resolve_url`:
   a. parses the URI,
   b. ensures capabilities for the URI's origin,
   c. for unsigned backends, mirrors the bytes to
      `cache/files/oss/<origin>/<key>` and returns the local path,
   d. for signed backends, returns the absolute URL only.
4. The hook prefers `local_path` (Tauri's `convertFileSrc` serves it
   without a network round-trip) and falls back to `url` when local
   mirroring failed or was skipped.

## 8. Key strategies

The server-side function `service.FileService.SaveFile` selects the
storage key via a configurable strategy:

| Strategy   | Key shape                            | Dedup | Sha256 in meta |
| ---------- | ------------------------------------ | ----- | -------------- |
| `random`   | `YYYY/MM/DD/<rand16><ext>`           | no    | empty          |
| `cas`      | `cas/<sha256[0:2]>/<sha256><ext>`    | yes   | populated      |

The strategy is per-Station and fixed for the lifetime of the
process. Switching live would create unbounded fan-out of equivalent
metas pointing at the same bytes. Operators set it via
`peers.node.server.subserver.oss.key-strategy: cas` in YAML; clients
read it from `capabilities.key_strategy`.

### CAS contract

When `key-strategy: cas` is active:

1. The server hashes the incoming multipart body (`sha256`) before
   touching disk.
2. Key is derived deterministically: `cas/<2-char shard>/<full
   hash><ext>`. The shard prefix keeps any single directory bounded
   as the dataset grows.
3. If a `FileMeta` row already exists at that key, the server skips
   the second `backend.Save` and returns the *existing* meta. This
   means the original filename wins — when Alice uploads
   `report.pdf`, then Bob uploads the *same bytes* under the name
   `RENAMED.pdf`, Bob's response carries `filename: report.pdf`.
   Older messages are never retroactively renamed.
4. Concurrent uploads of identical bytes are reconciled by the
   unique-index on `oss_files.key` — the loser of `Create` falls
   back to `FindByKey` and returns the winner's meta.
5. Upload response includes `sha256` so the client can persist it on
   `MessageAttachment` for end-to-end integrity verification once
   federated fetches land.

`random` remains the default for backward compatibility — Stations
upgraded mid-flight keep working without operator action, and legacy
metas (without `Sha256`) coexist with new CAS metas in the same
table.

## 9. Local attachment cache & GC

The desktop client mirrors fetched attachment bytes under
`cache/files/oss/<sanitized-origin>/<key>`. Without GC the cache
grows unboundedly — a chatty user can accumulate gigabytes over
weeks. We address this with an explicit `oss_cache::gc(max_bytes)`
function that:

1. Walks the attachment dir and collects `(path, size, mtime)` per
   file.
2. Sums total bytes; if already under budget, returns
   `GcReport { evicted: 0, ... }` without further work.
3. Sorts by `mtime` ascending and deletes the oldest files until
   total bytes fit under the budget.
4. Best-effort prunes empty directories left behind.

The trigger is the **Online → Offline** edge in
`PresenceSupervisor::run_offline`. This is precisely the moment the
user is no longer actively browsing chats — a few hundred ms of
`fs::remove_file` calls is invisible. Importantly:

- `AppShutdown` triggers **skip** GC. The user is exiting; spending
  budget on disk reclamation is rude. Next launch's first
  Offline→Online transition will GC instead.
- The default budget is `256 MiB`, overridable via the
  `OSS_CACHE_BUDGET_BYTES` environment variable. (Future: capability
  fields and per-actor settings.)
- mtime is approximate-LRU. We deliberately do not maintain an
  access-time sidecar — the cost-benefit of crash-safety + zero
  deps outweighs the imprecision.

## 10. Lifecycle integration: Presence + Shutdown

The shutdown path is symmetric to AppLaunch:

1. Frontend `usePresence` already fires `AppLaunch` on mount.
2. Tauri `RunEvent::ExitRequested` (wired in `main.rs`) iterates
   `WindowSessionRegistry::snapshot_all()` and dispatches
   `PresenceTrigger::AppShutdown` for each bound `(actor, jwt)`.
3. The supervisor runs `run_offline` for each, which calls
   Station's `/offline` and skips the GC pass.
4. The main thread polls `JoinHandle::is_finished()` with a
   3-second budget so a wedged Station cannot prevent process exit.

This guarantees Station sees an explicit Offline transition rather
than waiting for TCP keepalive expiry — which matters for the
"deliver pending on next online" semantics: the next AppLaunch's
`/online` POST is what triggers the pending drain.

## 11. Invariants

- `MessageAttachment.cid` is always either a valid `oss://...` URI
  or empty. The send path should emit the full URI; parsers may still
  accept a bare `key` so local resolution can proceed when the string
  lacks an `oss://` prefix.
- The capabilities cache is keyed by both the origin we *queried*
  and the origin the server *advertised*. This makes
  `oss://probe-host/key` and `oss://canonical-host/key` resolve to
  the same entry once the server reports its canonical host.
- On the **station**, metadata uniqueness is `(owner_actor_id, key)`.
  Identical content can share one physical blob and `key` while
  visibility, quota, and ownership stay independent per uploader.
- The client **on-disk** attachment cache buckets by sanitized
  origin. Two different `oss://` origins and the same `key` path
  segment do not clobber one another in cache layout.
- Local cache misses never break rendering. `oss_resolve_url`
  always returns at least an absolute URL when the URI is valid; the
  renderer can always fall back to network fetch.
- CAS metas are append-only. `service.SaveFile` never mutates an
  existing `FileMeta` — duplicates short-circuit before reaching
  the `Create` path. This means metadata about a CAS object
  (filename, mime, size) reflects the *first* uploader and is
  invariant under subsequent re-uploads.
- Shutdown is bounded. `RunEvent::ExitRequested` waits at most 3s
  for Offline reconciles to complete; the process exits even if
  Station is unreachable.

## 12. Open work / future extensions

- **Cross-backend migration tool.** A one-shot binary that walks
  `oss_files` rows whose `backend` does not match the configured
  driver, copies the bytes through the new driver, and updates
  `FileMeta`. The current architecture supports this — the table
  records provenance — but the tool itself is out of scope.
- **Capability-driven GC budget**: `capabilities.suggested_cache_bytes`
  could replace the fixed 256 MiB / env-var pair.
- **CAS reference counting**: today metas are forever. A
  reference-count column on `oss_files` (incremented when a
  `MessageAttachment` is sent, decremented on message delete) would
  let the operator garbage-collect dereferenced objects. Requires a
  separate message-lifecycle design pass; deferred.
- **Multi-region / multi-bucket S3.** Today `S3Config` is single-
  bucket. A future iteration could pick a bucket per actor or per
  household to isolate quotas and access policies.
- **End-to-end encryption**: orthogonal — the encryption layer
  wraps `MessageAttachment.cid` like it wraps text content. CAS is
  meaningful only over plaintext bytes; if the client encrypts
  per-message, two senders of the same plaintext produce different
  ciphertexts and dedup degrades to "same key only when same
  recipient and same message". This is a deliberate trade-off,
  noted here so the decision is not relitigated.

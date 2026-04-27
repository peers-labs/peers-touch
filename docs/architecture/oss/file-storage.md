# Chat File Storage & OSS Subserver

> Status: Draft, 2026-04-27
>
> Scope: Friend chat + group chat attachments (image, document, audio,
> video). Avatar / profile-image upload retains its existing path
> (`profile_upload_avatar_oss` → `/sub-oss/upload`) but now benefits
> from the same federated `cid` URI as a side effect.

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
  "version": 1,
  "host": "https://files.example.com",
  "path_base": "/sub-oss",
  "backend": "local",
  "max_file_size": 33554432,
  "max_files_per_message": 9,
  "signed_url": false,
  "upload_endpoint": "/sub-oss/upload",
  "file_endpoint": "/sub-oss/file",
  "meta_endpoint": "/sub-oss/meta"
}
```

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

| Key                       | Default            | Purpose                                              |
| ------------------------- | ------------------ | ---------------------------------------------------- |
| `enabled`                 | `false`            | Toggle the entire subserver.                          |
| `path`                    | `/sub-oss`         | Base path, mounted under the station's HTTP server.  |
| `rds-name`                | (depends)          | GORM data source name for the file metadata table.   |
| `store-path`              | `<datadir>/oss`    | Filesystem root for the local backend.               |
| `sign-secret`             | `""`               | HMAC secret for signed URLs. Empty disables signing. |
| `host-override`           | `""`               | Public origin to advertise / embed in `cid` URIs.    |
| `max-file-size`           | `33554432` (32 MiB)| Per-file upload cap, in bytes.                        |
| `max-files-per-message`   | `9`                | Advisory client-side limit.                           |
| `backend`                 | `local`            | Storage driver; reserved for `s3`, `proxy`, …         |

For independent deployment (OSS in its own process), the operator:

1. Runs a station process with **only** the `oss` subserver enabled.
2. Sets `host-override` to the public URL of *that* process.
3. Shares the JWT secret with the chat-serving station so the chat
   station's tokens are accepted by OSS.

The chat station's clients still upload to whichever station their
JWT is bound to; the indirection only matters when a *different*
station fetches an attachment via `oss://other-host/key`.

## 6. Backends and signing

Today only `LocalBackend` is implemented. Future drivers (S3,
proxying to another station) plug in via the existing
`storage.Backend` interface — `Save`, `Open`, `Delete`. The active
driver is surfaced through `capabilities.backend` so the client can:

- Show the user that uploads land in a local NAS vs. a public bucket.
- Decide whether to attempt local mirroring (only meaningful for
  `local` and `proxy` — for `s3` the renderer talks to S3 directly).

`signed_url == true` flips the resolver into a "do not mirror" mode:
the client returns the absolute URL untouched and lets the renderer
make the network request, because the signature is short-lived and
caching the bytes provides little value.

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

## 10. Invariants

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

## 11. Open work / future extensions

- **S3Backend** behind `Backend` interface; `capabilities.backend =
  "s3"` skips local mirroring on the client.
- **Presigned upload** for very large files (operator-controlled
  via a future `presigned_upload: true` capability flag).
- **Bucket / attachment lifecycle**: `ttl_days` and client cache
  growth still want explicit GC or LRU policies; nothing here is
  automatic on the server beyond audit trimming.
- **Attachment GC**: the local cache grows unbounded. A simple LRU
  pruner triggered from `presence.transition` (Online → Offline)
  is a reasonable next step.
- **End-to-end encryption**: orthogonal — the encryption layer
  wraps `MessageAttachment.cid` like it wraps text content. The
  bytes on disk are still ciphertext.

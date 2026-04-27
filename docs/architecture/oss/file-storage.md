# Chat File Storage & OSS Subserver

> Status: Draft, 2026-04-26
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
make it work, and the upgrade story for clients that pre-date the new
URI scheme.

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
- `key` is the storage backend's object key. Today it is
  `YYYY/MM/DD/<rand>.<ext>`, but consumers must not rely on that
  shape.

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
- `2026/04/26/abc.png` — bare key, used when receiving from a legacy
  Station that does not yet emit `cid`. The parser pins it to the
  caller's bound station via `station_client::station_base_url`.

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

`version` is bumped on any breaking field change so older clients can
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
| `key-strategy`            | `random`           | `random` (legacy date+rand) or `cas` (sha256 dedup).  |

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

## 7. Data flow

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
  or empty. Bare keys are accepted on input for backward
  compatibility but the chat send path emits the URI form.
- The capabilities cache is keyed by both the origin we *queried*
  and the origin the server *advertised*. This makes
  `oss://probe-host/key` and `oss://canonical-host/key` resolve to
  the same entry once the server reports its canonical host.
- The on-disk attachment cache buckets by sanitized origin. Two
  stations holding the same `key` never collide.
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

- **S3Backend** behind `Backend` interface; `capabilities.backend =
  "s3"` skips local mirroring on the client.
- **Presigned upload** for very large files (operator-controlled
  via a future `presigned_upload: true` capability flag) — most
  meaningful once S3Backend lands.
- **Capability-driven GC budget**: `capabilities.suggested_cache_bytes`
  could replace the fixed 256 MiB / env-var pair.
- **CAS reference counting**: today metas are forever. A
  reference-count column on `oss_files` (incremented when a
  `MessageAttachment` is sent, decremented on message delete) would
  let the operator garbage-collect dereferenced objects.
- **End-to-end encryption**: orthogonal — the encryption layer
  wraps `MessageAttachment.cid` like it wraps text content. CAS is
  meaningful only over plaintext bytes; if the client encrypts
  per-message, two senders of the same plaintext produce different
  ciphertexts and dedup degrades to "same key only when same
  recipient and same message". This is a deliberate trade-off,
  noted here so the decision is not relitigated.

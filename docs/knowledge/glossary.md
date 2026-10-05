# Project Glossary

> Status: Canonical. Owner: Architecture.
> Audience: anyone reading or modifying this codebase, AI included.
> Updated: 2026-05-19

Domain terms specific to peers-touch. Standard CS terminology (DHT, mutex, RAG, PR, etc.) is NOT included; assume the reader has it.

When introducing a new domain term in code, comments, or PRs, add it here in the same change.

---

## Federation

**`federated_handle`**
The user-facing identifier for an actor across the federation, formatted `user@host`. Stored on `touch_actor.federated_handle` (canonical lower-case). The leading `@` is optional in display contexts; canonical form omits it. Example: `alice@station-1.peers.touch`.

**`home_station`**
The single station that owns the authoritative `touch_actor` row and the private signing key for a given federated handle. Every handle has exactly one home station; cached envelopes on other stations are read-only projections. Identified by `home_station_peer_id` (libp2p PeerID) and `home_station_domain` (DNS host).

**`home_station_peer_id`**
The libp2p PeerID of the home station. Used as the trust anchor in Tier C1 invalidation events: the relay stamps `origin_peer_id` from the authenticated stream, and receivers cross-check against `cached.HomeStationPeerID` before applying an event.

**`locator_seq`**
Monotonically increasing 64-bit counter on `touch_actor.locator_seq`. Bumped atomically before every successful DHT publish or tombstone. Receivers use it to gate Tier C1 invalidation events (`event.locator_seq >= cached.locator_seq`) and to detect envelope staleness via the slow path.

**`ActorLocatorRecord`**
The signed protobuf record stored in the libp2p DHT under the `/peers-touch/locator/v1/<handle>` key. Carries `home_station_peer_id`, `home_station_domain`, `inbox_relay_mounts`, `locator_seq`, and a signature over the canonical bytes. The DHT only stores this record — never envelope contents.

**`ActorProfileEnvelope`**
The full federated profile representation (display name, avatar, region, links, …). Served live by the home station's `/actor/federation/profile` endpoint, signed with the home station's actor key, and cached on requesting stations under TTL. NEVER stored in the DHT — it is fetched on demand.

**`inbox_relay_mounts`**
Repeated `string` field on `ActorLocatorRecord` listing the relay base URLs through which the home station can be reached. Today populated with the local relay's `BaseURL` only; the field exists to support multi-relay traversal in a future tier without proto changes.

**`origin` (actor row)**
A short string column on `touch_actor.origin` distinguishing `local` (the home station owns this row) from `remote_cached` (a projection of someone else's actor pulled in by the resolver). Local rows produce DHT writes; remote-cached rows never do.

**`visibility`**
The actor's federation discoverability state. Values, in increasing order of exposure:
- `VISIBILITY_UNSPECIFIED` (0) — treated as HIDDEN.
- `VISIBILITY_HIDDEN` — no DHT record; tombstoned if previously published.
- `VISIBILITY_BY_HANDLE` — DHT record exists; resolvable when the handle is known. NOT discoverable via catalog (Tier C2).
- `VISIBILITY_INDEXED` — opt-in to catalog-level discovery (Tier C2).

---

## Push-style invalidation (Tier C1)

**Topic `fed.invalidate.v1`**
The single relay broadcast topic carrying `FederationInvalidation` proto messages. Allow-listed at relay startup via `StreamManager.SetAllowedBroadcastTopics`; any other topic is dropped with a warn log.

**`FederationInvalidation`**
Proto message at `model/domain/federation/invalidation.proto`. Carries the federated handle, locator seq at publish time, a `Reason` enum, and `origin_peer_id` (relay-stamped — clients NEVER set it). See pitfall `c1-tombstone-only-broadcast.md` for the trust-gate logic on receipt.

**`Reason` (enum)**
- `REASON_UNSPECIFIED` (0) — never published deliberately.
- `REASON_VISIBILITY_FLIP` (1) — locator record was re-published with a fresh seq; envelope content or visibility may have changed. Receivers evict and refetch on demand.
- `REASON_TOMBSTONE` (2) — locator record was tombstoned. Receivers evict; refetch will fail until / unless the handle is re-published.

**Trust gate**
Three sequential checks the receiver applies before evicting:
1. Cache miss → drop (we don't cache the handle, nothing to invalidate).
2. `event.origin_peer_id != cached.home_station_peer_id` → drop (only the home station may evict its own handle).
3. `event.locator_seq < cached.locator_seq` → drop (stale replay or buggy publisher).

---

## Relay protocol

**Frame**
A length-prefixed binary message on the relay-station TCP stream. Five types: `TypeRequest` (0x01), `TypeResponse` (0x02), `TypePing` (0x03), `TypePong` (0x04), `TypeBroadcast` (0x05). Defined in `apps/station/frame/core/plugin/native/subserver/relay/protocol/frame.go`.

**`StreamManager`**
Relay-side registry of all active station streams. Owns the topic allow-list, the per-stream readLoop, and the broadcast fan-out. The single piece of relay state with project-wide invariants — see `invariants/relay-readloop-discipline.md`.

**`writeMu` (per-stream)**
The mutex serializing writes to a single TCP stream. Held by request forwards (potentially seconds), pong replies (microseconds), and broadcast deliveries. The lock is local to one `streamEntry`; never crossed between entries.

**Origin stamping**
The act of overwriting any `origin_peer_id` field the publisher claimed with the relay's authenticated peer ID for that stream, before fan-out. The relay is the trust anchor for this field; the publisher's claim is always discarded.

---

## Process identity

**`peer_id` (libp2p PeerID)**
The cryptographic identity of a node on the libp2p network. Derived from the node's public key. Used as `home_station_peer_id` for federation trust and as the keying material for relay stream authentication.

**`PTID`**
Federation-stable opaque identifier for an actor (`peers.identity.PTID`). Independent of `federated_handle` (which can change as a user migrates home stations). PTIDs are the long-term identity; handles are the address.

**`acct`**
ActivityPub-compatible string form of an actor address — `user@host` without a leading `@`. Equal to `federated_handle` in most current code paths; kept distinct as a name to preserve the option of diverging if AP compatibility ever drifts.

---

## Storage / runtime

**`touch_actor`**
The PostgreSQL table that holds every actor known to this station, both `local` and `remote_cached`. The single source of truth for federation state. Generated from `model/domain/identity/actor.proto` via the proto-first toolchain.

**`fedcache`**
Package `apps/station/frame/touch/federation/cache/`. Manages cached `ActorProfileEnvelope` rows for `origin=remote_cached` actors. Exposes `Lookup`, `Cache`, `Evict`, `ErrCacheMiss`. Soft-deletes on `Evict` (sets `cached_until_unix_ms = 0` and `visibility = HIDDEN`); never touches `origin=local` rows.

**`republisher`**
Background goroutine in `apps/station/frame/touch/federation/republisher/` that periodically (default 30 min) re-publishes every local `INDEXED`/`BY_HANDLE` actor's locator record so DHT entries don't expire. MUST pass `actor.WithoutBroadcast()` to avoid relay traffic spam — see `pitfalls/republisher-broadcast-spam.md`.

---

## Tiered scope (this project's roadmap shorthand)

**Tier A**
Desktop client-side federation integration — runtime, ActorRef rendering, federation settings panel.

**Tier B**
Backend architecture cleanup — multi-relay proto reservations, KeyCache singleton, social graph proto extensions for `@user@host` rendering.

**Tier C**
Experience / scale — `C1` push-style invalidation (this knowledge layer's primary tenant), `C2` indexed catalog (designed in `docs/architecture/domains/identity/federation-catalog.md`, not yet implemented).

**Tier D**
Engineering governance — CI/CD hardening, station-level diagnostics, operational hygiene.

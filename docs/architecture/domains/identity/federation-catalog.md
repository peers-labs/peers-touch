# Federation Catalog

> Status: Implemented canonical architecture.
> Owner: Identity / Federation.
> Scope: privacy-preserving discovery of indexed actors across active Federation member Stations.

## 1. Product contract

The catalog answers "which actors match this handle prefix inside this Federation?" It does not replace exact-handle resolution.

- `HIDDEN`: absent from federation resolution and catalog.
- `BY_HANDLE`: resolvable only when the exact handle is known; never enumerable.
- `INDEXED`: eligible for catalog discovery after the actor opts in.

The global actor visibility is a cap. A Federation-scoped `INDEXED` choice cannot make an actor discoverable when global visibility is `BY_HANDLE` or `HIDDEN`. Disabling global discovery preserves scoped choices so they can become effective again if the global cap is later raised.

The default remains `BY_HANDLE`.

## 2. Wire contract

Canonical messages live in:

- `model/domain/federation/federation_discovery.proto`
- `FederationCatalogSearchRequest`
- `FederationCatalogSearchResponse`
- `FederationCatalogEntry`
- `FederationCatalogSource`

The authenticated client route is registered through the Federation subserver. Inter-Station calls use the canonical Federation peer route:

```text
PeerRouteFederationCatalogSearch
```

Every peer call binds:

- Federation ID
- source Station peer ID
- target Station peer ID
- actor subject
- deterministic request SHA-256

The receiving Station verifies route scope and claims before invoking `SearchLocalFederationCatalog`. There is no JSON peer protocol and no parallel catalog transport.

## 3. Ownership and topology

Each Station owns only its local actor index. The requesting Station:

1. verifies that it is an active Federation member;
2. loads the active member Station projection;
3. queries its own local index directly;
4. calls every selected remote Station with `FederationRuntime.CallPeer`;
5. aggregates successful legs, deduplicates by PTID, sorts deterministically, and re-applies the page boundary.

The standard Federation circuit owns dialing, authentication, routing, and failure reporting. Catalog code must not broadcast relay frames, open raw libp2p streams, or invent a second request protocol.

One failed, disabled, rate-limited, or timed-out Station produces a per-source outcome and a partial response. It does not fail successful legs.

## 4. Local index

The local index is owned by `apps/station/frame/touch/actor/catalog_index.go`.

It is a sorted in-memory index over locally authoritative actors whose effective visibility is `INDEXED`. Keys are canonical lower-cased federated handles with PTID as the deterministic tie-breaker.

The implementation deliberately uses a sorted slice plus binary-search prefix bounds:

- deterministic ordering;
- bounded memory;
- simple full rebuild at Station boot;
- incremental upsert/remove from actor signup and profile mutations;
- keyset lookup by `(federated_handle, actor_ptid)`.

A trie is not required for the current scale and is not an architectural constraint. SQL wildcard scans are not part of the request path.

## 5. Pagination

Clients treat `page_token` as opaque.

The current token is a URL-safe base64 encoding of the last returned key:

```text
(federated_handle, actor_ptid)
```

The coordinator decodes and validates the token, each source applies the keyset boundary, and the originator emits a new token from the final aggregated page. Offset pagination is forbidden because concurrent actor changes would cause unstable pages.

## 6. Abuse controls

Environment-owned controls:

- `PEERS_FEDERATION_CATALOG_ENABLED`
- `PEERS_FEDERATION_CATALOG_QPS`
- `PEERS_FEDERATION_CATALOG_BURST`
- `PEERS_FEDERATION_CATALOG_FANOUT_TIMEOUT_MS`
- `PEERS_FEDERATION_CATALOG_MAX_PAGE_SIZE`
- `PEERS_FEDERATION_CATALOG_MAX_PREFIX_CHARS`

Two independent token-bucket scopes exist:

- authenticated client actor at the origin Station;
- authenticated source Station at a serving Station.

The kill switch is evaluated before index work. A disabled serving Station returns a structured `DISABLED` source outcome. A depleted peer bucket returns `RATE_LIMITED`. Remote deadlines return `TIMEOUT`.

Locale filtering is rejected until a canonical indexed locale field exists. Region-prefix filtering is supported by the local actor index. Unsupported filters must fail explicitly rather than silently broadening the query.

## 7. Response semantics

Catalog entries contain list-rendering identity only:

- actor PTID;
- federated handle;
- display name;
- avatar URL;
- home Station identity and display name;
- effective visibility marker.

Signing keys, tokens, profile envelopes, private contact policy, and relationship state are never returned.

Each source reports:

- Station peer ID and name;
- outcome;
- result count.

`partial=true` when any selected source is not `OK`. `local_directory_enabled` reports the local Station kill-switch state independently of remote outcomes.

## 8. Invariants

1. Only effective `INDEXED` actors enter the local index.
2. Both caller and target must be active members of the same Federation.
3. Remote calls use the standard Federation peer circuit and signed scope claims.
4. Actor and Station token buckets are separate.
5. Fan-out failure is represented per source and never erases successful results.
6. Results are deduplicated by PTID and sorted by canonical handle then PTID.
7. Pagination is keyset-based and opaque to clients.
8. Actor mutation hooks and Station boot rebuild are the only index write paths.
9. Exact-handle resolution remains the existing locator/profile path.

## 9. Verification

The implementation must retain focused proof for:

- local index add/update/remove and visibility filtering;
- cross-Station fan-out with bound route claims;
- partial response on unavailable and timed-out legs;
- Station kill switch;
- actor and peer rate limits;
- deterministic deduplication and keyset cursor;
- inactive-membership rejection;
- Desktop rendering of per-source outcomes and local directory-disabled state.

Relevant implementation:

- `apps/station/frame/touch/actor/catalog_index.go`
- `apps/station/app/subserver/federation/catalog.go`
- `apps/station/app/subserver/federation/peer_routes.go`
- `apps/station/frame/core/federation/routes.go`
- `apps/station/frame/core/federation/scope.go`
- `apps/desktop/src/components/settings/FederationTab.tsx`

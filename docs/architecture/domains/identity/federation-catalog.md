# Federation Catalog — Design

> Status: Draft (canonical, pre-implementation). Owner: Architecture.
> Scope: cross-station discovery of federated actors.
> Companion docs:
> - `docs/architecture/domains/identity/unified-actor-system.md` — actor identity model.
> - `apps/station/frame/touch/federation/locator/` — DHT-backed by-handle resolution (already implemented).
> - `apps/station/frame/touch/federation/cache/` — remote `ActorProfileEnvelope` cache (already implemented).

---

## 1. Purpose

Define how a user on station A discovers an actor on station B **without** knowing the exact federated handle.

The federation today only supports a strict by-handle path (`@alice@stationB` → DHT lookup). That path is the right primitive for "I already know who I want to talk to" but useless for "I want to find the alices in the federation". This document specifies the directory layer that fills that gap, and — crucially — the constraints under which it is allowed to exist on a privacy-respecting decentralized network.

The decisions here are upstream of any code. Section 7 enumerates what a future implementation MUST honour; everything else is rationale.

---

## 2. Non-goals

This document does **not** cover:

1. **Full-text search of post bodies** — that lives in `docs/architecture/domains/chat/message-search.md` and follows a different visibility / aggregation model. The catalog answers "who is in the federation", not "what was said".
2. **Cross-station relationship discovery** ("who follows alice?") — that requires a different consent model and is intentionally deferred.
3. **Search-engine indexability** of profile content from outside Peers-Touch — `robots.txt` semantics are owned by the HTTP layer, not by this catalog.
4. **A global registry** — there is no canonical "Peers-Touch directory". The catalog is intrinsically federated; no station is privileged.

---

## 3. Constraints inherited from upstream design

### 3.1 Visibility ladder (already in proto)

The `ActorVisibility` enum already encodes the consent model the catalog must respect:

| Value | Meaning | Discoverable by catalog? |
|------:|---------|:-----------------------:|
| `VISIBILITY_HIDDEN` | not federated at all; tombstoned in DHT | **NO** |
| `VISIBILITY_BY_HANDLE` | federated, but only resolvable when the handle is known | **NO** |
| `VISIBILITY_INDEXED` | federated and explicitly opt-in to discoverability | **YES** |

The catalog **MUST NOT** surface `VISIBILITY_BY_HANDLE` actors. That bucket exists precisely to mean "you can resolve me if you know my handle, but you cannot enumerate me". Conflating BY_HANDLE with INDEXED would be a privacy regression on existing user state.

### 3.2 Iron Laws

- **Proto-First** — every wire payload defined in `model/domain/federation/*.proto`. No JSON.
- **No Mocking** — front-end ↔ back-end contract is real all the way down.
- **No Secrets** — same as the rest of the platform; mentioned here because catalog responses MUST NOT include any token / signing material.

### 3.3 Operational reality

- The test bench has **one** relay and **3-4** stations (`.localenv §1`). Any design that requires a global gossip layer fails this constraint immediately.
- Federation today is mediated by a single relay per station (multi-relay is reserved future work; see `inbox_relay_mounts` proto field). The catalog must work in single-relay topology AND be able to scale to multi-relay without a rewrite.
- The DHT is `libp2p` Kademlia with a `/peers-touch/locator/v1/` namespace. Adding a second namespace is cheap; redesigning the resolver is not.

---

## 4. Decision space

The shape of the catalog is the answer to four orthogonal questions:

### Q1 — Where does the index live?

| Option | Pros | Cons |
|--------|------|------|
| **A. Per-station local index** of own INDEXED actors only; cross-station queries fan out at request time | Each station owns its own data; no global state to keep coherent; simplest mental model | Query cost scales O(N stations) per request; cold cross-station fan-out is slow on first query |
| B. DHT-backed second namespace (`/peers-touch/catalog/v1/<prefix>`) where each station publishes a per-prefix bloom filter | Lookup is O(log N) like by-handle | Doubles DHT write cost; bloom filter staleness is a new failure mode; complicates trust gating |
| C. Centralized aggregator station(s) | Cheapest queries | Re-introduces centralization; single-point-of-censorship; rejected on principle |

**Decision: A**, with caching to amortize the fan-out cost. Option B is a future optimization that can be layered on top without changing the public API; Option C is rejected as architecturally incompatible with Peers-Touch.

### Q2 — How does cross-station fan-out work?

A query on station A must reach every relevant station B without:
- Knowing B's address upfront (B isn't necessarily a known peer).
- Forcing every station to be online (offline B's queries should silently elide, not fail the whole result set).

**Decision**: fan-out goes through the **same relay channel** the existing federation uses. The relay already mounts every station's stream and already knows the peer list. The catalog adds a new request frame topic (`fed.catalog.search.v1`) that the relay multicasts to all mounted stations except the originator; each station replies with its own slice; the relay aggregates and returns.

This reuses Tier B's relay infrastructure, doesn't require a new transport, and naturally supports the multi-relay future via the same per-relay query / aggregation per-relay.

### Q3 — Trust & abuse model

The catalog endpoint is, by definition, a "list users who match prefix X" — a vector for both scraping and amplification.

Three layers of defence:

1. **Per-actor opt-in** — the visibility ladder already encodes this. Default = BY_HANDLE; INDEXED is a deliberate user choice in the federation settings panel.
2. **Per-station rate limit** — token bucket keyed by `(origin_peer_id, IP)`, with sane defaults (see §5). Operators can tighten via config.
3. **Per-station opt-out** — a station-wide flag (`peers.federation.catalog.serve = false`) returns `403 catalog_disabled` on every catalog request. A station that disables catalog still participates in by-handle resolution; the two are independent.

`origin_peer_id` is relay-stamped (same trust model as Tier C1 invalidation), so the rate limiter sees an authenticated identity and can't be bypassed by header forgery.

### Q4 — What does the response carry?

The catalog returns **`ActorRef` only**, not full `ActorProfileEnvelope`. Reasons:

- An `ActorRef` is small (~100 bytes) and aggregating 1000 of them across 4 stations costs ~400KB; envelopes would be ~10x.
- The caller decides which entries to hydrate — typical UI shows ~20 results, so envelope-fetching is on demand.
- Hydration uses the existing `federation.Resolve` path which is cached, signed, and trust-gated.
- The catalog endpoint cannot leak any field that's not already on `ActorRef` (handle, display name, avatar URL, region — all opt-in INDEXED data).

---

## 5. The endpoint

### 5.1 Wire shape (proto, single source of truth)

To be defined under `model/domain/federation/catalog.proto` at implementation time. The shape is:

```proto
syntax = "proto3";
package peers.touch.federation;

import "model/domain/identity/actor_ref.proto";

message FederationCatalogSearchRequest {
  // Lower-cased prefix. Empty == server's choice (typically "page-1 of all").
  // Server-side enforced max length 64 to bound work.
  string prefix          = 1;

  // Filters. All optional; AND-composed when present.
  string locale_prefix   = 2;  // BCP-47 prefix; e.g. "zh", "en-US"
  string region_prefix   = 3;  // ISO-3166-2 prefix; e.g. "CN", "US-CA"

  // Pagination. Cursor is opaque to the caller; the server treats it as
  // a black box keyed by the underlying index implementation.
  uint32 page_size       = 4;  // server clamps to [1, 50]
  string page_cursor     = 5;
}

message FederationCatalogSearchResponse {
  repeated peers.identity.ActorRef results = 1;
  string next_page_cursor                  = 2;  // empty == last page

  // Set when the server elided some local hits because they exceeded the
  // page_size budget; the caller should pass next_page_cursor to fetch more.
  bool has_more                            = 3;

  // Diagnostic: which station answered. Populated on per-station legs of
  // a fan-out so the aggregator can attribute slow stations.
  string responding_peer_id                = 4;
}
```

`ActorRef` carries handle + display name + avatar URL + ptid. Nothing else is needed for list rendering. If the caller wants more, they hit the existing federated profile endpoint.

### 5.2 Transport

- **HTTP entry point**: `GET /actor/federation/search?prefix=...&page_size=...&cursor=...`
- **Inter-station transport**: relay broadcast frame topic `fed.catalog.search.v1`, request body = `FederationCatalogSearchRequest` proto, responses returned via the existing relay request/response correlation (NOT broadcast — replies are unicast back to the origin).
- **Result aggregation** happens at the originating station: union → dedupe by `ptid` → re-paginate.

### 5.3 Local index

Each station maintains an in-memory trie keyed by **lower-cased federated handle prefix** restricted to `(visibility = INDEXED AND origin = local)` rows. Build options:

- **Cold start**: scan `touch_actor` once at boot, populate trie, then maintain incrementally on actor mutations.
- **Maintenance**: actor INSERT / UPDATE / DELETE → trie patch, gated by visibility flag (drop entry on flip away from INDEXED, add on flip TO INDEXED).
- **Memory ceiling**: 100k INDEXED actors × ~100B per trie node ≈ 10MB. Negligible.

The trie is the only allowed index format for v1. We deliberately do NOT use SQL `LIKE 'prefix%'` because it forces a full table scan on every search; the trie is O(prefix-length) per query.

---

## 6. Rate limit & abuse policy

| Knob | Default | Range | Rationale |
|------|--------:|-------|-----------|
| `peers.federation.catalog.qps_per_origin` | 10 | 1–500 | Token bucket, refilled per second, keyed by `origin_peer_id`. |
| `peers.federation.catalog.burst` | 30 | 1–500 | Bursts allowed for legitimate UI scrolls. |
| `peers.federation.catalog.qps_per_ip` | 5 | 1–500 | Secondary keying for unauthenticated public ingress (HTTP, not relay). |
| `peers.federation.catalog.max_page_size` | 50 | 1–200 | Hard ceiling; oversized requests are clamped silently. |
| `peers.federation.catalog.max_prefix_chars` | 64 | 1–256 | Bounds index walk cost. |
| `peers.federation.catalog.serve` | true | bool | Per-station kill-switch (returns `403 catalog_disabled`). |
| `peers.federation.catalog.fanout_timeout_ms` | 800 | 100–5000 | Per-leg deadline for cross-station queries; slow stations are dropped from the result, not retried. |

A station that exceeds its rate limit gets HTTP 429 + a `Retry-After` header on direct calls, or a structured `ErrorResponse{code: RATE_LIMIT_EXCEEDED}` over the relay frame.

Metrics (mirrors the C1 metrics pattern):

- `federation_catalog_query_total{result}` — `result ∈ {ok, rate_limited, disabled, error}`
- `federation_catalog_query_duration_seconds` — histogram of total latency (originator-side), labelled by `path ∈ {local, fanout}`
- `federation_catalog_fanout_legs_total{outcome}` — `outcome ∈ {ok, timeout, error, refused}` per peer leg
- `federation_catalog_results_returned` — histogram of `len(results)`

---

## 7. Hard constraints for the implementer

A future PR that lands the catalog MUST honour every item below. Reviewers should treat any deviation as a blocker.

1. **Privacy ladder respected** — `VISIBILITY_BY_HANDLE` actors NEVER appear in any catalog response, including local-only queries. The trie's underlying SQL filter MUST be `WHERE visibility = INDEXED`.
2. **`origin_peer_id` is relay-stamped** — the catalog handler trusts the relay's stamping and never reads the field from the request body (same model as Tier C1).
3. **Rate limit keys both `origin_peer_id` AND IP** — relay-mediated traffic is keyed by `origin_peer_id`; direct HTTP entry from outside the federation is keyed by IP. A request with both available is gated by the stricter of the two.
4. **No envelope fields in the catalog response** — only `ActorRef`. Any future enrichment (e.g. `display_name`) lives ON `ActorRef`, not adjacent to it.
5. **Per-station opt-out is honoured before any work happens** — `catalog.serve = false` returns `403 catalog_disabled` before the index is even consulted, before any DB read, before rate limit accounting.
6. **Fan-out timeouts elide slow stations, never fail the whole query** — partial results with `responding_peer_id` attribution beat all-or-nothing semantics.
7. **Pagination cursor is opaque** — the server MAY change the underlying representation; clients MUST treat the cursor as a black box and never parse it. Cursors expire after 5 minutes server-side.
8. **No write paths** — the catalog is read-only. Any mutation of the catalog index is a side-effect of `UpdateProfile` / `UpdateVisibility` and goes through the existing locator-hook pipeline.

---

## 8. Open questions / deferred

These are explicitly out of scope for v1 but must be revisited:

- **Bloom-filter DHT layer (Q1 option B)** — once the test bench grows past ~10 stations, fan-out cost will dominate. A second DHT namespace publishing per-prefix bloom filters lets the originator skip stations that definitely have no match. Designing this requires knowing the actual prefix distribution, which we don't have until v1 is deployed.
- **Federation.txt (analogous to robots.txt)** — a station-served manifest declaring "I serve catalog / I don't / here's my abuse contact". Useful once the federation has third parties; not needed while the bench is operator-controlled.
- **Cross-station relationship queries** ("who follows alice@b") — a different consent model. Probably needs the actor concerned to opt in per-edge, not per-account.
- **Server-side query DSL** — for v1, prefix + locale + region filters are enough. A richer query language can be added later behind the same endpoint without breaking clients.
- **Caching of fan-out results on the originator** — useful but adds eviction policy questions; deferred until we measure actual hit rates.

---

## 9. Verification on landing

A v1 implementation is "done" when all of the following hold:

- [ ] `model/domain/federation/catalog.proto` exists and generates cleanly.
- [ ] An INDEXED actor on station-1 appears in a search initiated on station-2 within one fan-out timeout window.
- [ ] A BY_HANDLE actor on station-1 does NOT appear in the same search, regardless of prefix.
- [ ] A station with `catalog.serve = false` returns `403 catalog_disabled` and never invokes the index.
- [ ] Rate limit triggers HTTP 429 + `Retry-After` after `qps_per_origin × burst` sustained requests; the per-IP rule trips independently for unauthenticated entry.
- [ ] Fan-out elides a station that times out; the response includes results from the surviving legs and a non-empty `next_page_cursor` if there's more.
- [ ] All four metrics families described in §6 appear in `/metrics` and align with the actual request rate / fan-out cardinality.
- [ ] No envelope-level data leaks through the catalog response (assert on the wire bytes).

---

## 10. Cross-references

- Topology / operational rules: `.localenv §1`, `§7 Tier C1 Push-style invalidation` (sets the precedent for relay-mediated federation traffic).
- Trust model + relay stamping: `.localenv §7` and `apps/station/frame/core/plugin/native/subserver/relay/stream.go::handleInboundBroadcast`.
- Visibility states: `model/domain/identity/actor_visibility.proto`.
- Existing federation read path: `apps/station/frame/touch/federation/{locator,cache,resolver,profile}/`.

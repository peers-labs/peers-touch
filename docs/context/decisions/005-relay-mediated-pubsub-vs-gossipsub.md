# ADR-005: Relay-mediated pub/sub for federation invalidation (vs. gossipsub)

**Status:** Accepted
**Date:** 2026-05-18
**Decision Makers:** Architecture (during Tier C1 implementation)
**Related:**
- `apps/station/frame/core/plugin/native/subserver/relay/`
- `apps/station/frame/touch/federation/invalidation/`
- `model/domain/federation/invalidation.proto`
- `docs/knowledge/invariants/relay-readloop-discipline.md`
- `docs/knowledge/playbooks/adding-federation-broadcast-topic.md`

---

## Context

Tier C1 (push-style invalidation) needs a way for one station to tell every other station mounted on the same relay "this cached `ActorProfileEnvelope` is stale, drop it". The slow path (DHT republish + per-row TTL) was already in place; the goal of C1 was sub-second propagation for visibility / profile changes.

Two transports were on the table:

### Option A — libp2p gossipsub

The federation already uses libp2p for DHT (Kademlia). gossipsub is a peer-to-peer pub/sub protocol that ships with go-libp2p, with mature topic semantics, mesh maintenance, and message-id based de-duplication.

Pros:
- Battle-tested in IPFS / Filecoin at much higher scale than peers-touch needs.
- Topic-based, signed messages out of the box.
- Decentralized — no relay-as-bottleneck.

Cons:
- Requires every station to maintain a gossipsub mesh independent of the existing relay tunnel. Two parallel transports to monitor, debug, secure.
- Stations behind NAT (the current default — relay-only outbound) need additional NAT-traversal beyond what the relay already provides. Either the relay relays gossipsub, or each station opens a second hole.
- Eventual-consistency and message-id-cache semantics are not what we want for cache invalidation; we want **at-most-once with strict ordering by sequence number**, which gossipsub supports via configuration but is the harder mode.
- Adds a non-trivial dependency surface (gossipsub topic configuration, score parameters, mesh degree) that the team has not previously operated.

### Option B — relay-mediated pub/sub

The relay subserver already terminates a TCP framed protocol from every connected station; it already authenticates each stream by libp2p PeerID; it already serializes per-stream writes via `writeMu`. Adding a `TypeBroadcast` frame and a fan-out path on the `StreamManager` extends what's already there.

Pros:
- Reuses one transport. One thing to monitor, one set of metrics, one trust model.
- The relay is the natural place to **stamp `origin_peer_id`** authoritatively — the publisher's claim is overwritten with the authenticated peer ID before fan-out, so receivers' trust gates have a single, simple check.
- Topology constraint match: the test bench is one relay + few stations; the relay is by design the rendezvous, and every station on it can see every other through it. No new NAT path.
- Wire format stays in the existing `protocol/frame.go` codec; topic allow-list is one map check.
- Receiver-side handler can be wired into the existing `relay-client` read loop with the same pattern as `RequestFrame` (already async-dispatched).

Cons:
- Single point of failure / bottleneck (mitigated: the existing federation already routes all forwards through the relay; this is not a new dependency, just a new use of an existing one).
- Cross-relay traversal is not provided (deferred — `inbox_relay_mounts` proto field reserves the path; multi-relay topology is a future tier).
- Bespoke wire format that won't interop with non-peers-touch stations (acceptable: federation is already non-interop with non-peers-touch by virtue of the locator namespace).

## Decision

**Use Option B — relay-mediated pub/sub via a new `TypeBroadcast` frame on the existing relay protocol.**

Specifically:

- New frame type `TypeBroadcast = 0x05` with `[2B topicLen][topic][2B originLen][origin_peer_id][4B bodyLen][body]`.
- Hard limits at the codec layer: `MaxBroadcastTopicLen = 128`, `MaxBroadcastBodyLen = 64KB`.
- Topic allow-list on the relay side, deny-by-default; explicit `SetAllowedBroadcastTopics(...)` at startup.
- `origin_peer_id` is **always** stamped by the relay from the authenticated stream — publishers may set the field but the relay overwrites it. Receivers trust the relay's stamp; this is the same trust anchor used by `home_station_peer_id` cross-checks.
- First topic to land on this transport: `fed.invalidate.v1`, carrying `FederationInvalidation` (handle, locator_seq, reason, origin_peer_id, issued_at_unix_ms).

The decision is **scoped to single-relay topology**. When (if) multi-relay deployment becomes a real requirement, a relay-to-relay federation layer will be designed; the proto's `inbox_relay_mounts` already reserves the addressing primitive. The transport choice will be revisited at that point — gossipsub becomes more attractive in a topology where there is no single relay to mediate.

## Consequences

### Positive

- One transport, one set of metrics, one trust path. The C1 metrics surface (received / dropped / applied / publish counters with bounded labels) maps 1:1 with the relay's existing observation surface.
- The `origin_peer_id` stamping pattern is now reusable for any future relay-mediated topic — see the playbook `docs/knowledge/playbooks/adding-federation-broadcast-topic.md`.
- Implementation surface was small: a new frame type + a new `StreamManager.handleInboundBroadcast` callback + a tiny `invalidation` package. No new dependencies.

### Negative / accepted trade-offs

- The relay's read-loop discipline becomes a load-bearing invariant — any new topic must NOT do blocking work on the read loop. This is now formalized in `docs/knowledge/invariants/relay-readloop-discipline.md`. The first cut of C1 violated this; the fix uses goroutine dispatch on both relay and client sides.
- Single relay = single failure domain for federation pub/sub. Acceptable today (test bench has one relay; production hasn't shipped). Revisit when multi-relay lands.
- Bespoke transport means we will not benefit from gossipsub mesh-maintenance work elsewhere in the libp2p ecosystem. Mitigated: the codec is small (~200 lines), and we don't need mesh maintenance because the relay IS the mesh.

### Reversal cost

Medium. The `TypeBroadcast` frame and topic allow-list are independent of the receiver-side `invalidation` package; replacing the transport would mean re-wiring the publish/subscribe sites but leaving the proto + trust gates intact. The `origin_peer_id` stamping pattern would need a different anchor in a gossipsub world (per-message signature instead of relay-stamped field).

## Verification

- C1 implementation lands the frame type + receiver gate at 2026-05-18; race-detector tests on the relay package pass clean.
- `relay_broadcast_*` and `federation_invalidation_*` metrics expose volume and outcome; the funnel `received = applied + dropped[non-format]` holds in steady state.
- The trust model is documented in `docs/knowledge/glossary.md` under "Push-style invalidation (Tier C1)" → "Trust gate"; the receiver-side enforcement lives in `apps/station/frame/touch/federation/invalidation/invalidation.go::handle`.

## Crosswalks

- Invariant `docs/knowledge/invariants/relay-readloop-discipline.md` formalizes the read-loop hand-off rule that this transport choice creates.
- Playbook `docs/knowledge/playbooks/adding-federation-broadcast-topic.md` is the standard operating procedure for any future topic on this transport.
- Pitfalls `docs/knowledge/pitfalls/c1-tombstone-only-broadcast.md` and `docs/knowledge/pitfalls/republisher-broadcast-spam.md` are the two near-misses encountered while landing this transport's first user.

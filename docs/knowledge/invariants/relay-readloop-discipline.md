---
kind: invariant
title: Relay readLoop goroutines must dispatch blocking work asynchronously
status: active
owns:
  - apps/station/frame/core/plugin/native/subserver/relay/stream.go
  - apps/station/frame/core/plugin/native/subserver/relay/relay.go
  - apps/station/frame/core/plugin/native/subserver/relay/client/relay_client.go
referenced-by:
  - ../pitfalls/c1-tombstone-only-broadcast.md
  - ../playbooks/adding-federation-broadcast-topic.md
related:
  - ../../context/decisions/005-relay-mediated-pubsub-vs-gossipsub.md
detected: 2026-05-18
---

# Relay readLoop goroutines must dispatch blocking work asynchronously

## What must hold

Every goroutine that is the **sole reader** of a relay TCP stream — both the relay-side `streamEntry.readLoop` and the station-side `relay-client.readLoop` — MUST return to its `protocol.ReadFrame` call as quickly as possible after dispatching a frame. Any non-trivial work (DB I/O, mutex contention, fan-out across other streams, network calls) MUST happen on a separate goroutine spawned from the readLoop, not inline.

"Non-trivial" here means anything that can hold a mutex for longer than a few microseconds, perform I/O, or scale with the number of other streams. Pong replies, in-memory state mutations, and channel sends are fine inline.

## Why this is non-negotiable

The relay's correctness model rests on three facts about each stream:

1. **The readLoop is the only goroutine that reads from `conn`.** Frames are processed in arrival order; no other consumer exists.
2. **Heartbeats (Ping/Pong) flow on the same TCP stream as application frames.** A blocked readLoop cannot dispatch incoming Pong frames.
3. **Both ends run a heartbeat reaper** that closes the connection if Pongs stop arriving for `~3 × ping_interval` (default ≈ 30s).

Therefore, any synchronous work in the readLoop directly competes with heartbeat liveness. The failure mode is silent and racy: a slow request handler or a contended `writeMu` on a sibling stream causes the readLoop to miss a Pong window, the reaper fires, and an otherwise healthy connection is recycled. The application sees this as "intermittent station disconnects under load" — diagnosable only by correlating handler latency with reconnect events.

The relay-side fan-out has an additional failure mode: when station A publishes a broadcast, A's readLoop runs the fan-out callback. If the callback writes to siblings B / C / D synchronously, A's readLoop is held for the slowest sibling's `writeMu` — meaning A's heartbeats stall whenever any other station has a slow forward in flight. The blast radius is N-1 stations.

The trust model is independent: stamping `origin_peer_id` and applying topic allow-lists already happens correctly on the readLoop, but those operations are O(1) and do not violate this invariant. The invariant targets *blocking* work, not *all* work.

## How to verify

The grep below catches the most common regression — a frame `case` that calls user code without `go`:

```bash
rg -n --multiline 'case \*protocol\.(BroadcastFrame|RequestFrame|ResponseFrame).*\n[^g][^o]' \
  apps/station/frame/core/plugin/native/subserver/relay/
```

Every match should be one of:

- `go c.handleRequest(...)` — RequestFrame on the client side.
- `go e.onBroadcast(...)` / `go target.handleSomething(...)` — fan-out callbacks.
- A short, in-memory state update (channel send, atomic store, map lookup).

If a match is none of those, it is a bug.

Behavioural test:

- `go test -race -count=1 ./apps/station/frame/core/plugin/native/subserver/relay/...` — must pass clean. The race detector will flag any unsafe access from goroutines spawned by readLoop, but does NOT detect heartbeat starvation; that one needs a load-test harness.

Metric guard:

- `relay_broadcast_forwarded_total{result="ok"}` should equal the publisher's `relay_broadcast_received_total{result="allowed"}` × `(connected_peers - 1)` within a refresh window. A persistent gap implies fan-out is blocking long enough that some siblings get connection-recycled before they receive their copy.

## Crosswalks

- Pitfall `pitfalls/c1-tombstone-only-broadcast.md` documents the first cut of Tier C1 that violated this invariant on both sides (publisher's fan-out blocked on sibling writes; receiver's handler blocked on DB I/O). The fix in PR / commit at 2026-05-18 is the reference implementation.
- Playbook `playbooks/adding-federation-broadcast-topic.md` builds compliance with this invariant into the standard procedure for new topics.
- ADR `docs/context/decisions/005-relay-mediated-pubsub-vs-gossipsub.md` explains why the relay mediates pub/sub (rather than gossipsub) and therefore why this invariant exists at all — without it, gossipsub's own goroutine pool would absorb the blocking.

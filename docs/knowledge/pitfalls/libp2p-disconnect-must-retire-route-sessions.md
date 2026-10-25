---
kind: pitfall
title: Libp2p disconnect must retire route sessions
status: active
owns:
  - packages/station-libp2p-http/
  - tooling/acceptance/gates/mobile/simulator_station_lifecycle_e2e.py
related:
  - ../../architecture/platform/runtime/node-connectivity/design.md
  - ../../architecture/platform/station/access/design.md
detected: 2026-10-20
---

# Libp2p disconnect must retire route sessions

## Symptom

Mobile renewed an expired Station route and libp2p reconnected successfully,
but the identity request never reached the Station. The HTTP/2 route-session
pool still returned a cached sender bound to the retired libp2p stream.

## Root cause

The transport removed peer connectivity after `ConnectionClosed`, while
route-session invalidation ran separately and asynchronously. A request could
therefore reuse a stale HTTP/2 sender after the final libp2p connection closed.
Treating every close as final would also be wrong because one peer may have
multiple established connections.

## Mitigation

### What was done in code

- Commit `47c364d1956c687bd99ba5709b5786fc1a478688` makes the session pool
  synchronously detach all sessions for a peer before asynchronous close.
- `ConnectionClosed` retires peer sessions only when `num_established == 0`.
- Explicit route close and submitted-request failure use the same
  detach-then-close ownership model.
- Synchronous SDK dial/reply waits observe caller cancellation and bounded
  duration. Attempt cleanup cancels a child token, preserving the caller's
  retry scope. Shared pending dials abort through the upstream Swarm only after
  their last subscriber leaves; completion errors match the connection ID.
  Swarm retains the aborted pool entry until it is polled. Same-peer replacement
  therefore uses `PeerCondition::Disconnected`, with live-dial sharing owned by
  the driver, so retirement cannot synchronously reject the next caller.

### What guards against regression

`route_sessions_are_detached_before_peer_reconnect` verifies route- and
peer-wide detachment. The Mobile Station lifecycle Gate waits beyond the
five-minute route lifetime, resumes the same session, then selects the expired
secondary Station route.

SDK reply-wait regressions cover cancellation, timeout and actual submission
phase. `shared_dial_cancellation_preserves_subscribers_and_fences_old_errors`
checks subscriber retirement, upstream pending-connection abort and old-error
isolation. It admits the replacement before polling the old abort, then verifies
the real retired event leaves the replacement pending. Desktop's signed
discovery-to-failover regression reaches a distinct
replacement node with a stalled handshake inside the original Search deadline.
`ordinary_timeout_can_failover_while_bounded_deadline_cannot` separately protects
ordinary SafeRead replay and explicitly bounded Search semantics.

## How to detect a recurrence

```bash
cargo test --manifest-path packages/station-libp2p-http/Cargo.toml
python3 -m unittest \
  tooling.acceptance.gates.mobile.simulator_station_lifecycle_e2e_test
```

Run `mobile-simulator-station-lifecycle-e2e` through the canonical Gate catalog.
Evidence must contain `expired-route-resumed-with-same-session` and
`expired-secondary-route-selected`, both with `waitSeconds` between 310 and
360. A successful libp2p reconnect without a Station-side identity request is
the transport-level recurrence signal.

## Crosswalks

- Node Connectivity owns route lifetime and transport identity.
- Station Access owns route renewal before admission.

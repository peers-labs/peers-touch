---
kind: invariant
title: Circuit Relay is an opaque, fenced data plane
status: active
owns:
  - apps/station/frame/core/plugin/native/relay/
  - apps/station/frame/core/plugin/native/subserver/relay/
referenced-by:
  - docs/architecture/platform/runtime/node-connectivity/design.md
related:
  - docs/architecture/platform/runtime/node-connectivity/decisions.md
  - docs/architecture/platform/runtime/node-connectivity/data-model.md
  - docs/architecture/platform/runtime/node-connectivity/integration.md
detected: 2026-10-13
---

# Circuit Relay Is An Opaque, Fenced Data Plane

## What must hold

Relay payload transport MUST use standard libp2p Circuit Relay v2. Peers-Touch
Relay code may own enrollment, node generation, signed route discovery,
source-bound private permits, reservations, quotas and metrics. It MUST NOT
define a custom payload frame, forwarding token, business route, topic
registry, decrypted request parser or Relay-to-Relay mesh.

Public admitted destinations MUST accept an ordinary source without requiring
that source to enroll. Private admission MUST bind a bounded permit to source
PeerID, destination Node PeerID and current route generation. Generation
replacement and revocation MUST invalidate stale routes and permits.

Enrollment and credential state that must survive restart MUST commit durable
truth before publishing the replacement to memory. Consumed invites MUST remain
consumed after repository reconstruction. Connection grants and permits are
intentionally volatile: restart MUST fail closed and require fresh private
connection material rather than restoring a prior permit.

Reservations at different Relay PeerIDs MUST remain independent. Failure or
revocation at one Relay MUST NOT mutate another Relay's live reservation.

## Why this is non-negotiable

Standard Circuit transport keeps application bytes opaque and leaves Station
Session, Federation and business authorization with their canonical owners.
Adding a second payload protocol or business router at Relay would recreate the
deleted split data plane and expand Relay compromise beyond availability and
transport metadata.

Generation, source and persistence ordering prevent stale authorization from
surviving replacement, replay or restart. Independent Relay state preserves
failover: one failed target can be removed without discarding another target's
healthy route.

## How to verify

- `cd apps/station && go test ./frame/core/plugin/native/relay ./frame/core/plugin/native/subserver/relay/... -count=1`
  passes, including source binding, generation replacement, restart replay,
  persistence ordering and dual-Relay failure-isolation tests.
- `python3 tooling/scripts/node-connectivity-journey.py --closure ncp-native-cut --gate NCP-G07`
  passes before claiming bounded Circuit admission proof.
- `python3 tooling/scripts/node-connectivity-journey.py --closure ncp-native-cut --gate NCP-G08`
  passes before claiming the atomic native transport cut.
- `rg -n '/relay/forwar[d]|[Ss]treamManager|streamHandshak[e]|relay-client-toke[n]' apps/station model/domain --glob '!**/*.pb.go'`
  returns no live custom data-plane owner.
- Relay source imports no Station business handler or domain fan-out package.

## Crosswalks

- NCP-D03 makes Circuit Relay v2 the only Relay data plane.
- NCP-D04 limits Relay authority to transport admission.
- NCP-D06 and NCP-D09 define generation fencing and source-bound private
  admission.
- NCP-D08 requires library wire formats and finite resource limits.
- NCP-G07 and NCP-G08 own formal admission and removal evidence.

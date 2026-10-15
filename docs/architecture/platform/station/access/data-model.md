# Station 统一接入生命周期 - 数据模型

> **Status**: active
> **Version**: v2.3
> **Created**: 2026-09-27 | **Updated**: 2026-10-13
> **Owner**: Identity and Access

---

## 1. Verified Station Target

```text
VerifiedStationTarget
  station_peer_id
  pinned_station_root_public_key
  canonical_origin
  capabilities[]
  verified_at
```

Endpoint identity, Station identity, Relay route, connection grant and Circuit
contracts are defined by
[Node Connectivity](../../runtime/node-connectivity/data-model.md).
Station Access receives only a verified target and never treats URL, Relay
PeerID, physical Node PeerID or route ID as identity. Node authorization and
signature are verified against the logical Station root by Node Connectivity.

## 2. Station Binding

```text
StationBinding
  station_peer_id
  pinned_station_root_public_key
  routes: RouteCandidate[]
  active_route_id
  active_node_peer_id
  route_revision
  lifecycle_generation
  created_at
  updated_at

RouteCandidate
  route_id
  route_type: DIRECT | RELAY
  node_peer_id
  endpoint_origin
  relay_peer_id?
  attestation_digest?
  attestation_expires_at?
  last_verified_at
  last_success_at?
  health: AVAILABLE | DEGRADED | UNAVAILABLE | REVOKED
```

Invariants:

- `station_peer_id` is the registry key;
- active route references a verified route for the same Station;
- route change increments `route_revision`;
- Station replacement increments `lifecycle_generation`;
- no URL alias, Relay registry or parallel Session owner exists.

## 3. Access Scope

```text
AccessScope
  station_peer_id
  actor_ptid
  device_id
  lifecycle_generation

TransportScope
  station_peer_id
  active_route_id
  active_node_peer_id
  route_revision
```

Session, Messaging, Federation context, cache and projections use
`AccessScope`. Only connection selection uses `TransportScope`. A transport
failure cannot mutate ActorRef or regenerate a federated handle from request
host.

`StationBindingCoordinator` projects `TransportScope` as an immutable
`RouteLease`. The lease contains lifecycle generation, route revision, verified
node destination and a cancellation fence. Node Connectivity owns the remaining
transport fields and execution semantics. A revoked lease cannot be reused by a
late callback or pooled connection.

```text
StationResourceRef
  station_peer_id
  lifecycle_generation
  path_and_query
  content_identity?
```

`StationResourceRef` is the only Station-owned relative resource identity.
Direct/Relay origin, Node PeerID and localhost projection are forbidden fields.
External absolute URLs are not converted into this type.

Access attempts, Session records and credential/keyring recovery share the
logical Station database/keyring across ready nodes. Node PeerID and route
revision never enter the business Session concurrency key.

## 4. Access Attempt

```text
StartAccessAttemptRequest
  station_peer_id
  device_id
  platform
  lifecycle_generation

StartAccessAttemptResponse
  attempt
  gate

SubmitAccessGateRequest
  attempt_id
  station_peer_id
  device_id
  lifecycle_generation
  oneof answer

GetAccessDecisionRequest | CancelAccessAttemptRequest
  attempt_id
  station_peer_id
  device_id
  lifecycle_generation
```

The Access Gate owner controls allowed answer types, retries, expiry,
credential issuance and cancellation. Generated protobuf is the only client
wire contract.

## 5. Access State Machine

```text
unselected
  -> endpoint_verifying
  -> station_confirm_required
  -> transport_establishing
  -> access_gating
  -> granted
  -> runtime_starting
  -> ready

endpoint_verifying | station_confirm_required | transport_establishing
  -> failed

access_gating
  -> denied | expired | cancelled | failed

ready
  -> switching | signed_out | revoked | failed
```

Route failure can return to `transport_establishing` without changing
`AccessScope`. Station identity change enters explicit replacement, not route
recovery.

## 6. Federation Context

```text
FederationContext
  federation_id
  display_name
  state
  station_peer_id
  revision
```

Federation context is orthogonal to Relay route. Operations requiring
Federation scope carry an explicit `federation_id`; route selection cannot
create or infer one.

## 7. Client-Class Session Slot

```text
ClientClass
  desktop
  mobile
  web

ActorSessionClassSlot
  actor_id
  client_class
  active_session_id
  device_id
  lifecycle_generation
  revoked
  revoked_reason
```

Invariants:

- one non-revoked Session per `(actor_id, client_class)`;
- database partial unique index enforces the active slot;
- new same-class activation and old-session `kicked` revoke are atomic;
- different classes are excluded from the revoke set;
- password, OAuth and takeover produce the same slot result;
- historical aliases are normalized only by schema migration and cannot be
  written at runtime.

## 8. Capability References

Station Access owns or consumes:

```text
station.identity.verify
access.gate.start
access.gate.submit
access.gate.decision
access.gate.cancel
```

The API registry owns method/path/Proto/Station owner. Node Connectivity owns
Relay endpoint and standard Circuit capabilities. This document does not copy either
registry.

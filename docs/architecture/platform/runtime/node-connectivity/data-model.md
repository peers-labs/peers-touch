# Node Connectivity - Data Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-10 | **Updated**: 2026-10-10
> **Owner**: Architecture Team

---

## 1. Contract Roots

```text
model/domain/peer/station_identity.proto
model/domain/peer/access_endpoint.proto
model/domain/federation/relay_transport.proto
```

The `.proto` files are canonical. Generated Go/Rust/TypeScript outputs are
projections and are never edited as protocol truth.

## 2. Endpoint Identity

```text
AccessEndpointRequest
  challenge: bytes[32]
  connection_grant: bytes?
  client_protocol_version: uint32

AccessEndpointStatement
  challenge
  endpoint_role: DIRECT_STATION | RELAY
  endpoint_peer_id
  canonical_origin
  protocol_versions[]
  capabilities[]
  issued_at_unix_ms
  expires_at_unix_ms

AccessEndpointResponse
  outcome
  endpoint_statement_bytes
  endpoint_public_key
  endpoint_signature
  station_routes[]
```

The statement uses deterministic protobuf bytes and a domain-separated
signature. Redirect, HTML, HTTP status heuristics and URL shape cannot decide
the endpoint role.

`StationIdentityStatement` remains the destination Station identity proof.
`canonical_origin` is a route/bootstrap attribute and cannot become a Station,
Actor or Federation identity key.

## 3. Station Route Attestation

```text
StationRouteStatement
  station_peer_id
  relay_peer_id
  route_id
  route_generation
  inner_tls_spki_sha256
  capabilities_digest
  visibility: PUBLIC | GRANT_ONLY
  issued_at_unix_ms
  expires_at_unix_ms

StationRouteAttestation
  statement_bytes
  host_public_key
  signature
```

Validation rules:

- the public key derives `station_peer_id`;
- the Station signature covers exact deterministic statement bytes;
- `relay_peer_id` equals the contacted Relay;
- route ID is non-empty and generation is non-zero/current;
- lifetime is current and bounded;
- SPKI digest is exactly SHA-256 length;
- capability digest equals the expected typed peer manifest;
- unknown fields or enum values fail closed where the verifier requires an
  exact current contract.

## 4. Private Connection Material

```text
StationConnectionGrantStatement
  grant_id
  station_peer_id
  relay_peer_id
  route_id
  route_generation
  max_uses
  issued_at_unix_ms
  expires_at_unix_ms

StationConnectionGrant
  statement_bytes
  host_public_key
  signature

StationConnectionEnvelope
  protocol_version
  relay_origin
  route_attestation
  connection_grant
```

The Station signs the grant and registers only its digest with Relay. Relay
atomically checks digest, route, generation, expiry and remaining uses.

The encoded envelope may be presented as `ptc1:<base64url>` or in a URL
fragment. Raw material must not enter query strings, Referer, analytics, logs
or error text.

## 5. Enrollment And Mount

Conceptual persistent records:

```text
RelayInvite
  invite_id
  secret_digest
  intended_station_peer_id?
  max_clients
  bandwidth_limit
  expires_at
  consumed_at?
  revoked_at?

RelayMount
  mount_id
  station_peer_id
  station_host_public_key
  generation
  credential_jti
  max_clients
  bandwidth_limit
  status
  last_heartbeat_at
  revoked_at?
```

Enrollment lifecycle:

```text
invite_issued
  -> challenged
  -> proof_verified
  -> invite_consumed + mount_active

mount_active
  -> rotating -> mount_active(new generation)
  -> revoked
  -> expired
```

Invite consume, Station identity binding and generation creation are one
transaction. Current generation is checked at mount connect, refresh, route
publish and peer tunnel admission.

## 6. Mount Credential

```text
RelayMountCredential
  issuer
  audience
  scopes[]
  jti
  relay_peer_id
  station_peer_id
  mount_id
  generation
  issued_at
  expires_at
  relay_signature
```

Current scopes include mount connect/rotate, route publish and peer tunnel.
Operator credentials use separate key, issuer, audience and scope. Station
application Sessions are not accepted at Relay operator or mount boundaries.

## 7. Tunnel Frame

Canonical generated shape:

```text
RelayTunnelFrame
  protocol_version
  oneof:
    RelayTunnelOpen
    RelayTunnelOpened
    RelayTunnelData
    RelayTunnelCancel
    RelayTunnelClose
```

```text
RelayTunnelOpen
  route_id
  route_generation
  client_nonce: bytes[32]
  connection_grant?
  target_station_peer_id?
  purpose: CLIENT_ACCESS | FEDERATION_PEER

RelayTunnelOpened
  tunnel_id
  limits
  route_attestation
  relay_nonce: bytes[32]

RelayTunnelData
  tunnel_id
  sequence
  ciphertext

RelayTunnelCancel | RelayTunnelClose
  tunnel_id
  reason
```

There are no request, response, method, path, header, cookie or Authorization
fields.

## 8. Caller Matrix

| Purpose | Outer caller proof | Open fields |
|---|---|---|
| `CLIENT_ACCESS` public | source admission only | route ID + generation; no mount; no target PeerID |
| `CLIENT_ACCESS` private | Station connection grant | route ID + generation + grant |
| `FEDERATION_PEER` | current mount credential with peer-tunnel scope | target Station PeerID; no connection grant |

Any mixed shape fails as unauthorized.

## 9. Tunnel Limits

```text
RelayTunnelLimits
  max_frame_bytes
  max_request_bytes
  max_response_bytes
  max_connection_bytes
  idle_timeout_seconds
  rate_bytes_per_second
```

Current source caps one `RelayTunnelData.ciphertext` payload at 64 KiB. Runtime
limits are the minimum of process defaults and mount-specific
`max_clients/bandwidth_limit`. The receiver rejects an oversized encoded frame
before protobuf forwarding.

## 10. Tunnel State

```text
opening
  -> active
  -> draining
  -> closed

opening | active
  -> unavailable
  -> revoked
  -> overloaded
  -> oversize
  -> timeout
  -> protocol_error
  -> cancelled
```

Per-tunnel counters track ordered sequence, bytes by direction and aggregate
bytes. Data exists only in bounded queues and is not persisted by Relay.

## 11. Station Binding Projection

Station Access consumes:

```text
StationBinding
  station_peer_id
  pinned_host_public_key
  routes[]
  active_route_id
  route_revision
  lifecycle_generation

RouteCandidate
  route_id
  kind: DIRECT | RELAY
  endpoint_origin
  relay_peer_id?
  attestation_digest?
  attestation_expires_at?
  health
```

`StationBinding` is not owned by Relay. Route changes increment
`route_revision`; Station replacement increments lifecycle and follows Station
Access teardown semantics.

## 12. Error Model

Outer tunnel errors are limited to:

```text
UNAVAILABLE
REVOKED
OVERLOADED
OVERSIZE
TIMEOUT
PROTOCOL_ERROR
CANCELLED
```

Station Access, auth and business errors remain encrypted inside inner TLS and
must not be translated into Relay error classes.

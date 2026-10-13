# Node Connectivity - Data Model

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-10-10 | **Updated**: 2026-10-13
> **Owner**: Architecture Team

## 1. Contract Roots

Canonical Peers-Touch control contracts live in
`model/domain/peer/station_identity.proto` and `access_endpoint.proto`.
Relay enrollment uses signed identity responses plus the route/grant messages
in `access_endpoint.proto`; Circuit reservation, CONNECT and data framing are
owned entirely by libp2p. Proto is canonical.

Libp2p owns Circuit reservation/hop/stop, security and multiplexing wire formats.
Peers-Touch does not redefine them. Canonical Station business protobuf roots,
HTTP routes and SSE event encoding retain their domain owners.

## 2. Logical Identity And Node Authorization

```text
StationIdentityStatement
  challenge: bytes[32]
  station_peer_id: derived from station_root_public_key
  canonical_origin: bootstrap hint
  capabilities: sorted capability IDs
  issued_at_unix_ms / expires_at_unix_ms
  node_authorization_digest

StationNodeAuthorizationStatement
  station_peer_id
  node_peer_id: derived from node_public_key
  node_public_key
  authorization_epoch
  capabilities_digest
  issued_at_unix_ms / expires_at_unix_ms

StationNodeAuthorization
  statement_bytes
  station_root_public_key
  root_signature

StationIdentityResponse
  statement_bytes
  node_signature
  node_authorization
```

Signatures use deterministic protobuf bytes and distinct domain-separation
labels for identity, delegation, route and grant. Verifiers cap encoded control
size at 1 MiB, reject invalid/unknown required enums and validate every digest.
`station_peer_id` retains the existing public meaning as Station scope; a Host
never uses the root key. Delegation digest binds the responding node to the
challenge-bound identity proof. Challenge responses expire within five minutes.

Node authorization has a maximum 24-hour lifetime. Clients reject it after
expiry even when the route is cached. Node admission additionally checks current
registry epoch. Root renewal signs the same node/epoch; node revocation advances
epoch. Root compromise requires explicit identity replacement, not route refresh.

## 3. Route Attestation

```text
StationRouteStatement
  station_peer_id
  node_peer_id
  relay_peer_id: required for CIRCUIT, absent for DIRECT
  route_id
  route_generation: admission epoch, not heartbeat counter
  kind: DIRECT | CIRCUIT
  addresses: validated multiaddrs / direct HTTPS origin
  inner_tls_spki_sha256: bytes[32]
  capabilities_digest: bytes[32]
  visibility: PUBLIC | GRANT_ONLY
  node_authorization_digest
  issued_at_unix_ms / expires_at_unix_ms

StationRouteAttestation
  statement_bytes
  node_signature
  node_authorization
```

The verifier derives both identities from the corresponding keys, validates
root delegation and node signature, checks capability inclusion, and matches
the final `/p2p/<node>` and Circuit `/p2p/<relay>/p2p-circuit/` segments.
Route lifetime is at most five minutes and cannot exceed node authorization.
Inner TLS uses the authorized node key and ALPN h2; no credential is sent before
SPKI validation. Direct HTTPS has equivalent signed identity verification.

Node incarnation belongs to operational readiness and need not change a stable
node certificate at every restart. Route generation changes only for admission
revocation/rotation. Routine reservation renewal leaves healthy transport intact.

## 4. Enrollment And Private Connection Grant

```text
RelayNodeEnrollment
  logical_station_peer_id / node_peer_id
  authorization_digest / authorization_epoch
  relay_peer_id
  status: ACTIVE | REVOKED | EXPIRED
  credential_digest / credential_expiry
  route_visibility / quota_policy_id

StationConnectionGrantStatement
  grant_id / station_peer_id / node_peer_id / relay_peer_id
  route_id / route_generation
  max_uses / issued_at_unix_ms / expires_at_unix_ms

RedeemConnectionGrantRequest
  grant
  challenge_nonce: bytes[32]
  source_peer_id
  source_signature

RelayConnectionPermit
  permit_id
  source_peer_id / destination_node_peer_id / relay_peer_id
  route_id / route_generation
  expires_at_unix_ms
  max_active_circuits / quota_policy_id
```

Grant issuance authorizes discovery/admission only. It is not a Station Session.
Redemption uses the authenticated source libp2p control connection, verifies its
PeerID proof and Station/node signature, atomically consumes grant use, and
creates the source-to-destination permit. The ACL reads that projection during
Circuit CONNECT. It must not expect custom grant bytes inside standard HOP.
Permit lifetime is bounded by grant lifetime; initial maximum is five minutes.
Duplicate redemption uses a stable redemption idempotency key; a retry cannot
consume another use or create an unbound permit.

Encoded `ptc1:` material remains a carrier convention, not an identity or extra
wire protocol version. It contains signed routes, delegation and optional grant.
Credentials never enter URL query, logs, analytics or Referer. Node/operator/
client credentials use distinct issuer, audience, scopes and keys.

## 5. Binding And Runtime State

```text
StationBinding
  station_peer_id / pinned_station_root_public_key
  verified_routes[]
  candidate_route_refreshes[]
  active_route_id / active_node_peer_id
  route_revision / lifecycle_generation

StationNodeRegistry
  station_peer_id / node_peer_id: unique pair
  node_public_key_digest / authorization_epoch
  incarnation: random boot identity
  lease_expires_at: database time
  draining / endpoint_digest / schema_compatibility / updated_at
```

Route revision fences transport callbacks; lifecycle generation fences Station
replacement. Active node never enters the Session/Actor/Device scope key.
Registry enrollment updates compare epoch. Operational lease updates compare
node plus incarnation and cannot resurrect a revoked node.
For a refreshed contract that retains the same `route_id`, the committed route
stays in `verified_routes` while the newer contract remains in
`candidate_route_refreshes`; only selection commit promotes it and advances
`route_revision`.

```text
node: INITIALIZING -> READY -> DRAINING -> STOPPED
                   -> UNREADY (DB/object/keyring/schema/authorization failure)
reservation: ABSENT -> RESERVING -> ACTIVE -> RENEWING -> ACTIVE
                              -> EXPIRED | REVOKED | UNAVAILABLE
connection: DIALING -> PEER_VERIFIED -> TLS_VERIFIED -> ACTIVE -> CLOSED
```

Registry expiration withdraws readiness. Existing domain work still uses its
own fencing token; registry heartbeat alone cannot authorize task completion.

## 5.1 Desktop Transport Identity And Route Lease

```text
DesktopTransportIdentity
  scope: DIRECT_STATION(station_peer_id)
       | RELAY(relay_peer_id)
       | PROVISIONAL_ENDPOINT_ORIGIN(sha256(normalized_origin))
  key_ref: peers-touch.desktop.station-transport.v1/<scope_digest>
  peer_id
  ed25519_private_key: platform secure store only
  created_at

RouteLease
  station_peer_id
  lifecycle_generation
  route_id
  route_revision
  route_generation
  node_peer_id
  relay_peer_id?
  addresses[]
  inner_tls_spki_sha256?
  traffic_class: INTERACTIVE | REALTIME | BULK
  cancellation

StationRequest
  method
  path_and_query
  headers
  body_stream
  admission_deadline
  body_deadline
  traffic_class
  replay_policy: SAFE_READ | IDEMPOTENT(key) | NEVER

StationResourceRef
  station_peer_id
  lifecycle_generation
  path_and_query
  content_identity?

ExternalResourceUrl
  absolute_url

StationTransportState
  CREATED -> RUNNING -> DRAINING -> STOPPED
                     -> FAILED
```

Transport identity is endpoint-scoped and persisted for the installation. It is
not an Actor identity, Station identity, Session credential or device
concurrency class. A normal restart retains the key for the same verified
endpoint so a source-bound private Relay permit can identify the same transport
caller. Different Relay PeerIDs receive different transport keys. A provisional
endpoint-origin scope can be promoted only after the signed endpoint role and
PeerID verify. A direct endpoint may then switch to Station-scoped identity;
private connection material selects Relay scope before discovery.

Station Access is the sole producer of `RouteLease`. Transport may reject or
cancel a lease but cannot select or persist another route. A lifecycle-generation
change invalidates every prior lease. A route-revision change invalidates the
affected route sessions without changing Access scope.

The command queue, active route sessions and per-session HTTP/2 streams are
finite. Admission failure returns `OVERLOADED`; shutdown and lease revocation
return `CANCELLED` or `STALE_ROUTE`. A mutation interrupted after submission
returns `AMBIGUOUS_OUTCOME` unless its accepted idempotency policy authorizes a
replay. Admission capacity remains owned until the response body reaches EOF,
is dropped, is cancelled or is terminated by its body deadline. The shorter
admission deadline never truncates an accepted long-lived SSE response.

`StationResourceRef` is transport-independent and cannot be serialized as the
active Direct/Relay origin. Native materialization uses `StationRequest`.
WebView projection creates an app-local opaque URI bound to the same Station and
lifecycle generation. `ExternalResourceUrl` is never fetched through a
Station route and retains its own URL/security policy.

## 6. Durable Events And Device Isolation

Events owner extends its own proto/persistence model:

```text
ActorEventSequence
  station_peer_id / actor_ptid: unique
  last_committed_sequence: uint64

DurableEvent
  station_peer_id / actor_ptid / sequence: unique
  event_id: opaque encoding of durable sequence
  target_device_id: nullable means all actor devices
  payload: canonical StreamEvent protobuf
  deduplication_key: domain event identity
  created_at

DeviceStreamLease
  actor_ptid / device_id / window_id: unique
  owner_node_peer_id / incarnation / fencing_token / expires_at
```

Sequence allocation and event insert happen under the Actor sequence row lock
in the emitting domain transaction. Multiple Actor rows are locked in sorted
identity order. Rollback creates no committed event/cursor gap. Separate numeric
sequence controls database ordering; clients keep `event_id` opaque.

Notification is an after-commit wake containing a bounded Actor/high-water hint.
A lost wake is repaired by bounded reconciliation against the log. Subscribe
validates its durable device lease, captures the high-watermark and replays
strictly after its cursor through that watermark before live continuation.
Target filtering occurs before delivery; scanned sequence progress must advance
even over events for another device, without exposing their payload.

Duplicate delivery is allowed at the transport boundary; client/domain dedup
ensures one effect. Cursor beyond the current head is invalid; retained-log gaps
emit canonical Resync/cold recovery. Ephemeral typing/presence notifications do
not replace the durable resume cursor.

## 7. Domain Execution And Object Storage

```text
DomainLease
  domain_resource_key: unique active ownership
  owner_node_peer_id / incarnation
  fencing_token: monotonically increased on every acquire/takeover
  heartbeat_at / expires_at: database time
  status: HELD | RELEASED
```

Agent's existing ExecutorLease and OSS's lock port implement this requirement;
there is no parallel framework job model. Renew/release/complete check owner,
incarnation, token and unexpired database deadline. Takeover locks the resource
row and advances its token. A resumed stale worker cannot commit after takeover.
Recovery scans only expired leases and reconciles domain state transactionally.
Non-idempotent external effects retain interrupted/ambiguous outcomes.

OSS keeps metadata/quota/audit in shared PostgreSQL and bytes in a shared backend.
Object upload/read/delete/GC remain OSS-authorized operations. A GC claim records
the immutable object generation plus fencing token and atomically revalidates
zero references. New references cannot attach to a deleting generation; replacement
upload uses new physical generation bytes. Delete is idempotent for the claimed
generation, so a paused old worker cannot delete a replacement incarnation.
Storage migration verifies digest, metadata coverage and readability before
publication; it neither creates another Station nor exposes private data through
a node URL. DB fencing alone does not fence an unfenced storage API.

## 8. Errors And Projections

Transport projects typed unavailable, revoked, overloaded, limit-exhausted,
timeout, protocol-error and cancelled outcomes. Business errors stay inside TLS.
Role mismatch, malformed delegation and schema/keyring mismatch fail before
readiness. Generated Go/Rust/TS bindings derive only from canonical Model source.
No custom tunnel data/cancel frames or JSON transport-message header model remain
in the completed cut.

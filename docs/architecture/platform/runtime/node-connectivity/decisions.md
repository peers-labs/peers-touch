# Node Connectivity - Decisions

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-10 | **Updated**: 2026-10-11
> **Owner**: Architecture Team

## Decision Index

| ID | Decision | Status |
|---|---|---|
| NCP-D01 | One connectivity architecture owner | accepted |
| NCP-D02 | Station / Relay roles; ingress inside existing Frame | accepted |
| NCP-D03 | Standard Circuit v2 plus Station-terminated TLS | accepted |
| NCP-D04 | Relay owns transport admission only | accepted |
| NCP-D05 | Logical Station identity independent from Node PeerID | accepted |
| NCP-D06 | Enrollment binds node delegation and revocation epoch | accepted |
| NCP-D07 | Authorized node signs route and TLS SPKI | accepted |
| NCP-D08 | Library wire; generated control; finite resource limits | accepted |
| NCP-D09 | Transport callers do not imply business authorization | accepted |
| NCP-D10 | Atomic standard-transport cut; canonical HTTP APIs retained | accepted |
| NCP-D11 | Linux/POSIX Relay service hosting | accepted |
| NCP-D12 | One Host per process with borrowed consumers | accepted |
| NCP-D13 | Shared state is mandatory for cluster readiness | accepted |
| NCP-D14 | Durable ordered event replay across nodes | accepted |
| NCP-D15 | Domain-owned fenced leases and safe recovery | accepted |

These target decisions passed the architecture review recorded in
`integration.md`. Implementation and product proof remain outstanding.
Current source is not described as already implementing these decisions.

## NCP-D01: One Connectivity Architecture Owner

**Status**: accepted
**Date**: 2026-10-11

### Context
Client access and Station peer delivery consume the same reachability mechanism.
### Decision
This module owns identity-to-node authorization, routes and transport.
Access owns user/session lifecycle; Federation owns membership and peer policy.
### Rationale
One wire owner prevents divergent security and lifecycle implementations.
### Alternatives Considered
Transport owned by Access or Federation duplicates the other caller's contract.
### Consequences
Domains reference this module and keep their own state, APIs and authorization.

## NCP-D02: Two Roles And Existing Frame Ingress

**Status**: accepted
**Date**: 2026-10-11

### Context
Station already has server/transport registration; another service adds no
business authority or required network boundary.
### Decision
Only `station` and `relay` roles exist. Station's Frame accepts standard streams
and forwards through its canonical handler registry; no Gateway service is added.
### Rationale
N=1 needs no extra process; N>1 duplicates Station nodes, not an ingress tier.
### Alternatives Considered
Standalone Gateway adds deployment, auth propagation and another failure point.
### Consequences
Ingress lifecycle stays inside Station; Relay remains a strict role allowlist.

## NCP-D03: Circuit V2 And Station TLS

**Status**: accepted
**Date**: 2026-10-11

### Context
Current WSS/mount framing is self-owned; standard Circuit supports secure streams.
### Decision
Direct and relayed libp2p streams carry TLS 1.3/HTTP2 to Frame ingress, which
streams into the existing loopback Hertz router. The delegated node SPKI is
verified before credentials; no handler registry is copied.
### Rationale
Relay cannot inspect HTTP, while existing application protocols remain intact.
### Alternatives Considered
Transparent forwarding loses confidentiality; a new command protocol expands
every business consumer; bespoke crypto creates unnecessary review obligations.
### Consequences
Nested security costs framing/handshakes. HTTP2 streaming parity must be proven.

## NCP-D04: Relay Admission Only

**Status**: accepted
**Date**: 2026-10-11

### Context
Relay compromise must not grant Actor, Session or Federation authority.
### Decision
Relay owns its enrollment, grants, ACL, reservations, quotas and discovery.
It never parses decrypted application requests or emits business events.
### Rationale
The trust boundary limits compromise to availability and transport metadata.
### Alternatives Considered
Relay routing by method/topic leaks domain information and duplicates policy.
### Consequences
Relay cannot enforce encrypted per-business quotas; Station must enforce them.

## NCP-D05: Logical Station And Independent Nodes

**Status**: accepted
**Date**: 2026-10-11

### Context
One Host key cannot represent concurrent physical peers without identity conflict.
### Decision
Keep `station_peer_id` as logical identity derived from a separate root key.
Each node, including N=1, owns a unique transport key and root authorization.
### Rationale
Station/Actor/cache scope survives node addition, failover and route rotation.
### Alternatives Considered
Shared PeerID causes connection collision; node identity as business identity
turns cluster membership into account migration.
### Consequences
An operator signing boundary is required. Root change is explicit identity replacement.

## NCP-D06: Delegated Enrollment And Epoch

**Status**: accepted
**Date**: 2026-10-11

### Context
Circuit authenticates PeerID, not membership in a logical Station.
### Decision
Enrollment validates root-to-node authorization and node key possession.
Atomic invite consume creates authorization epoch and admission records.
Renewal retains epoch; revocation advances it and denies stale credentials.
### Rationale
Proof-of-possession prevents identity claims; epoch fences removed nodes.
### Alternatives Considered
Trusting headers is forgeable; deleting a row leaves issued credentials usable.
### Consequences
Offline clients have bounded certificate-expiry exposure, not instant global revocation.

## NCP-D07: Signed Node Routes

**Status**: accepted
**Date**: 2026-10-11

### Context
Relay discovery cannot authorize a destination on the Station's behalf.
### Decision
An authorized node signs logical Station, node PeerID, Relay PeerID, route,
authorization epoch, capability digest, TLS SPKI and bounded lifetime.
### Rationale
Clients verify destination independently of Relay.
### Alternatives Considered
Relay-signed destination or hostname-only trust permits endpoint substitution.
### Consequences
Route and TLS rotation are coordinated. Delegation verification adds control data.

## NCP-D08: Standard Wire And Finite Limits

**Status**: accepted
**Date**: 2026-10-11

### Context
Pinned Circuit defaults are 2 minutes and 128 KiB per direction, unsuitable for
the intended SSE/file workload without explicit configuration.
### Decision
Use library Circuit framing, generated protobuf control and finite connection,
stream, memory, bandwidth and request limits. Bulk and realtime use separate budgets.
### Rationale
Standard wire removes custom transport ownership; explicit budgets prevent outages.
### Alternatives Considered
Infinite limits invite exhaustion; default limits cause routine connection resets.
### Consequences
Workload configuration must be evaluated; no capacity or performance claim is implied.

## NCP-D09: Separate Transport And Domain Authorization

**Status**: accepted
**Date**: 2026-10-11

### Context
Native clients and Station peers share transport with different domain authority.
### Decision
Relay ACL validates public or source-bound private admission. Station validates
Session/Access or typed Federation peer policy inside encrypted HTTP.
### Rationale
Connectivity membership cannot become Federation or user membership.
### Alternatives Considered
One generic bearer credential collapses audience and revocation boundaries.
### Consequences
Private Circuit admission needs a prior control exchange bound to source PeerID.

## NCP-D10: One Atomic Transport Replacement

**Status**: accepted
**Date**: 2026-10-11

### Context
The authorized goal replaces the self-owned data plane without compatibility baggage.
### Decision
Canonical HTTP paths, protobuf business payloads and SSE remain.
All direct/Relay native and Federation consumers switch together; custom WSS,
mount framing, heartbeat/reconnect and bespoke transport-message consumers are deleted.
### Rationale
One atomic cut prevents two data planes and limits business change.
### Alternatives Considered
Dual running or a runtime fallback retains a second truth; bulk candidate copying
imports unrelated changes and unsupported business protocol changes.
### Consequences
Older incompatible clients fail explicitly. Rollback is source/deployment revert.

## NCP-D11: Linux/POSIX Relay Host

**Status**: accepted
**Date**: 2026-10-11

### Context
Relay supervision, secrets, TLS, network policy and evidence already have one host owner.
### Decision
Retain Linux/POSIX hosting. Windows/Desktop and Mobile remain clients;
Station host support is separately governed.
### Rationale
Transport replacement does not require another service-host contract.
### Alternatives Considered
Dormant Windows Relay hosting creates an unverified security/operations branch.
### Consequences
Circuit listeners and control TLS change the existing deployment in place.

## NCP-D12: One Host Per Process

**Status**: accepted
**Date**: 2026-10-11

### Context
Registry already accepts a shared Host, but bootstrap/client constructors still exist.
### Decision
The composition root owns Host/DHT/resource manager. All adapters borrow them;
one owner closes them after dependent components drain.
### Rationale
One PeerID and network policy per process prevents conflicting advertised identities.
### Alternatives Considered
Independent Hosts per plugin duplicate listeners, keys, reconnect and shutdown.
### Consequences
Constructor/close ownership must change across every actual consumer.

## NCP-D13: Cluster Readiness Requires Shared Truth

**Status**: accepted
**Date**: 2026-10-11

### Context
Two processes against local object bytes or independent auth material do not make HA.
### Decision
N>1 requires shared PostgreSQL, object backend, Access keyring, node registry,
schema compatibility and cluster-safe enabled domain owners.
### Rationale
Any ready node must read and authorize the same committed user state.
### Alternatives Considered
Sticky routing merely hides local state; a `clustered=true` switch cannot migrate owners.
### Consequences
Local-to-shared storage conversion is an explicit verified maintenance operation.
Database/object-store HA and cross-region replication are outside this module.

## NCP-D14: Shared Durable Event Order

**Status**: accepted
**Date**: 2026-10-11

### Context
Current live fanout is local; persisted events omit target device and sort local ULIDs.
### Decision
Events owner allocates transactionally ordered per-Actor cursors, persists target
device and uses wake hints plus durable replay on all subscriber nodes.
### Rationale
A missed notification cannot lose committed data or leak device-specific events.
### Alternatives Considered
Process ULIDs plus shared DB do not define commit order; Relay pubsub leaks ownership.
### Consequences
Per-Actor sequencing serializes that actor's durable emissions. Replay is bounded;
retention gaps invoke canonical cold recovery, never silent cursor advancement.

## NCP-D15: Domain-Owned Fencing

**Status**: accepted
**Date**: 2026-10-11

### Context
Agent startup scans all running steps; OSS explicitly injects an in-memory lock.
### Decision
Extend existing domain lease/lock ports with node incarnation and monotonic fencing.
Recovery claims only expired ownership, and all durable completion checks its token.
### Rationale
Another healthy node must survive peer boot, pause, partition and takeover.
### Alternatives Considered
Global RUNNING settlement or node-registry heartbeat alone does not fence stale writes.
### Consequences
External side effects still need idempotency or an ambiguous outcome; no exactly-once
provider guarantee follows from a database lease. OSS claims immutable generations
transactionally, so stale deletes cannot remove replacement bytes.

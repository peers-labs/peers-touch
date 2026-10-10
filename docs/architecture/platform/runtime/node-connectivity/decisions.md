# Node Connectivity - Decisions

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-10 | **Updated**: 2026-10-10
> **Owner**: Architecture Team

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| NCP-D01 | Node Connectivity is the only Relay protocol owner | accepted |
| NCP-D02 | Station and Relay share one binary with explicit roles | accepted |
| NCP-D03 | End-to-end TLS opaque tunnel is the only Relay data plane | accepted |
| NCP-D04 | Relay has no Station, Federation, or business authority | accepted |
| NCP-D05 | Station identity is independent from route | accepted |
| NCP-D06 | Enrollment binds host-key proof and generation revocation | accepted |
| NCP-D07 | Station signs every Relay route and inner TLS SPKI | accepted |
| NCP-D08 | Relay frames are bounded protobuf without HTTP metadata | accepted |
| NCP-D09 | Client and Station-peer callers use separate scopes | accepted |
| NCP-D10 | Circuit Relay/libp2p replacement is not a parallel current architecture | accepted |
| NCP-D11 | Relay service hosts use Linux/POSIX only | accepted |

## NCP-D01: Node Connectivity Is The Only Relay Protocol Owner

**Status**: accepted
**Date**: 2026-10-10

### Context

Station Access and Federation both described enrollment, route attestation,
tunnel frames, runtime role and resource limits. Two active definitions make
protocol ownership and change impact ambiguous.

### Decision

`docs/architecture/platform/runtime/node-connectivity/` exclusively owns Node
reachability and Relay internals. Station Access owns user/session lifecycle and
consumes verified routes. Federation owns governance and peer business
authorization and consumes authenticated transport.

### Rationale

One transport owner prevents protocol and security drift while preserving the
three-layer business boundaries.

### Alternatives Considered

- Keep protocol copies synchronized: rejected because they inevitably diverge.
- Move Relay into Federation: rejected because client access also uses Relay.
- Move Relay into Station Access: rejected because Station-to-Station transport
  is not a client login concern.

### Consequences

Other active modules may state required outcomes and caller-specific policy but
must reference this module for wire, credentials, role composition and limits.

## NCP-D02: Station And Relay Share One Binary With Explicit Roles

**Status**: accepted
**Date**: 2026-10-10

### Context

A separate Relay repository would duplicate release, crypto, Model and runtime
governance. Loading the full Station surface on an Internet-facing Relay would
expose unrelated business handlers.

### Decision

The same binary supports explicit `station` and `relay` roles.
`PEERS_NODE_ROLE` is resolved once. The Relay allowlist loads only Relay
capabilities and rejects Touch, application subservers and unknown plugins.

### Rationale

Shared source avoids protocol forks; deny-by-default role composition limits the
public attack surface.

### Alternatives Considered

- Separate Relay service/repository: rejected as a second implementation owner.
- Full Station process plus Relay feature flag: rejected as an unsafe denylist.
- Implicit role from ports or container name: rejected as non-auditable.

### Consequences

Missing role or production security inputs stop startup. A future hybrid role
requires its own explicit decision and allowlist proof.

## NCP-D03: End-To-End TLS Opaque Tunnel Is The Only Relay Data Plane

**Status**: accepted
**Date**: 2026-10-10

### Context

Transparent Relay forwarding exposed method, path, headers, Authorization and
body. Outer TLS alone still terminates plaintext at Relay.

### Decision

Caller and Station establish TLS 1.3 inside the Relay byte stream. Relay
forwards only bounded ciphertext and tunnel lifecycle frames. Station owns the
inner TLS ingress and canonical router.

### Rationale

Standard TLS provides confidentiality, integrity and Station authentication
without creating a new business protocol or trusting Relay with credentials.

### Alternatives Considered

- Transparent reverse proxy: rejected because Relay sees credentials/content.
- Outer TLS only: rejected because Relay remains the plaintext endpoint.
- Custom AEAD/Noise protocol: rejected without an independent crypto review.

### Consequences

Route attestation must pin inner TLS SPKI. TLS rotation and route publication
are one lifecycle. The Relay cannot optimize by interpreting business payload.

## NCP-D04: Relay Has No Station, Federation, Or Business Authority

**Status**: accepted
**Date**: 2026-10-10

### Context

Relay is an Internet-facing availability service. Letting it decide Access,
Federation membership or business routing would turn compromise of transport
infrastructure into compromise of shared truth.

### Decision

Relay owns endpoint identity, enrollment, route directory, mount/tunnel
lifecycle, quotas, metrics and operator policy only. Station remains identity,
Access, Session and business authority. Federation remains membership, Ledger
and peer-policy authority.

### Rationale

The trust boundary limits Relay compromise to availability and observable
connection metadata.

### Alternatives Considered

- Central Station registry at Relay: rejected as centralized authority.
- Relay business fan-out by path/topic: rejected as domain ownership leakage.

### Consequences

Relay cannot mint Actor/Session/Federation claims or infer membership from a
mount.

## NCP-D05: Station Identity Is Independent From Route

**Status**: accepted
**Date**: 2026-10-10

### Context

URL-keyed state treats the same Station reached directly or through Relay as
different identities and can duplicate Session/cache/runtime scope.

### Decision

`station_peer_id` derived from the Station host key is the identity key.
Direct origin, Relay origin, route ID and route generation are replaceable route
candidates. Route changes rebuild transport only; Station identity changes
require explicit replacement.

### Rationale

Identity/location separation supports private Station reachability without
moving business trust to Relay.

### Alternatives Considered

- URL identity with aliases: rejected because aliases retain split truth.
- Relay PeerID as Station identity: rejected because Relay owns no Station state.

### Consequences

ActorRef and federated handle must never be reconstructed from request host,
proxy or tunnel endpoint.

## NCP-D06: Enrollment Binds Host-Key Proof And Generation Revocation

**Status**: accepted
**Date**: 2026-10-10

### Context

An invite or claimed PeerID cannot prove possession of the Station private key.
Deleting a mount row without fencing credentials permits stale reconnect.

### Decision

Relay challenges the enrolling Station. Station signs the challenge and Relay
binding with its host key; Relay derives `station_peer_id`. Invite consume and
mount generation creation are atomic. Credentials carry issuer, audience,
scope, JTI, expiry, Station PeerID and generation.

### Rationale

Proof-of-possession prevents identity spoofing; generation makes rotation and
revocation mechanically enforceable.

### Alternatives Considered

- Trust a request header PeerID: rejected as forgeable.
- Shared Station JWT secret: rejected because roles and audiences collapse.
- Row deletion only: rejected because existing credentials survive.

### Consequences

Invite plaintext is returned once and persisted only as a digest. Revocation
closes streams, rejects refresh/reconnect and withdraws routes.

## NCP-D07: Station Signs Every Relay Route And Inner TLS SPKI

**Status**: accepted
**Date**: 2026-10-10

### Context

Relay can describe reachability but cannot vouch for the Station business
identity without becoming a trust authority.

### Decision

Each route attestation is signed by the Station host key and binds Station
PeerID, Relay PeerID, route ID, generation, inner TLS SPKI, capability digest,
visibility and lifetime.

### Rationale

Callers can verify route and destination independently of Relay.

### Alternatives Considered

- Relay-signed Station directory: rejected because Relay could substitute a
  destination.
- Web PKI hostname only: rejected because URL is not Station identity.

### Consequences

Route or TLS key rotation requires a new signed attestation. Stale generation
cannot establish a new tunnel.

## NCP-D08: Relay Frames Are Bounded Protobuf Without HTTP Metadata

**Status**: accepted
**Date**: 2026-10-10

### Context

Request/response frames and header maps let Relay inspect or mutate application
semantics and create unbounded allocation risk.

### Decision

The only outer messages are generated `Open`, `Opened`, `Data`, `Cancel` and
`Close` frames. Data is opaque ciphertext. Size, sequence, byte, rate,
concurrency, deadline and queue bounds are checked before forwarding.

### Rationale

The smallest wire surface makes opacity and resource use auditable.

### Alternatives Considered

- Bounded HTTP metadata frames: rejected because Relay still learns business
  routing and credentials.
- Untyped byte envelope with ad hoc JSON metadata: rejected as non-canonical.

### Consequences

Relay errors describe tunnel lifecycle only. Station/application errors remain
inside inner TLS.

## NCP-D09: Client And Station-Peer Callers Use Separate Scopes

**Status**: accepted
**Date**: 2026-10-10

### Context

Client access and Federation peer traffic share reachability but have different
identities and authorization owners.

### Decision

`CLIENT_ACCESS` uses a public route or Station connection grant and is
authorized by Station Access after inner TLS. `FEDERATION_PEER` requires the
caller Station's current mount credential with peer-tunnel scope and is
authorized by the target Station's typed peer capability/domain policy.

### Rationale

Shared transport avoids duplicate data planes without conflating business
authorization.

### Alternatives Considered

- One generic bearer token: rejected because caller classes and revocation
  semantics differ.
- Federation policy authorizes clients: rejected as a cross-domain privilege
  escalation.

### Consequences

Purpose mismatch, grant on peer traffic, or absent peer scope fails before any
Station request is forwarded.

## NCP-D10: Circuit Relay/Libp2p Replacement Is Not A Parallel Current Architecture

**Status**: accepted
**Date**: 2026-10-10

### Context

An architecture-v2 candidate proposed one libp2p Kernel, Circuit Relay v2,
native Rust swarms, DCUtR, a new Station command protocol and broad naming
migration. That package also deleted the implemented WSS/inner-TLS tunnel.

### Decision

The candidate is not merged as a second target. Current Relay stays on the
accepted WSS + inner TLS opaque tunnel. One-kernel, Circuit Relay, DCUtR,
client-wide libp2p and naming changes remain outside this architecture.

A future replacement requires a new accepted product/security architecture,
an end-to-end migration plan, comparative runtime proof, and one atomic removal
of the current tunnel. It cannot arrive as a compatibility path.

### Rationale

The candidate contradicts `SAL-D09` and Federation `D-15`, replaces verified
code with unproven topology, and expands far beyond Relay completion.

### Alternatives Considered

- Merge both data planes: rejected as permanent split-brain.
- Rename current tunnel as a compatibility adapter: rejected as hidden debt.
- Bulk-copy the candidate worktree: rejected because it contains unrelated
  cross-product edits and destructive deletions.

### Consequences

Current source, Gates and active docs use one Relay protocol. Git history and
the candidate worktree remain research evidence, not active truth.

## NCP-D11: Relay Service Hosts Use Linux/POSIX Only

**Status**: accepted
**Date**: 2026-10-10

### Context

Relay is a long-running infrastructure service with an outer TLS boundary,
isolated secrets, process supervision, logs, metrics and capacity controls.
Maintaining a Windows Relay adapter, deployment profile and evidence path would
create a second service-host contract for the same transport role.

### Decision

Relay service hosts use the reviewed Linux/POSIX runtime contract. Production,
development simulation and Acceptance share that contract. The canonical
deployment uses Docker Compose with an NGINX TLS terminator and a loopback-only
Relay control upstream.

Windows has no Relay service adapter, deploy profile, compile gate or
service-host evidence. Windows Desktop remains a supported client and proves
its Relay journey against the Linux Relay. Windows Station support is governed
separately and does not expand the Relay host matrix.

### Rationale

One service-host contract keeps TLS, secret ownership, supervision and
operational evidence consistent and prevents an unexercised security branch.

### Alternatives Considered

- Support Linux and Windows Relay hosts: rejected as duplicate deployment and
  security ownership.
- Keep dormant Windows Relay code: rejected because dead paths remain
  maintainable and invokable.
- Use Windows for local Relay simulation only: rejected because simulation
  must preserve production runtime behavior.

### Consequences

Current plans, profiles, deploy dispatch and Acceptance attach only to
Linux/POSIX Relay runtimes. Windows-native runtime tooling rejects the Relay
role. Reintroducing another Relay host platform requires a new architecture
decision and complete deployment, security and lifecycle proof.

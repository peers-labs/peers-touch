# Node Connectivity - Integration

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-10 | **Updated**: 2026-10-10
> **Owner**: Architecture Team

---

## 1. Owner Mapping

| Concern | Owner | Node Connectivity input/output |
|---|---|---|
| Station Access | Identity and Access | consumes verified endpoint, route and tunnel; owns Access/Session/scope |
| Federation | Federation app owner | consumes authenticated peer transport; owns membership/Ledger/policy |
| Station host identity | Station frame identity owner | signs endpoint and route statements |
| Relay control plane | Node Connectivity | enrollment, mount, grant, route, revoke, metrics |
| Relay data plane | Node Connectivity | bounded ciphertext tunnel only |
| Station canonical router | Station frame/server | receives inner TLS plaintext after Station termination |
| Business domains | Station app owners | remain transport-independent |

## 2. Station Access Integration

Station Access accepts one input and ultimately pins one `station_peer_id`.
Node Connectivity supplies:

- signed endpoint role and identity;
- direct or Relay route candidates;
- Station-signed route attestation and optional connection grant;
- typed tunnel availability/failure;
- inner TLS connection that terminates at the same Station router.

Station Access retains:

- user-visible selection/confirmation;
- Access Gate and canonical Session;
- Station/Actor/Device/lifecycle scope;
- route-aware client binding and recovery UI;
- rule that route changes do not replace Station identity.

It does not define enrollment credentials, mount state, tunnel frames or Relay
resource limits.

## 3. Federation Integration

Federation selects a target `station_peer_id` and constructs a typed peer
request. The transport adapter chooses direct delivery or a
`FEDERATION_PEER` tunnel based on current route availability.

The target Station validates:

- authenticated caller Station identity;
- typed peer capability;
- Federation/domain scope, membership and authorization;
- idempotency, replay and receiver semantics.

Relay validates only caller mount scope, target route/generation and resource
admission. Relay mount is never Federation membership.

## 4. Runtime Composition

```text
PEERS_NODE_ROLE=station
  -> Station application + Touch
  -> explicit Station plugin allowlist
  -> optional relay-client

PEERS_NODE_ROLE=relay
  -> Relay plugin only
  -> no Touch
  -> no Station application subservers
```

Production Relay requires TLS certificate/key, Relay signing key, operator
trust policy and quotas. The same image/binary is retained; role is runtime
configuration, not a separate build product.

Relay service hosting uses the reviewed Linux/POSIX Compose contract only.
NGINX terminates outer TLS and proxies to an explicit loopback listener in the
Relay network namespace. Windows runtime dispatch rejects `relay`; Windows
Desktop remains a client of the Linux Relay.

## 5. Credential Separation

| Credential | Accepted at | Rejected at |
|---|---|---|
| Relay operator credential | admin/metrics routes | mount, tunnel, Station APIs |
| Relay mount credential | heartbeat/rotate/route/grant/peer tunnel scopes | operator routes, Station APIs |
| Station connection grant | client tunnel open only | operator/mount routes, Station APIs |
| Station Session | inside inner TLS at Station | Relay outer control/data plane |
| Federation peer authorization | target Station peer capability | Relay business policy |

Keys, issuer, audience and scope are distinct. Redaction treats all raw
credential/grant values as sensitive.

## 6. Architecture-V2 Compatibility Ledger

The source architecture-v2 worktree is design input, not a merge base. Its
disposition is:

| Candidate concept | Disposition | Current truth |
|---|---|---|
| One Node Connectivity architecture owner | adopted | this module |
| Station/Relay same binary with explicit capability profile | adopted with current roles | `station` and `relay`; no hybrid role |
| Relay has no business authority | adopted | NCP-D04 |
| Station identity is independent from route | adopted | NCP-D05 |
| Federation and client policies are separate | adopted | NCP-D09 and caller matrix |
| Bounded generated transport contracts | adopted for Relay tunnel | `relay_transport.proto`; canonical Station APIs remain inside TLS |
| Circuit Relay v2 as only data plane | rejected | WSS + inner TLS opaque tunnel |
| One new libp2p Kernel/Host/DHT cutover | deferred outside current scope | no claim or second target |
| Native Desktop/Mobile libp2p swarms and Station command protocol | rejected for this merge | existing native direct/Relay adapters and canonical Station router |
| DCUtR and multi-Relay circuit failover | deferred | require separate product/runtime design |
| Global `node_name` hard rename | rejected for this merge | no unrelated naming/schema migration |
| Bulk deletion/copy from the source worktree | rejected | semantic extraction only |

No rejected or deferred item is represented by a compatibility shim, dormant
implementation, feature flag or second active architecture document.

## 7. Removed Legacy

Current production source must contain no live:

- `/relay/forward/*` route;
- `relay-client-token` forwarding credential;
- request/response Relay frame;
- forwarded target Authorization/header map;
- Relay-side HTTP/business payload parser;
- unauthenticated Station PeerID claim;
- Relay role business subserver;
- active architecture copy of Relay wire/control internals outside this module.

Historical Git commits may retain those symbols. Active code, docs, registry
and knowledge cannot present them as current behavior.

## 8. Acceptance Integration

Formal proof is owned by the `station-access-relay-role` Suite environment:

```text
Provisioner
  -> builds exact source
  -> starts isolated Station and Relay roles on sixwin
  -> supplies opaque run-scoped capability to Gate
  -> owns tunnels, credentials and cleanup

relay-opaque-tunnel-e2e Gate
  -> attaches to prepared manifest
  -> verifies source contract
  -> invokes only verify-opaque-tunnel
  -> asserts inner TLS/SPKI/protocol/bounds/opacity
```

The Gate is never run directly because it intentionally cannot provision its
own raw runtime handles. A direct invocation without the provisioner capability
is a lifecycle error, not product evidence.

## 9. Evidence Boundaries

Focused Go/unit checks prove source behavior only. A formal Acceptance result
requires:

- exact source/artifact digest;
- real Station and Relay roles;
- a live tunnel carrying a Station request through inner TLS;
- Relay-side marker non-disclosure;
- bounded negative cases;
- cleanup receipt from the environment owner.

A passing source validator cannot substitute for the real Journey. A real
Journey on another source revision cannot prove the current revision.

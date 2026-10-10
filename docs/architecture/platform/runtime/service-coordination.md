# Service Coordination Map

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-07-24 | **Updated**: 2026-10-10
> **Owner**: Architecture Team

---

## 1. Document Scope

This document defines startup dependencies, credential ownership and failure
isolation among Relay, Station, Desktop, Mobile and optional LiveKit runtimes.

It does not define:

- Relay protocols, enrollment, route attestation or tunnel framing; see
  [Node Connectivity](./node-connectivity/README.md);
- Station Access product/session behavior;
- Federation governance;
- deployment commands or host-specific runbooks.

## 2. Runtime Units

| Runtime | Responsibility | Identity/authority |
|---|---|---|
| Relay role | public discovery, mount control and opaque tunnel | Relay endpoint/operator authority only |
| Station role | business truth, Access Gate, persistence and Federation | Station host identity and domain authorities |
| Desktop | native client runtime and UI | device-local identity plus pinned Station |
| Mobile | native client runtime and UI | device-local identity plus pinned Station |
| LiveKit | optional shared group-media SFU | cluster media credentials |

Station and Relay are roles of one binary but run as separate process identities.
The current role set is `station | relay`; no hybrid role is implied.

## 3. Dependency DAG

```text
Relay role (optional for direct-only Station)
  -> Station relay-client enrolls/mounts
  -> Station publishes signed Relay route

Station role
  -> signed endpoint identity
  -> Access Gate and canonical APIs
  -> optional Federation peer delivery
  -> optional LiveKit room/token owner

Desktop / Mobile
  -> verify one Station identity
  -> connect directly or through a verified Relay route
  -> complete Access Gate
  -> start scope-bound runtimes

LiveKit (optional)
  <- Station issues membership-checked room credentials
  <- clients connect directly for media
```

Relay is not globally required before Station. A Station may start and serve
direct routes while Relay enrollment retries. A route is published only while
its mount/generation is current.

## 4. Credential Ownership

| Artifact | Issuer/owner | Consumer | Boundary |
|---|---|---|---|
| Station host key | Station | endpoint/route verifiers | Station identity and signatures |
| Relay signing key | Relay | Station/client endpoint verifiers | Relay endpoint/control identity |
| Relay operator credential | operator policy | Relay admin/metrics | never accepted as Station Session |
| Relay mount credential | Relay control plane | Station relay-client | mount scopes only |
| Station connection grant | Station | Relay client tunnel admission | route/generation/use bounded |
| Station Session | Station Access Gate | Station canonical APIs | remains inside inner TLS |
| Federation peer authorization | source/target Station owners | typed peer capabilities | never interpreted by Relay |
| LiveKit token | Station group-call owner | client media SDK | room/media only |

No credential crosses into another row's authority. Relay raw credentials are
never exposed to Client Web/UI.

## 5. Startup Contract

### Relay

```text
resolve PEERS_NODE_ROLE=relay
  -> validate public origin/TLS/signing/operator/quota inputs
  -> initialize Relay-owned storage
  -> expose health/discovery/control/tunnel allowlist
  -> ready
```

### Station

```text
resolve PEERS_NODE_ROLE=station
  -> initialize Station data and domain owners
  -> expose signed identity and canonical APIs
  -> optionally enroll/mount with configured Relay
  -> publish route only after mount + attestation succeed
  -> ready
```

### Client

```text
load one endpoint input
  -> verify endpoint/Station identity and route
  -> establish transport
  -> complete Access Gate
  -> activate Session scope
  -> start runtimes
```

Optional Relay or LiveKit failure cannot stop unrelated Station capabilities
unless the selected product action explicitly requires them.

## 6. Failure Isolation

| Failure | Required behavior |
|---|---|
| Relay unavailable at Station boot | Station remains direct-capable; mount retries boundedly |
| Relay mount revoked/expired | withdraw route; reject old generation; Station identity unchanged |
| Client Relay route unavailable | preserve Station binding and report typed route failure |
| Station unavailable | clients retain identity/binding and enter offline/retry state |
| LiveKit unavailable | group media unavailable; Station Access/Chat remain available |
| credential missing/wrong audience | fail startup or request before side effects |
| role missing/unknown | process fails before listener/storage side effects |

## 7. Resource Ownership

- Relay owns its listener, TLS material, mount/tunnel state and metrics.
- Station owns database, canonical APIs, relay-client mount and business state.
- Desktop/Mobile own local client processes, secure storage and projections.
- LiveKit owns media runtime resources.
- Acceptance provisioners own temporary runtime cells, credentials, tunnels and
  cleanup; Gates attach and assert only.

One owner releases each resource it creates. A Gate result is not a runtime
cleanup receipt.

## 8. Verification

- role allowlists prove Relay has no Station business routes;
- Node Connectivity formal Gate proves enrollment and opaque tunnel behavior;
- Station Access Journeys prove direct/Relay paths reach the same Station scope;
- Federation Journeys prove peer delivery has receiver-visible parity;
- LiveKit tests are independent from Relay evidence;
- all runtime manifests and cleanup receipts bind exact source/artifact
  identity.

# Service Coordination Map

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-07-24 | **Updated**: 2026-10-11
> **Owner**: Architecture Team

---

## 1. Document Scope

This document defines startup dependencies, credential ownership and failure
isolation among Relay, Station, Desktop, Mobile and optional LiveKit runtimes.

It does not define:

- Relay protocols, enrollment, route attestation or standard stream semantics; see
  [Node Connectivity](./node-connectivity/README.md);
- Station Access product/session behavior;
- Federation governance;
- deployment commands or host-specific runbooks.

## 2. Runtime Units

| Runtime | Responsibility | Identity/authority |
|---|---|---|
| Relay role | signed discovery, enrollment, Circuit reservation and ACL | Relay endpoint/operator authority only |
| Station role | Frame ingress, business truth, Access Gate, persistence and Federation | logical Station identity, authorized node and domain authorities |
| Desktop | native client runtime and UI | device-local identity plus pinned Station |
| Mobile | native client runtime and UI | device-local identity plus pinned Station |
| LiveKit | optional shared group-media SFU | cluster media credentials |

Station and Relay are roles of one binary but run as separate process identities.
The current role set is `station | relay`; no hybrid role is implied.

## 3. Dependency DAG

```text
Relay role (optional for direct-only Station)
  -> Station Relay control enrolls/reserves
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
delegation, admission epoch and reservation remain current.

## 4. Credential Ownership

| Artifact | Issuer/owner | Consumer | Boundary |
|---|---|---|---|
| Station root key | Station operator signing boundary | node authorization verifier | logical Station identity |
| Node key and root delegation | physical Station node | endpoint/route/TLS verifiers | unique Node PeerID and authorized ingress |
| Relay Host key | Relay | Station/client endpoint verifiers | Relay PeerID and endpoint/control identity |
| Relay operator credential | operator policy | Relay admin/metrics | never accepted as Station Session |
| Relay node credential | Relay control plane | Station Relay control | enrollment/reservation/control scopes only |
| Station connection grant | Station | Relay Circuit admission | source/destination/route/generation/use bounded |
| Station Session | Station Access Gate | Station canonical APIs | remains inside node-key-bound TLS |
| Federation peer authorization | source/target Station owners | typed peer capabilities | never interpreted by Relay |
| LiveKit token | Station group-call owner | client media SDK | room/media only |

No credential crosses into another row's authority. Relay raw credentials are
never exposed to Client Web/UI.

## 5. Startup Contract

### Relay

```text
resolve PEERS_NODE_ROLE=relay
  -> validate public libp2p address, Host identity, operator TLS/policy and Circuit quotas
  -> initialize Relay-owned storage
  -> create one Host/resource manager and Circuit ACL
  -> expose health/discovery/control/Circuit allowlist
  -> ready
```

### Station

```text
resolve PEERS_NODE_ROLE=station
  -> initialize shared Station data/keyring and domain owners
  -> create one unique-node Host and validate root delegation
  -> validate schema/object backing and domain cluster readiness
  -> expose signed identity and canonical APIs
  -> optionally enroll/reserve with configured Relay
  -> publish route only after reservation + attestation succeed
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
| Relay unavailable at Station boot | Station remains direct-capable; reservation retries boundedly |
| Relay admission revoked/expired | withdraw route; reject old epoch; Station identity unchanged |
| Client Relay route unavailable | preserve Station binding and report typed route failure |
| Station unavailable | clients retain identity/binding and enter offline/retry state |
| LiveKit unavailable | group media unavailable; Station Access/Chat remain available |
| credential missing/wrong audience | fail startup or request before side effects |
| role missing/unknown | process fails before listener/storage side effects |

## 7. Resource Ownership

- Relay owns Host/listeners, control TLS, enrollment/reservation/ACL and metrics.
- Station owns node Host, Frame ingress, canonical APIs, reservations and domain state.
- One logical Station's DB/object/keyring owners are shared by ready nodes; Events
  and domain leases govern cross-node delivery and recovery. DB partition prevents
  readiness/mutation; a peer node boot must not settle healthy foreign work.
- Desktop/Mobile own local client processes, secure storage and projections.
- LiveKit owns media runtime resources.
- Acceptance provisioners own temporary runtime cells, credentials, tunnels and
  cleanup; Gates attach and assert only.

One owner releases each resource it creates. A Gate result is not a runtime
cleanup receipt.

## 8. Verification

- role allowlists prove Relay has no Station business routes;
- Node Connectivity formal Gates prove delegation, enrollment, canonical streams,
  finite limits, renewal and revocation;
- Station Access Journeys prove direct/Relay paths reach the same Station scope;
- Federation Journeys prove peer delivery has receiver-visible parity;
- LiveKit tests are independent from Relay evidence;
- all runtime manifests and cleanup receipts bind exact source/artifact
  identity.

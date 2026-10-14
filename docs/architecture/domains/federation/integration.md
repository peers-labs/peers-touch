# Federation Architecture - 集成与映射

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-05-31 | **Updated**: 2026-10-10
> **Owner**: Architecture Team

---

## 1. Station App/Frame Boundary

| Layer | Responsibility | Forbidden |
|---|---|---|
| Station app | Federation lifecycle, membership, policy, role, Ledger and business authorization | Relay socket/read loop |
| Station frame Federation | typed peer transport port, locator, resolver and signing adapter | app policy truth |
| Node Connectivity | route, enrollment and authenticated opaque transport | Federation membership/business policy |

App may depend on frame ports. Frame cannot import app business owners or read
Federation policy tables to decide governance.

## 2. Station Access

[Station Access](../../platform/station/access/README.md) owns client access:

- one endpoint input and signed Station identity;
- one station-keyed route-aware binding;
- Access Gate, Session and Station/Actor/Device scope;
- Federation context consumption.

Federation does not create a second client registry, Session or access API.
Relay details are supplied by Node Connectivity.

## 3. Catalog And Resolver

```text
Federation membership/policy
  -> active member Station set
  -> federation-scoped Catalog
  -> ActorRef profile resolution
```

Route discovery and Federation Catalog differ:

- route discovery answers how a Station can currently be reached;
- Catalog answers which Actors are discoverable in one Federation;
- route/mount presence does not imply membership;
- request URL/Host cannot generate `ActorRef.acct`.

## 4. Typed Peer Delivery

```text
Federation/domain caller
  -> choose target station_peer_id
  -> build deterministic typed frame
  -> frame peer transport port
  -> Node Connectivity route
  -> target Station authenticates caller
  -> target Federation/domain policy
  -> receiver-owned commit/readback
```

Direct and Relay routes carry the same frame and produce the same typed
receiver disposition. Relay cannot select recipients, parse business payload,
mint Federation claims or convert connectivity into membership.

## 5. Credential Boundary

- Station host key proves Station identity.
- Federation peer authorization is minted/validated by Station owners.
- Relay operator/mount/grant credentials are Node Connectivity internals.
- Client Station Session belongs to Station Access and remains inside inner TLS.

No credential is accepted outside its issuer/audience/scope. Federation app
never receives raw Relay operator or mount credentials.

## 6. ActivityPub

ActivityPub remains a future interoperability layer. Any external activity that
would affect Federation governance must become a valid proposal and pass
Ledger policy. Transport reachability cannot directly mutate membership,
sequencer, role or policy.

## 7. Observability

Federation metrics may expose bounded:

- proposal/event/receiver outcomes;
- Ledger sequence/head/fork state;
- membership and policy decision classes;
- peer delivery result classes.

Transport metrics such as mounts, tunnels, bytes and rate limits belong to Node
Connectivity. Neither layer logs credentials, Authorization, decrypted payload,
Actor PII or high-cardinality raw route values.

## 8. Verification

- app/frame dependency checks remain one-way;
- all discovery/Catalog queries carry explicit Federation scope;
- peer receiver verifies caller identity, membership, policy and replay;
- direct and Relay delivery have receiver-visible parity;
- route/mount changes do not mutate Federation membership;
- Node Connectivity formal Gate proves transport opacity and cleanup;
- no active Federation document defines Relay frame, mount credential or role
  allowlist a second time.

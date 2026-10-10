# Node Connectivity - Module Layout

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-10 | **Updated**: 2026-10-10
> **Owner**: Architecture Team

---

## 1. Current Layout

```text
model/domain/
├── peer/
│   ├── station_identity.proto
│   └── access_endpoint.proto
└── federation/
    └── relay_transport.proto

apps/station/
├── frame/core/runtime/role/
│   ├── role.go
│   └── role_test.go
├── frame/core/plugin/native/subserver/
│   ├── relay/
│   │   ├── application/
│   │   ├── client/
│   │   ├── domain/
│   │   ├── infrastructure/
│   │   ├── protocol/
│   │   ├── handler_*.go
│   │   ├── stream.go
│   │   ├── tunnel_admission.go
│   │   └── websocket.go
│   └── relay-client/
│       ├── enrollment.go
│       ├── connection_material.go
│       ├── inner_tls.go
│       ├── peer_tunnel.go
│       └── subserver.go
└── frame/core/federation/
    ├── routes.go
    └── transport.go

tooling/acceptance/
├── environments/station-access-relay-role.yaml
├── provisioners/
│   ├── posix_service_runtime.py
│   └── station_access_relay_role.py
└── gates/station_access/relay_opaque_tunnel_e2e.py

tooling/docker/
├── compose.yml
└── relay-nginx.conf.template

tooling/scripts/deploy/
├── deploy.sh
├── posix_relay_runtime.py
└── windows_runtime.py
```

## 2. Responsibilities

| Path | Owns | Must not own |
|---|---|---|
| `model/domain/peer/` | signed endpoint, Station identity, route and connection material | runtime storage or UI |
| `model/domain/federation/relay_transport.proto` | opaque tunnel frame semantics | Federation governance payload |
| `runtime/role/` | one explicit process role and capability allowlists | business policy |
| `subserver/relay/domain/` | Relay identity, invite, mount, route and grant model | Station Session or Federation membership |
| `subserver/relay/application/` | enrollment, rotation, revocation, route/grant admission | payload forwarding details |
| `subserver/relay/infrastructure/` | Relay-owned persistence | Station/Federation tables |
| `subserver/relay/protocol/` | bounded mount-stream tunnel framing | HTTP/business metadata |
| `subserver/relay/handler_tunnel.go` | WSS admission and ciphertext forwarding | inner TLS or Station routing |
| `subserver/relay/stream.go` | mount stream, tunnel multiplexing, ordering/backpressure | blocking domain work in read loop |
| `subserver/relay-client/` | Station enrollment, mount, route publication and inner TLS ingress | Federation governance |
| `frame/core/federation/transport.go` | direct/Relay route adapter for typed peer delivery | Relay credential truth |
| Linux deploy/runtime adapters | Compose ownership, NGINX outer TLS, Relay secrets and exact-source inspection | business policy or Windows Relay dispatch |
| Windows runtime adapter | Windows Station deployment and explicit Relay-role rejection | Relay service hosting |
| Acceptance provisioner | exact-source Station/Relay runtime lifecycle and opaque capability injection | Gate assertions |
| Acceptance Gate | source contract and runtime tunnel assertions | provisioning or deployment |

## 3. Dependency Direction

```text
generated endpoint and tunnel contracts
  <- Relay domain/application
  <- Relay HTTP/WSS and mount-stream adapters
  <- Station relay-client
  <- Station Access or Federation caller adapters

Station/Federation business owner
  -> canonical router / typed capability
  -> direct transport or opaque Relay transport
```

Allowed:

- Relay application depends on its domain and repository ports.
- Relay framing depends on generated tunnel contracts and fixed limits.
- Station relay-client depends on Station host identity and canonical router.
- Federation transport depends on a narrow `RelayAccess` interface.
- Station Access consumes verified endpoint/route projections.

Forbidden:

- Relay imports Station application business subservers.
- Federation app manipulates tunnel maps, mount tokens or sockets.
- UI or business runtimes receive operator/mount credentials.
- Relay frame contains HTTP/business metadata.
- A second Relay data plane, fallback forward route or compatibility listener.

## 4. Generated Code

Proto changes start under `model/domain/`. Generated files follow existing
Model generation commands. Generated `.pb.go` or client bindings are not edited
manually and are not independent contract roots.

## 5. Operational Knowledge

The current implementation remains governed by:

- `docs/knowledge/invariants/relay-runtime-role-is-minimal.md`;
- `docs/knowledge/invariants/relay-readloop-discipline.md`.

Knowledge entries are not protocol truth. If implementation deletes the custom
mount stream in a future accepted replacement, those entries must be marked
`superseded-by` in the same atomic change.

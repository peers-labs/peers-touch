# Node Connectivity - Module Layout

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-10 | **Updated**: 2026-10-11
> **Owner**: Architecture Team

## 1. Existing Extension Points

```text
model/domain/
├── peer/station_identity.proto
└── peer/access_endpoint.proto

apps/station/frame/
├── peers.go
├── core/runtime/role/
├── core/plugin/native/
│   ├── node/native_init_top_comp.go
│   ├── relay/
│   ├── transport/securehttp/
│   ├── registry/
│   ├── federation/
│   └── subserver/
│       ├── bootstrap/
│       └── relay/
└── core/plugin/server/
    └── hertz/

apps/station/app/subserver/
├── events/
├── agent/infrastructure/persistence/executor_lease.go
├── agent/service/chat_task_service.go
└── oss/worker/

packages/
├── station-libp2p-http/
└── station-trust/

apps/desktop/src-tauri/src/infrastructure/
├── station_discovery.rs
├── station_registry.rs
└── station_transport.rs

apps/mobile/src-tauri/
tooling/acceptance/
tooling/docker/
tooling/scripts/deploy/
```

This inventory names current directories. New adapters are introduced inside
these owners when their vertical cut is implemented; this document does not
pretend an unimplemented directory already exists.

## 2. Target Responsibilities

| Owner | Responsibility | Forbidden ownership |
|---|---|---|
| Model peer contracts | root delegation, node identity, route and connection material | runtime storage and sockets |
| Model Relay control | enrollment, permits and generated operator messages | Circuit framing or HTTP business wire |
| Frame composition root | one Host/DHT/resource manager and lifecycle injection | application task scheduling |
| Native transport | secure direct/circuit dial and stream-backed connection | per-business command decoding |
| Native registry/bootstrap | signed route discovery and borrowed Host | constructing independent Hosts |
| Server ingress adapter | TLS/HTTP2 and streaming loopback into existing Hertz router | new Gateway authority or copied handler registry |
| Relay domain/application | enrolled node, grant and ACL projections | Actor/Session/Federation membership |
| Relay library adapter | Circuit service and public resource/admission APIs | custom mount/tunnel reader |
| Station Relay control | enrollment, standard reservation and signed route publication | custom transport heartbeat/reconnect |
| Federation transport | verified route selection and typed peer request | Relay storage or domain policy duplication |
| Events owner | durable sequencing, device filter and cross-node subscriber replay | Relay pubsub or business authority |
| Agent owner | existing lease fencing and expired-owner recovery | global healthy-task settlement |
| OSS owner | shared backend and fenced existing worker lock | second scheduler service |
| Rust StationTransport | route/revision-bound dial, HTTP and cancellation | Session truth or foreign-Station business bypass |
| Linux runtime owner | listeners, control TLS, quotas, exact source and cleanup | additional Relay host platform |

## 3. Allowed Dependencies

```text
Model signed control
  <- Frame identity / node registry
  <- Relay enrollment and admission
  <- route verifier

composition root -> Host / DHT / resource manager
                 -> borrowed transport / registry / bootstrap / Relay adapters
                 -> Frame ingress -> streaming loopback -> existing Hertz router

Desktop / Mobile Rust StationTransport
  -> verified route -> standard stream -> Station canonical API
Federation transport
  -> verified route -> standard stream -> target peer capability/policy

domain transaction -> durable events log -> cross-node wake/replay -> local SSE
domain worker -> domain lease/lock port -> shared database fencing
```

Relay cannot import `apps/station/app/subserver/{agent,conversation,oss,...}`.
Business services cannot import libp2p. Transport does not generate domain
retries; Access and domain owners reconcile their own idempotent operations.
Adapters cannot close borrowed Host or publish readiness before required shared
owners pass. Root key signing does not belong to ordinary node request handlers.

## 4. Generation And Governance

Proto changes precede generated Go/Rust/TS projection. Use current Model build
paths; never hand-edit generated contracts. The architecture registry records
current capability owners and existing contract roots. It does not contain a
permanent blacklist of old names or proposed non-existent paths.

Operational knowledge stays append-only. At the atomic transport cut, the
custom-reader invariant is superseded by a narrow standard-transport resource/
admission invariant. Role minimality continues, with updated listener/control
verification. Domain-specific cluster knowledge belongs to Events, Agent and
OSS, not to a general Gateway.

# Station 统一接入生命周期 - 模块目录结构

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-09-27 | **Updated**: 2026-10-10
> **Owner**: Identity and Access

---

## 1. Current Layout

```text
model/domain/
├── access_gate/                    # Access attempt/gate/decision
└── peer/                           # signed Station identity consumed here

apps/station/
├── frame/core/facility/session/    # canonical client-class Session slots
├── frame/touch/accessgate/         # access policy and attempt owner
├── frame/touch/actor/              # actor/device Session owner
└── app/subserver/federation/       # Federation context/operator API

apps/desktop/
├── src-tauri/src/application/station_binding/
├── src-tauri/src/infrastructure/station_registry.rs
├── src/components/common/StationPicker.tsx
└── src/runtimes/

apps/mobile/
├── src/features/station/
├── src/services/stationTransport.ts
├── src-tauri/src/runtime/oauth/
└── src/runtimes/
```

Relay/route/tunnel paths are owned by
[Node Connectivity](../../runtime/node-connectivity/module-layout.md) and do
not appear as Station Access implementation owners.

## 2. Responsibilities

| Path | Owns | Must not own |
|---|---|---|
| `model/domain/access_gate/` | cross-end Access Gate contract | UI/persistence |
| `facility/session/` | class slot, revoke and persistence | client runtime labels |
| `touch/accessgate/` | gate policy, attempt and decision | client projection |
| `touch/actor/` | Actor/Device Session truth | route selection |
| Desktop `station_binding/` | station-keyed binding lifecycle | Station business truth |
| Desktop `station_registry.rs` | durable Station selection | Relay credential |
| Mobile `features/station/` | Station selection/presentation | transport protocol |
| Client runtimes | scope lifecycle and stale-result fencing | shared business truth |
| Federation app | context and governance projection | client Session |

## 3. Dependency Direction

```text
Node Connectivity verified target/route
  -> Station binding
  -> Access Gate
  -> Session/Actor/Device scope
  -> client runtime projections

Station Federation context
  -> client context consumers
```

Forbidden:

- UI/business runtime owns Relay admin or mount credentials.
- URL or Relay PeerID becomes Station identity.
- client adapter defines an alternative Access Gate route/DTO.
- route failure mutates ActorRef, Federation context or business storage key.
- Station Access copies Relay wire, enrollment or resource-limit definitions.

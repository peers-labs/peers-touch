# Federation Architecture - 模块目录结构

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-06 | **Updated**: 2026-10-10
> **Owner**: Architecture Team

---

## 1. Current Layout

```text
model/domain/federation/
├── federation_discovery.proto
├── federation_governance_service.proto
├── federation_ledger.proto
├── federation_membership_service.proto
├── federation_projection_service.proto
└── delivery.proto

apps/station/
├── app/subserver/federation/       # Federation business truth
├── frame/core/federation/          # transport-neutral peer delivery port/adapters
└── frame/touch/federation/         # profile/resolver projections

tooling/acceptance/gates/federation/ # Federation governance/transport proof
```

Relay implementation paths are owned by
[Node Connectivity](../../platform/runtime/node-connectivity/module-layout.md)
and are not Federation source directories.

## 2. Responsibilities

| Path | Owns | Must not own |
|---|---|---|
| `model/domain/federation/` business contracts | membership, Ledger, governance, projection, typed delivery | Relay credentials/framing |
| `app/subserver/federation/` | lifecycle, membership, policy, roles, sequencer and materialized state | socket/tunnel lifecycle |
| `frame/core/federation/` | narrow peer transport port and delivery adapter | app policy tables or Relay credential truth |
| `frame/touch/federation/` | resolver/profile projections | Ledger mutation |
| Federation Acceptance Gates | governance and receiver-visible business semantics | runtime provisioning truth |

## 3. Dependency Direction

```text
Federation app owner
  -> typed delivery frame
  -> frame peer transport port
  -> Node Connectivity

remote peer request
  -> authenticated Station identity
  -> Federation/domain authorization
  -> receiver-owned state
```

## 4. Forbidden Structures

- Federation app imports Relay subserver internals or manipulates streams.
- Relay mount is persisted as Federation membership.
- Federation policy is evaluated at Relay.
- Node Connectivity selects Federation peer recipients or business topics.
- JSON-only cross-Station contract bypasses generated protobuf.
- A second Relay protocol or client Session owner is created under Federation.

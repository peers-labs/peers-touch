# Station 统一接入生命周期 - 集成与映射

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-09-26 | **Updated**: 2026-10-10
> **Owner**: Identity and Access

---

## 1. Owner Mapping

| Concern | Owner | Desktop consumer | Mobile consumer |
|---|---|---|---|
| Station identity/route | Node Connectivity + Station host identity | station binding/registry | station feature/runtime |
| Access attempt | Access Gate | auth/session adapter | OAuth/access runtime |
| Session scope | Actor Session | runtime coordinator | runtime coordinator |
| Session class slot | Actor Session | canonical `desktop` | canonical `mobile` |
| Federation context | Federation | context store | social runtime |
| Relay diagnosis | Node Connectivity/operations | read-only projection | read-only projection |

Desktop and Mobile share capability IDs and protobuf semantics while retaining
platform-specific adapters and UI organization.

## 2. Canonical Flow

```text
verify endpoint and Station target
  -> choose verified route
  -> establish Station transport
  -> station.identity.verify
  -> access.gate.start
  -> access.gate.submit | access.gate.cancel
  -> access.gate.decision
  -> activate scoped Session
  -> start scope-bound runtimes
```

Clients:

- verify identity before credential submission;
- pass Station/Actor/Device/lifecycle scope together;
- decode only generated protobuf;
- map unknown or incomplete responses to typed failure;
- build requests only from positive capability registry entries.

## 3. Node Connectivity Boundary

[Node Connectivity](../../runtime/node-connectivity/README.md) exclusively
owns:

- signed endpoint/route transport contracts;
- Relay enrollment, mount generation and grants;
- Relay runtime role and security prerequisites;
- WSS + inner TLS opaque tunnel;
- Station peer tunnel adapter and tunnel resource limits.

Station Access owns the user-facing effect of those capabilities:

- one Station identity;
- one route-aware binding;
- Access Gate and Session scope;
- route failure/switch recovery;
- no Relay management UI or second account/runtime.

## 4. Federation Boundary

Clients consume Federation contexts and explicitly scoped discovery. Federation
topology mutation remains an operator concern. Relay reachability neither
creates Federation membership nor supplies a default `federation_id`.

The persisted Actor federated handle remains the only source for
`ActorRef.acct`; direct, proxied and tunneled requests cannot alter it.

## 5. Persistence And Lifecycle

Durable client ownership:

```text
AccessScope =
  station_peer_id
  + actor_ptid
  + device_id
  + lifecycle_generation
```

Route ID/revision is transport state. Same-Station route switching preserves
the Access scope. Station replacement first quiesces the current runtime, then
clears projections and advances lifecycle generation.

Every asynchronous callback compares the complete current scope before writing
state. Session and business storage are never keyed by Relay origin.

## 6. Interface Validation

- `station-api-ownership` validates Station routes, contracts and owners.
- Station Access capability contract validates real Desktop/Mobile consumers.
- Session tests validate same-class takeover and cross-class coexistence.
- Native Journeys validate first access, recovery, switching and scoped
  Federation consumption.
- Node Connectivity Gates validate Relay role, enrollment, discovery and opaque
  tunnel security.
- Architecture module governance validates non-overlapping owners and complete
  active documents.

## 7. No Duplicate Transport Truth

Station Access documents may reference Relay outcomes required by product
Journeys and aggregate Acceptance, but they do not define:

- Relay credential fields;
- mount/enrollment state;
- route signature wire;
- tunnel frame shape;
- WSS/TLS implementation;
- byte/rate/concurrency limits;
- Relay role allowlist.

Changes to those concerns start in Node Connectivity and propagate here only as
consumer-visible effects.

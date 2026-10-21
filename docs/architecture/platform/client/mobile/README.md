# Mobile Shell Architecture

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-08-27 | **Updated**: 2026-10-16
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`

---

## 1. Scope

This module defines:

- Mobile product journeys, visible states, and capability scope;
- Mobile lifecycle, navigation, runtime projection, and local reliability;
- Mobile Rust and native plugin boundaries;
- Android/iOS release-target parity and evidence requirements;
- receiver-perspective product acceptance.

It does not own:

- Station domain implementation;
- Model contract truth;
- Desktop runtime internals;
- cross-client form/core/host semantics, owned by
  [Cross-Client Runtime](../cross-client-runtime/README.md);
- delivery order, owned by an accepted execution plan.

## 2. Product Shape

Mobile is one product released through Android and iOS hosts:

```text
Mobile presentation
  apps/mobile/src/
        |
        v
Mobile Rust runtime
  apps/mobile/src-tauri/src/
        |
        +-> portable Rust cores
        +-> typed native plugins
        +-> Station / generated Model contracts
        |
        +-> Android Host
        +-> iOS Host
```

Android and iOS share product semantics and runtime ownership. Native
availability, packaging, provider setup, and runtime proof remain independent.

## 3. Design Goals

1. Shell owns visible lifecycle and navigation, not business freshness.
2. Auth, session, command, social, messaging, moments, notification, call, and
   settings capabilities have explicit owners.
3. Shared business models come from `model/domain/`.
4. Station change, logout, revocation, background, and resume use
   generation-fenced teardown and rebootstrap.
5. Mobile presentation follows touch, stack navigation, safe-area, keyboard,
   accessibility, and foreground/background contracts.
6. Native capability facts produce explicit admission projections.
7. Product readiness requires source-bound evidence for every required Android
   and iOS runtime cell.

## 4. Document Map

| Document | Purpose |
|---|---|
| [product-definition.md](./product-definition.md) | Product promise and capability profile |
| [experience-contract.md](./experience-contract.md) | End-to-end journeys |
| [product-state-model.md](./product-state-model.md) | Visible states and recovery |
| [product-feasibility.md](./product-feasibility.md) | Capability feasibility |
| [acceptance-matrix.md](./acceptance-matrix.md) | Product and architecture evidence matrix |
| [design.md](./design.md) | Architecture boundaries and contracts |
| [decisions.md](./decisions.md) | Accepted decisions |
| [data-model.md](./data-model.md) | State and Proto mapping |
| [integration.md](./integration.md) | Current implementation mapping and gaps |
| [module-layout.md](./module-layout.md) | Source ownership |
| [mobile-acceptance-environment.md](./mobile-acceptance-environment.md) | Android/iOS environment and evidence contract |
| [prototype/README.md](./prototype/README.md) | Confirmed Mobile prototype |
| [social-parity/README.md](./social-parity/README.md) | Social parity and interoperability contract |

## 5. Upstream Sources

- [Project architecture](../../../architecture.md)
- [Cross-Client Runtime](../cross-client-runtime/README.md)
- [Frontend Runtime](../frontend-runtime/README.md)
- [Station Access](../../station/access/README.md)
- [Chat Lifecycle](../../../domains/chat/lifecycle/README.md)
- [Messaging Platform](../../../domains/chat/messaging/README.md)
- [Social Runtime](../../../domains/social/runtime/README.md)
- [Notification](../../../domains/notification/notification-architecture.md)
- [Secure Content](../../../shared/security/secure-content/README.md)
- [Mobile platform](../../../../client/mobile/base.md)
- [UI Identity](../../../../client/common/ui-identity/README.md)

## 6. Current Readiness Rule

Source presence and platform readiness are separate:

- shared Rust/TypeScript tests prove portable semantics;
- iOS native evidence proves only its declared iOS cell;
- Android native evidence proves only its declared Android cell;
- a whole-Mobile claim requires every required Android and iOS cell;
- missing, stale, or mismatched evidence is `UNPROVEN`;
- simulator, emulator, and physical-device cells are selected by capability
  need and cannot be substituted across OS boundaries.

Current implementation gaps and evidence status are recorded in
[integration.md](./integration.md) and
[acceptance-matrix.md](./acceptance-matrix.md).

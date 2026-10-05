# Cross-Station Private Social

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation
> **Module**: `apps/station/app/subserver/social/`, `apps/station/frame/core/federation/`, `apps/desktop/`

---

## 1. Document Scope

This document set defines:

- private Post, media, Comment, Reaction, recovery, and revocation across two
  Stations in one active Federation;
- Social authority, shared Federation transport, Key Exchange, Secure Content,
  and recipient projection boundaries;
- the current Native Desktop product cell and its exact-source acceptance
  requirements;
- the atomic replacement of the current remote-recipient rejection.

This document set does not define:

- public feed federation, discovery, ranking, or external interoperability;
- Mobile Social implementation or readiness;
- a Browser Social product surface;
- Chat or Conversation business behavior;
- a second Social transport, ledger entry, or remote Station client path.

## 2. Problem

Same-Station private Moments are implemented and proven on Native Desktop, but
the current Social authority rejects every remote recipient before Content
PreKey claim. The repository already has the necessary shared foundations:

- Social owns audience, Post, Comment, Reaction, and relationship truth;
- Secure Content owns reusable encryption and validation contracts;
- Key Exchange owns one-time endpoint and recovery Content PreKeys;
- Federation owns authenticated durable outbox/inbox delivery;
- Native Desktop owns local encryption, decryption, recovery, and projection.

The missing closure is a Social-owned, viewer-scoped use of those foundations
across two Home Stations without creating another authority or exposing
plaintext to either Station.

## 3. Goals

1. Keep the author's Home Station as the only canonical Social authority.
2. Deliver one recipient-scoped ciphertext projection per remote actor.
3. Route remote Comment and Reaction mutations back to source Social.
4. Converge outage, retry, restart, recovery, delete, friendship loss, and block.
5. Prove the complete journey on two real Stations and two Native Desktop
   clients.
6. Preserve same-Station and public Social behavior as regressions.

## 4. Platform Boundary

Native Desktop means the Tauri product window, including its embedded React
surface and Rust host. It does not mean the browser-gateway development shell.

- Native Desktop: required.
- Mobile Native: deferred and unproven.
- Browser: no Social page, runtime, navigation entry, or action registration.

Shared proto generation may refresh tracked Mobile generated bindings. Such
generated-only compatibility is not Mobile product implementation or evidence.

## 5. Documents

| Document | Purpose |
|---|---|
| [design.md](./design.md) | Ownership, topology, lifecycles, and failure semantics |
| [decisions.md](./decisions.md) | Accepted cross-Station Social decisions |
| [data-model.md](./data-model.md) | Wire roots, persistence, and state machines |
| [integration.md](./integration.md) | Repository-backed impact map and cutovers |
| [execution plan](./execution-plans/20261003-native-private-social/plan.md) | Ordered implementation and proof plan |
| [review prompt](./execution-plans/20261003-native-private-social/review-prompt.md) | Independent review contract |
| [remote PreKey validation amendment](./execution-plans/20261004-remote-prekey-submit-validation-amendment-review-prompt.md) | Accepted CSS-D10 independent review record |

## 6. Upstream Contracts

- [Social product definition](../core/product-definition.md)
- [Social experience contract](../core/experience-contract.md)
- [Social product state model](../core/product-state-model.md)
- [Social acceptance matrix](../core/acceptance-matrix.md)
- [Secure Content](../../../shared/security/secure-content/README.md)
- [API Ownership](../../../engineering/api-governance/README.md)
- [Federation](../../../shared/federation/README.md)

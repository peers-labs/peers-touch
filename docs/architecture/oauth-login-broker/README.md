# OAuth Login Broker

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-30 | **Updated**: 2026-10-01
> **Owner**: Identity and Access
> **Module**: `apps/oauth2-client/`

---

## 1. Document Scope

This document set defines the standalone OAuth Login Broker deployed on Vercel:

- durable OAuth authorization transactions across serverless invocations;
- provider identity, login audit, and encrypted credential persistence;
- GitHub private-repository storage through a replaceable domain adapter;
- PKCE, refresh-token handling, key rotation, and failure semantics;
- native Desktop callback handoff and Station assertion verification;
- a read-only, operator-only administration surface.

This document set does not define:

- Station Access Gate policy semantics, which remain owned by
  `station-access-lifecycle`;
- Mobile OAuth UI and callback ownership;
- provider application registration or provider account lifecycle;
- a multi-tenant administration product;
- production-scale database topology.

## 2. Background

The original `apps/oauth2-client` stored OAuth state only in process memory,
which could not support callbacks routed to a different Vercel function
instance. The delivered broker now persists authorization transactions,
provider identities, encrypted credentials, and typed audit history through
the configured `OAuthStore`.

The immediate operating context is one trusted operator, Vercel Hobby, and a
dedicated private GitHub repository. The storage boundary must remain replaceable
so a dedicated service or database can take over without changing OAuth use cases.

## 3. Design Goals

1. Make `/start` and `/callback` correct across independent serverless instances.
2. Persist identities, login history, and refreshable credentials without storing
   raw authorization codes or raw OAuth state.
3. Encrypt every persisted record with a versioned AES-256-GCM envelope.
4. Commit callback state, identity, credential, and audit changes atomically.
5. Keep GitHub API and authentication details behind domain repository ports.
6. Expose only sanitized, read-only operational data to the administrator.
7. Fail login closed when required durable persistence cannot complete.

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [product-definition.md](./product-definition.md) | Product promise, scope, and capabilities |
| [experience-contract.md](./experience-contract.md) | Login, refresh, and operator journeys |
| [product-state-model.md](./product-state-model.md) | Visible and durable states |
| [acceptance-matrix.md](./acceptance-matrix.md) | Receiver-perspective proof contract |
| [design.md](./design.md) | Runtime boundaries, flows, and interfaces |
| [decisions.md](./decisions.md) | Accepted design decisions |
| [data-model.md](./data-model.md) | Envelopes and persisted records |
| [module-layout.md](./module-layout.md) | Source ownership and dependency direction |
| [integration.md](./integration.md) | Existing-route cutover and deployment configuration |
| [delivery plan](./execution-plans/20260930-durable-oauth-login-broker/plan.md) | Completed durable broker delivery |
| [hardening plan](./execution-plans/20260930-oauth-review-hardening/plan.md) | Completed source-backed review closure |
| [final review remediation](./execution-plans/20260930-oauth-final-review-remediation/plan.md) | Completed broker-local review closure |
| [live login integration](./execution-plans/20261001-live-login-integration/plan.md) | Native Desktop, Station bridge, provider identity, refresh uncertainty, and live-test preparation |
| [review 01](./reviews/review-01-product-architecture-plan.md) | Independent product, architecture, and plan review |

## 5. Upstream Sources

- `docs/global/architecture.md`
- `docs/architecture/station-access-lifecycle/`
- `docs/architecture/mobile/`
- `docs/architecture/access-gates/station-access-gate-architecture.md`

## 6. Current Status

- Product: accepted for capabilities OLB-C01 through OLB-C09 and OLB-C12
  through OLB-C13.
- Architecture: accepted through decisions OLB-D01 through OLB-D17.
- Delivery: `OLB-20260930` and `OLB-HARDEN-20260930` are completed;
  `OLB-FINAL-20260930` is completed; `OLB-LIVE-20261001` tracks the native
  handoff and live-readiness closure.
- Proof: broker-local deterministic evidence is proven. Native
  Desktop-to-Station and isolated live provider/Vercel evidence remain
  unproven until `OLB-LIVE-20261001` completes.

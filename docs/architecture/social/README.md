# Social Architecture

This directory contains architecture-layer sources for the Peers-Touch social
domain.

## Documents

| Document | Role |
|---|---|
| `product-definition.md` | Accepted product promise, capability profile, audience semantics, platform scope, and feasibility closure for encrypted private Moments. |
| `experience-contract.md` | Accepted sender, receiver, unauthorized-access, recovery, deletion, and public-continuity Journeys. |
| `product-state-model.md` | Accepted user-visible publish, read, comment, media, recovery, and revocation states. |
| `acceptance-matrix.md` | Accepted receiver-perspective runtime cells, security negatives, and product evidence requirements. |
| `moments.md` | Existing Moments architecture: Audience, Circle, typed reactions, comments, media, and public/private storage separation. |
| `wechat-grade-moments-runtime-architecture.md` | Runtime-first upgrade target for WeChat-grade trusted relationship Moments. Defines Station truth, Desktop runtime projections, delivery inbox, projection sync, and interaction visibility boundaries. |
| [`../secure-content/README.md`](../secure-content/README.md) | Accepted cross-domain encryption, key-envelope, opaque-object, recovery, and hard-cut architecture used by private Moments and Chat. |
| `prototype/README.md` | Desktop Social Chat private/group chat prototype entry, run instructions, confirmation status, and review scope. |
| `execution-plans/2026-05-09-wechat-grade-moments-runtime.md` | Phased implementation plan for the runtime-first Moments upgrade. |

## Source Hierarchy

- The four Private Moments product documents are the accepted PRODUCT contract.
  They define product outcomes and evidence, not architecture topology.
- `../secure-content/` is the accepted owner of reusable contracts plus stateless
  crypto/validation mechanics. Social remains the authority for audience, Post,
  object, grant, and transaction lifecycle.
- `moments.md` remains the baseline Moments capability design.
- `wechat-grade-moments-runtime-architecture.md` constrains the next upgrade:
  Moments must become a runtime-projected trusted relationship system, not a
  page-driven social feed.
- Files under `execution-plans/` describe delivery order and verification, but
  must not redefine architecture boundaries set by the architecture documents.

## Key Decisions

- Station owns cross-device social truth, permissions, delivery facts, and audit.
- Desktop Rust is the local BFF and event bridge; Desktop Web must not bypass it.
- Desktop Web pages are pure renderers over runtime-owned projections.
- Every visible social business state needs both event consumption and periodic
  reconciliation.
- Private HOME timeline should converge on viewer-scoped delivery inbox rather
  than long-term multi-source query merging.

# Social Architecture

This directory contains architecture-layer sources for the Peers-Touch social
domain.

## Documents

| Document | Role |
|---|---|
| `moments.md` | Existing Moments architecture: Audience, Circle, typed reactions, comments, media, and public/private storage separation. |
| `wechat-grade-moments-runtime-architecture.md` | Runtime-first upgrade target for WeChat-grade trusted relationship Moments. Defines Station truth, Desktop runtime projections, delivery inbox, projection sync, and interaction visibility boundaries. |
| `prototype/README.md` | Desktop Social Chat private/group chat prototype entry, run instructions, confirmation status, and review scope. |
| `execution-plans/2026-05-09-wechat-grade-moments-runtime.md` | Phased implementation plan for the runtime-first Moments upgrade. |

## Source Hierarchy

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

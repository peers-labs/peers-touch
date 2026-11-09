# Mobile North-Star Realignment

> **Status**: draft (awaiting architecture + plan acceptance)
> **Version**: 0.1
> **Created**: 2026-11-09 · **Updated**: 2026-11-09
> **Owner**: Mobile / Client Architecture
> **Module root**: `docs/architecture/platform/client/mobile/northstar-realignment`
> **Code roots governed**: `apps/mobile/src/**` (presentation), `packages/prototypes/mobile/chat/**`
> **Amends, does not fork**: [`../module-layout.md`](../module-layout.md), [`../integration.md`](../integration.md), [`../experience-contract.md`](../experience-contract.md)

---

## 1. Why this module exists

The confirmed mobile **prototype** at `packages/prototypes/mobile/chat` is a
fixture-backed visual north-star rendered entirely with `@peers-touch/ui`
(north-star tokens, flat material). The shipping **real app** at
`apps/mobile` already implements the product for real — Tauri v2 webview over
Rust (MLS group chat, X3DH/double-ratchet direct chat, public + E2EE private
Moments, OAuth/multi-gate access, device link, call signalling, reliability
ledger, search, native push/deep-link) — but its presentation still uses a
5106-line private `styles.css`, `antd`, and `@lobehub/ui`, with a private
blue-purple `--brand-*` palette. It has **no dependency on `@peers-touch/ui`**.

This produces three concrete defects:

1. **Two visual systems.** The real app cannot inherit prototype/desktop
   north-star fixes; each alignment is maintained by source-scraping tests.
2. **Feature points are visual-only on the prototype and unverified-as-a-set on
   the real app.** The real app owns 106 acceptance actions / 157 fixture
   surfaces / a 162-surface whole-product inventory, but no current-source iOS
   evidence exists in this worktree (all mobile-simulator gates are `UNPROVEN`).
3. **Prototype and real structure diverge.** Real shell is four tabs
   (chat/moments/contacts/settings); the prototype shows three and contains
   fake/dead controls and omits real surfaces (friend requests, incoming call,
   notification center). The prototype is therefore no longer a faithful
   north-star.

This module defines the target architecture for **one** presentation system
(peers-ui north-star) consumed by the real app, a **functional-point coverage
contract** that maps every prototype point to a real owner and an acceptance
gate, and a **real-wins reconciliation** rule that corrects the prototype.

## 2. Scope

In scope:

- Consume `@peers-touch/ui` + north-star tokens inside `apps/mobile`
  presentation (`pages/`, `components/`, acceptance surface renderers).
- Retire `antd` / `@lobehub/ui` from mobile presentation through bounded
  per-surface replacement, behind two small imperative adapters.
- Replace the private `--brand-*` visual identity with north-star tokens.
- Keep every existing real runtime/service/Rust path intact; presentation is
  re-skinned, not re-architected.
- Map all prototype functional points to real feature owners and iOS Simulator
  acceptance evidence; fill only genuine presentation/contract gaps.
- Reconcile the prototype to the real product where they conflict.

Out of scope:

- Any change to Rust runtime semantics, Station/transport, MLS/E2EE, proto
  contracts, or the lifecycle/runtime graph.
- Dark mode (mobile contract is unfinished and pinned light today; north-star
  supplies tokens but enabling dark is a separate decision).
- Android emulator / physical-device gate cells (this pass targets the iOS
  Simulator cell; Android remains separately required for a whole-Mobile
  claim per [`../README.md` §6](../README.md)).
- New product capabilities not shown in the prototype.

## 3. Document map

| Document | Purpose |
|---|---|
| [design.md](./design.md) | Target architecture, boundaries, contracts, evidence gates |
| [decisions.md](./decisions.md) | ADR-lite decisions, rejected alternatives, consequences |
| [functional-coverage.md](./functional-coverage.md) | Prototype feature-point → real owner → disposition → acceptance map |
| [module-layout.md](./module-layout.md) | Presentation ownership delta (amendment to parent) |
| [integration.md](./integration.md) | UI-system integration + antd retirement delta (amendment to parent) |
| [execution-plans/20261109-mobile-northstar-realignment/plan.md](./execution-plans/20261109-mobile-northstar-realignment/plan.md) | Frozen phased plan (Slice 0/1 detailed) |

## 4. North star

A single version of the mobile product, rendered with one design system
(`@peers-touch/ui` north-star), where every functional point visible in the
prototype is backed by the real runtime and proven on an iOS Simulator
exact-source build, and the prototype again matches the real product's
structure — not the reverse.

## 5. Upstream / governing sources

- [`../design.md`](../design.md), [`../module-layout.md`](../module-layout.md),
  [`../integration.md`](../integration.md), [`../acceptance-matrix.md`](../acceptance-matrix.md)
- [`../mobile-acceptance-environment.md`](../mobile-acceptance-environment.md)
- [`../../../../client/common/ui-identity/README.md`](../../../../../client/common/ui-identity/README.md)
- Prototype north-star: `packages/prototypes/mobile/chat`
- UI package: `packages/ui/web`, tokens `packages/ui/tokens`

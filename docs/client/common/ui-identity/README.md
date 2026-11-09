---
status: active
owner: Client Platform Team
updated: 2026-11-07
review-cadence: quarterly
next-review: 2027-02-07
related:
  - docs/architecture/platform/client/ui-system/design.md
  - docs/architecture/platform/client/ui-system/prototype/north-star-frame.md
  - docs/client/common/ui-identity/component-spec-map.md
---

# Client UI Identity

> Audience: Product designers, client engineers, reviewers, and AI agents.

## 1. Purpose

Peers Touch UI must feel like one product across Desktop, Mobile, Social, Chat, Agent, Applets, Auth, Settings, and Station management.

This directory defines the shared UI identity that every client module inherits before adding module-specific refinements.

It exists because a feature can be functionally correct and still feel assembled from unrelated component libraries. UI identity prevents that drift.

## 2. Position In The Docs Hierarchy

This is a client platform-layer source of truth.

Constraint direction:

```text
docs/architecture/
  -> docs/client/common/ui-identity/
      -> docs/client/common/ui-identity/modules/<module>/
          -> docs/client/desktop/ or docs/client/mobile/
              -> code
```

Rules:

- Architecture documents define product/system boundaries.
- UI Identity defines shared visual, spatial, and interaction language.
- Module UI Identity refines the shared language for domain-specific surfaces.
- Desktop/Mobile documents define platform adaptation only; they must not redefine the product style.
- Code implements the closest applicable contract and must not create one-off styles without updating the contract.

## 3. Peers Touch UI ID

The product-level identity, making cycle, and composition kernel are owned by
**Peers UI System**: [design.md](../../../architecture/platform/client/ui-system/design.md)
(Definition → Composition → Resolution) and the self-training
[methodology](../../../architecture/platform/client/ui-system/prototype/self-training-methodology.md).

The active desktop visual grammar is the **north-star desktop frame**
([north-star-frame.md](../../../architecture/platform/client/ui-system/prototype/north-star-frame.md)):

- Neutral paper/glass surfaces; chrome zones separate by material, never hairlines.
- The dominant action is a near-ink **capsule** (`#1a1d20`, dark inverts) and wins by weight.
- **Pine `#2f6a50` is the single brand accent**: identity/current-location,
  connection and online points, accept/answer, favorite marks. Small touch
  points only — never a canvas/card fill, never the success color.
- Identity elements are rounded-square; circles only for status points.
- These values are promoted into `@peers-touch/ui-tokens`; the frame is the
  only allowed desktop prototype frame (Frontend Eles → 桌面原型).

The earlier "Structured Expressive Minimalism / Quiet Protocol Minimalism"
wording is **superseded** (see `foundations.md`, `new-identity.md`). This
directory keeps token/component/state/craft contracts that implement the frame.

## 4. Reading Order

1. [Peers UI System design](../../../architecture/platform/client/ui-system/design.md) — identity, making cycle, composition kernel (authoritative).
2. [north-star-frame.md](../../../architecture/platform/client/ui-system/prototype/north-star-frame.md) — active desktop frame grammar and pine color boundaries.
3. [self-training-methodology.md](../../../architecture/platform/client/ui-system/prototype/self-training-methodology.md) — gap-first prototype → promotion gate.
4. [tokens.md](./tokens.md) — shared token decisions for color, radius, spacing, type, border, shadow, and motion.
5. [layout.md](./layout.md) — shell, content rail, page density, and responsive layout rules.
6. [components.md](./components.md) — shared component anatomy and style constraints.
7. [grammar-bindings.json](./grammar-bindings.json) — machine-readable semantic
   role, representation and Desktop/Mobile adapter binding.
8. [interaction.md](./interaction.md) — state, feedback, loading, failure, and optimistic interaction rules.
9. [accessibility.md](./accessibility.md) — focus, keyboard, contrast, hover, and reduced-motion requirements.
10. [craft-quality.md](./craft-quality.md) — evidence-backed craft calibration,
    accessibility/performance baseline, and findings-first review gate.
11. [frontend-component-tree.md](./frontend-component-tree.md) — Frontend component tree, alive policy, render boundary, and jank-prevention standard.
12. [frontend-component-tree-registry.md](./frontend-component-tree-registry.md) — Alive / non-alive / lazy / LRU registry for primary modules, settings, applets, and large content surfaces.
13. [review-checklist.md](./review-checklist.md) — UI review checklist for humans and AI agents.
14. [component-spec-map.md](./component-spec-map.md) — component→token→value benchmarking map (skeleton/inventory for the full component contract).
15. [foundations.md](./foundations.md) / [new-identity.md](./new-identity.md) — **superseded**, history only.

## 5. Module Contracts

Module contracts live under [modules/](./modules/).

Each module may define:

- Domain-specific visual tone.
- Required information hierarchy.
- Module-specific surfaces and component anatomy.
- Desktop/Mobile refinements when platform behavior differs.
- Acceptance states for incomplete, loading, error, empty, trust, and extreme-data cases.

Current module contracts:

- [Agent](./modules/agent/README.md) — Chat, Atelier, and Atelier-owned orchestration shell, panel, identity, and responsive behavior.
- [Social](./modules/social/README.md) — Human Social feed, detail, composer, reaction, comments, and moderation states.
- [Auth](./modules/auth/README.md) — Sign-in, account selection, PIN, re-auth, and the federated mesh backdrop as ambient education.

## 6. Shared Patterns

Shared patterns live under [patterns/](./patterns/).

Patterns are reusable surface contracts across modules:

- [feed.md](./patterns/feed.md) — activity feed surfaces.
- [composer.md](./patterns/composer.md) — post, reply, prompt, and message composition surfaces.
- [trust-state.md](./patterns/trust-state.md) — identity, station, audience, moderation, permission, and risk states.
- [optimistic-commit.md](./patterns/optimistic-commit.md) — immediate local preview, real progress, authoritative swap, and rollback for visible commits/media uploads.

## 7. Implementation Rules

- Use `@peers-touch/ui` primitives first for Desktop UI.
- Use antd only when no peers-ui primitive exists yet and the control is
  visually normalized into the north-star identity; the file belongs on the
  migration list until then.
- Do not mix component-library defaults directly on one surface.
- Do not define raw visual values in page code when a token or shared component rule exists.
- **The app/page/prototype layer composes primitives; it never defines them.**
  It is forbidden outside `packages/ui` to write CSS targeting peers-ui
  classes (`.pt-*`) that restyles a control, or JS that re-implements a
  control's visual state (`.style.*` chrome writes, `classList` hover/focus/
  pressed toggling, hand-rolled open/position/animation of floating layers).
  Missing capability is promoted to the primitive as a token/variant, never
  worked around in page CSS. Enforced by
  `tooling/scripts/review/primitive-layer-guard.mjs`; see
  `docs/knowledge/invariants/app-layer-must-not-restyle-primitives.md`.
- Do not make user-facing UI text outside the i18n system.
- Do not hide trust, audience, station, or privacy state when it changes what the user can safely do.
- Do not claim award readiness or report a self-assigned craft score; use
  rendered, dynamic, accessibility, and performance evidence.
- Do not change a page, tab, provider editor, applet runtime, overlay, or large list lifetime without checking [frontend-component-tree.md](./frontend-component-tree.md) and updating [frontend-component-tree-registry.md](./frontend-component-tree-registry.md) when needed.

## 8. AI Agent Checklist

Before editing client UI:

- [ ] Read [Peers UI System design](../../../architecture/platform/client/ui-system/design.md) and the [north-star frame grammar](../../../architecture/platform/client/ui-system/prototype/north-star-frame.md).
- [ ] Read this file.
- [ ] Read the closest module contract under `modules/`.
- [ ] Read the closest shared pattern under `patterns/`.
- [ ] Read `craft-quality.md` and declare the surface type, product thesis,
  positive calibration, and negative calibration.
- [ ] Read `frontend-component-tree.md` and check whether the surface has a row in `frontend-component-tree-registry.md`.
- [ ] Identify the page's content bounds, action bounds, and trust-state bounds.
- [ ] Identify the surface's alive category, runtime/store owner, and hidden-render risk.
- [ ] Confirm LobeUI-first implementation or document why antd is required.
- [ ] Validate normal, loading, disabled, empty, error, overflow, and narrow-window states.
- [ ] Validate material keyboard, touch, assistive-technology,
  localization-expansion, reduced-motion, and performance paths.
- [ ] If a screenshot reveals a reusable issue, follow `docs/knowledge/playbooks/ux-case-to-contract.md`.

## 9. Doc metadata and review cadence

Contracts drift when they have no owner and no re-read date. Every contract
document in this directory and the client-level contracts under
`docs/client/common/*.md` carries one YAML frontmatter block so staleness is
machine-checkable:

```yaml
---
status: active | draft | superseded-by:<relative-path>
owner: <owning team>
updated: YYYY-MM-DD          # last content change
review-cadence: quarterly | semiannual | annual | on-change
next-review: YYYY-MM-DD      # required unless cadence is on-change or status is superseded
related:                     # optional cross-references
  - <repo path or doc>
---
```

Cadence assignment:

| Cadence | Applies to |
| --- | --- |
| `quarterly` | canonical core contracts (this README, foundations, tokens, layout, components, interaction, accessibility, craft-quality, review-checklist), the UX methodology, and base |
| `semiannual` | shared patterns and module contracts |
| `annual` | long-lived references/registries that change with features |
| `on-change` | inventories/registries updated as part of feature work, and historical direction docs |

Rules:

- Editing a contract bumps `updated`; a normative change also advances
  `next-review` by the cadence. Do not backfill an invented creation date.
- A past `next-review` date means "re-read and confirm or correct"; it does
  not block merges but must be cleared during the next contract-affecting
  change.
- Superseded contracts point at their replacement with
  `status: superseded-by:<path>` and leave a pointer instead of being deleted.
- Enforcement: `tooling/scripts/review/doc-review-cadence.sh`
  (`--warn-only` for advisory runs); it is part of the review pipeline in
  `tooling/scripts/review/run.sh`. Operational knowledge
  (`docs/knowledge/`) keeps its own frontmatter contract and adds the same
  cadence fields via its template.

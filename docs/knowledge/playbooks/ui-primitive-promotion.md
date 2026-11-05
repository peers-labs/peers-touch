---
kind: playbook
title: Promote a visual shape into a peers-ui primitive
status: active
owns:
  - packages/ui/web/src/
  - packages/ui/tokens/src/
  - packages/ui/contracts/src/catalogue.ts
  - packages/prototypes/
  - tooling/scripts/ui-system/craft-battery.mjs
  - tooling/scripts/ui-system/suites/
  - tooling/scripts/review/primitive-layer-guard.mjs
  - tooling/scripts/review/primitive-layer.baseline.json
referenced-by:
  - docs/knowledge/invariants/app-layer-must-not-restyle-primitives.md
related:
  - docs/client/common/ui-identity/README.md
  - docs/architecture/platform/client/ui-system/prototype/north-star-frame.md
detected: 2026-11-04
owner: Client Platform / UI System
review-cadence: on-change
---

# Promote a visual shape into a peers-ui primitive

## When to use

Use this when a shape/visual grammar is wanted on more than one surface and the
only way to get it today is a page-local CSS override, a copied "almost the
same" component, or a JS visual mutation. Typical triggers from the shape
work:

- A control's intrinsic geometry is wrong system-wide (e.g. the 44×26 iOS
  switch pill should be a dense 36×20 binary control).
- A primitive needs a real variant for a recurring context (a bordered Select
  in forms vs a quiet `ghost` Select inside a flat settings row; a bordered
  Alert vs an in-flow inline status rail).
- A recurring layout does not exist as a primitive yet (flat, hairline-separated
  settings sections/rows were hand-rolled per page as `SettingsSection`).
- A floating layer escapes the frame that clips its anchor, or every overlay
  invents its own entrance motion.

Do NOT use this to ship a one-screen tweak. A shape seen once stays page
layout; a shape seen twice or claimed as product language gets promoted.

## Pre-conditions

- [ ] The target grammar is accepted in UI Identity
      (`docs/client/common/ui-family/` and the module contract), not improvised.
- [ ] You can name the variant as product meaning (role/context), not as a
      visual excuse ("make it look like Linear"). Color stays semantic; shape,
      density and motion carry the craft.
- [ ] Work happens in the explicitly selected worktree. The prototype trains
      shape in `packages/prototypes`; production app surfaces are `--all`
      expansion targets and are not scanned by default until primitives carry
      the promoted variants.

## The five mandatory artifacts

A promotion is **not done** until all five exist. A prototype visual with no
primitive, no token, and no guard is a local hack and is treated as unfinished.

1. **UI Identity grammar** — state the rule in the governing identity doc
   (geometry scale, when the variant applies, what is forbidden). Code without
   the grammar entry is untrained taste.
2. **Token + primitive change in `packages/ui`** — add the role token /
   geometry / motion in `packages/ui/tokens/src/index.ts` and the variant or new
   component under `packages/ui/web/src/`. Skin differences are consumed by the
   primitive via `--pt-*` custom properties (the prototype bridges them in
   `DesignDirections.tsx`); never override the rendered `.pt-*` class from a
   page.
3. **Contract catalogue** — register/update the capability in
   `packages/ui/contracts/src/catalogue.ts`: a new capability for a new
   component (e.g. `ui.spec.settingslist` for `ListSection`/`ListRow`), or a new
   `variantAxes` / `anatomy` / `geometryAndMotion` line for an added axis
   (`Select.appearance=field/ghost`, `Alert.presentation=card/inline`,
   intrinsic switch geometry).
3b. **Base-elements live stage** — every renderable registered component
    (`registry.ts`) must resolve to a REAL component stage on the 基础元素 tab
    (`ElementSamples.tsx`), grouped by category and driven by the
    标准/长文案/禁用 condition switch. Behaviour-only primitives
    (`useFormController`, the feedback channels) are shown through their host
    (Form/FeedbackHost), never faked; sub-parts that cannot exist outside a
    host (FormField/FormGroup/FormFooter) point to that host card instead of
    being duplicated. A card reading `缺样本` is unfinished work.
4. **Deterministic craft assertion** — encode the observable geometry in
   `tooling/scripts/ui-system/craft-battery.mjs` (intrinsic size, resting
   paint, motion contract, frame containment) and, when runtime interaction is
   required, a scenario in
   `tooling/scripts/ui-system/suites/north-star.suite.json`. Taste stays a
   human verdict; geometry that must never regress is a machine rule.
5. **Knowledge** — when a real regression was paid for (escaping menu, loud UA
   scrollbar, embedded square focus), add/extend a `pitfalls/` entry; link this
   playbook and the invariant.

## Steps

1. **Name the shape and the failure.** Write one sentence: which control, on
   which surfaces, what it looks like today, and why that is the wrong grammar.
   Confirm it recurs; otherwise keep it as page layout.
2. **Add tokens before components.** Put density / motion / role color on
   `geometry.*` / `motion.*` and reference the token from the primitive CSS.
   Example: `geometry.control.row/menu=30`, `motion.surface=140`, and the
   switch on-ink role token `--pt-switch-on` (default `--pt-primary`,
   overridable per skin — hue stays reserved for semantic facts).
3. **Add the variant or primitive once.** Extend the component's public API
   (`appearance`, `variant`, a new `list.tsx`) and render a `data-*` hook
   (`data-appearance`, `data-variant`, `data-inset`). The hook is what the
   craft assertion targets; never assert on internal descendant classes from a
   page.
4. **Migrate one real specimen end-to-end.** Replace the page-private
   component with the primitive (settings General group is the reference
   specimen: `ListSection`/`ListRow`, ghost `Select`, inline `Alert`).
   Specialized content (the 24-word recovery phrase) stays page composition
   using app-owned `sk-*` layout classes; it must not paint `.pt-*`.
5. **Register the contract and the guards.** Update `catalogue.ts`, add the
   craft-battery rule, and add a runtime scenario for anything only observable
   while open (an open `.pt-menu` must lie within `.sk-shell`).
6. **Keep the boundary ratchet honest.** Run
   `tooling/scripts/review/primitive-layer-guard.mjs`. New app-layer `.pt-*`
   selectors or visual JS mutations fail. The baseline
   (`primitive-layer.baseline.json`) is a per-file **selector multiset**, so
   line shifts do not count as debt; only a genuinely removed selector shrinks
   it. Record real shrinkage with `--update` and let the diff show deletions —
   never `--update` to hide a new override.

## Verification

- [ ] `pnpm --filter @peers-touch/ui-contracts --filter @peers-touch/ui run check` passes.
- [ ] `pnpm --filter @peers-touch/prototype-ui-system run check` passes.
- [ ] `node tooling/scripts/review/primitive-layer-guard.mjs` passes with zero
      NEW (and any SHRUNK entries recorded via `--update` show removals).
- [ ] `node tooling/scripts/ui-system/evaluate-specimens.mjs --suite tooling/scripts/ui-system/suites/north-star.suite.json --base http://localhost:3291`
      reports `rollup OBSERVED`, including the new/changed scenario.
- [ ] A real render confirms the intent (measure, not only screenshot):
      intrinsic control size, resting alpha/border, and open-overlay
      containment within the anchor's clip frame.
- [ ] The migrated specimen no longer references the retired page-private
      primitive for the promoted shape; shared overrides still used by
      not-yet-migrated sections are intentionally left baselined.
- [ ] On 基础元素, every renderable registry id resolves to a live stage with
      zero `缺样本` cards and zero console errors; 标准/长文案/禁用 all render.

## Guard working notes

- Baseline identity is `file → multiset(selector/mutation token)`; line numbers
  are informational only. Do not key debt on a line number — edits that only
  shift lines then read as false NEW+STALE pairs.
- To prove a migration added no debt, reduce the previous baseline to multisets
  and diff against a fresh scan before/after; the comparison must show zero
  deltas in files you touched.
- Never use `git checkout -- <file>` to probe whether the guard catches an
  override — it discards unrelated uncommitted work. Use a throwaway probe file
  under the scan root and delete it, or a `/tmp` copy.
- The craft battery is stringified and `eval`'d inside the page: escape
  regex backslashes (`\\s`, `\\.`) and parse both `rgba()` and
  `color(srgb … / a)` alpha forms.

## Crosswalks

- Invariant enforced here:
  `docs/knowledge/invariants/app-layer-must-not-restyle-primitives.md`.
- Entry methodology and identity sources:
  `docs/client/common/ui-identity/README.md`.
- Related regression knowledge:
  `docs/knowledge/pitfalls/prototype-embedded-control-chrome-leak.md`,
  `docs/knowledge/pitfalls/loud-ua-scrollbar-in-quiet-frame.md`.

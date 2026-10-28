---
status: draft
owner: Client Platform Team
updated: 2026-10-27
review-cadence: quarterly
next-review: 2027-01-27
related:
  - docs/client/common/ui-identity/tokens.md
  - docs/client/common/ui-identity/components.md
  - docs/client/common/ui-identity/layout.md
  - docs/client/common/form-control-ux-contract.md
---

# Component Spec Map (skeleton)

> Status: **skeleton / planned.** This is the entry point and inventory for
> the full component-to-value contract — the long-term effort to give every
> component, from an input to a page, one benchmarking spec down to token,
> color, and easing curve. It intentionally does not yet contain the full
> specs; rows are seeded incrementally. Do not treat an empty cell as "no
> standard exists" — fall back to [components.md](./components.md),
> [tokens.md](./tokens.md), and the closest module contract until the row is
> filled.

## 1. The three benchmarking layers

```text
Value layer      tokens.md          concrete reference values (color, size, radius, spacing, duration, easing)
Component layer  component-spec     each atom/composite: anatomy, tokens, sizes, state matrix, motion, a11y, library mapping
Page layer       layout.md +        shell/section/card density, grid, overlay geometry, alive/lifetime
                 frontend-component-tree
```

Constraint direction: a component consumes value-layer tokens; a page/surface
composes components. Raw values in component or page code are a defect when a
token exists. Concrete theme code is derived from the value layer; any
deviation is registered here, not introduced inline.

The current gap this will close: [tokens.md](./tokens.md) names token roles
but does not yet list every concrete value, and component rules are spread
across [components.md](./components.md) and
[form-control-ux-contract.md](../form-control-ux-contract.md) without one
component→token→value→state table.

## 2. Required columns per component row

Every filled component spec must declare, in one place:

1. **Anatomy** — named slots and which are interactive.
2. **Token mapping** — semantic tokens used for every surface/text/border/
   shadow part (no raw hex/px).
3. **Size scale** — canonical heights/paddings from the shared scale.
4. **State matrix** — normal, hover, focus-visible, pressed, disabled,
   loading, error, empty, selected; each with its visual delta.
5. **Motion** — duration token + easing role for enter/exit/state; `none` is
   an explicit answer.
6. **Accessibility** — role, keyboard interaction, focus owner, labels,
   reduced-motion behavior.
7. **Library mapping** — LobeUI-first primitive; antd normalization required;
   or Peers-owned component. Desktop/Mobile shell differences only.

## 3. Component inventory and fill status

Status legend: **seeded** (a real spec exists for at least the states touched
by current work) · **pending** (row reserved, rules still live in the fallback
docs).

| Component | Layer | Status | Fallback until filled |
| --- | --- | --- | --- |
| Button (primary/secondary/ghost/danger/icon) | atom | seeded (size/radius scale, roles) | components.md §3 |
| Text / number / search input | atom | pending | form-control-ux-contract.md, components.md §7 |
| Select / picker / combobox | composite | pending | form-control-ux-contract.md, components.md §9 |
| Checkbox / radio / switch | atom | pending | form-control-ux-contract.md |
| Slider / stepper | atom | pending | form-control-ux-contract.md |
| Tabs / segmented control | composite | pending | components.md §5 |
| Chips / tags / badges | atom | pending | components.md §6 |
| Avatar / identity block | atom | seeded (rounded-square primitive, resolver) | components.md §8 |
| Card / panel / section surface | composite | pending | components.md §4 |
| Modal / dialog | overlay | seeded (fixed stage geometry rule) | layout.md overlay rule, components.md §9 |
| Popover / menu / tooltip | overlay | pending | components.md §9 |
| Drawer / sheet (desktop / mobile) | overlay | pending | layout.md, platform docs |
| Toast / notification / alert | feedback | pending | components.md §10 |
| Spinner / skeleton / progress | feedback | pending | components.md §10, interaction.md |
| Optimistic media commit | pattern | seeded | patterns/optimistic-commit.md |
| Empty / error / recovery state | recovery | pending | components.md §10 |
| Data table / list / grid row | data | pending | components.md, review-checklist §13 |
| Composer (post/reply/prompt) | composite | pending | patterns/composer.md |
| Feed item / thread detail | composite | pending | patterns/feed.md |
| Trust / policy indicator | composite | pending | patterns/trust-state.md |
| App shell / rail / page host | page | pending | layout.md, frontend-component-tree.md |
| Settings section / provider form | page | pending | layout.md, form-control-ux-contract.md |

## 4. Fill protocol

- Fill one component row per change when new one-off styling would otherwise
  be added; do not batch all rows into one unreviewable contract.
- A "seeded" row must still complete columns 1–7 before being called final.
- When the row conflicts with a fallback doc, update the fallback to point
  here and mark the old text superseded — never keep two normative versions
  (see [ux-design-methodology.md §2.6](../ux-design-methodology.md)).
- Mobile and Desktop share semantics and tokens; only platform shells differ,
  per [components.md §2](./components.md#2-component-priority).

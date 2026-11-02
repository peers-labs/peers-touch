---
status: active
owner: Client Platform Team
updated: 2026-10-27
review-cadence: quarterly
next-review: 2027-01-27
related:
  - docs/client/common/ui-identity/component-spec-map.md
  - docs/client/common/ui-identity/components.md
---

# UI Identity Tokens

## 1. Purpose

This document is the **value layer** of the UI contract. It defines token
roles and, where a value has been normalized, the concrete reference value
(duration, easing curve, size). The remaining concrete color/size values are
being promoted from theme code into this file incrementally; the inventory
and fill status live in [component-spec-map.md](./component-spec-map.md).

Rules:

- Concrete theme code is **derived from** the reference values here; the
  library (LobeUI/antd) seed is the reference implementation, not a license
  to invent per-surface values.
- A deviation from a reference value is registered in this file or in the
  relevant component spec, never introduced as a one-off inline style.
- This file fixes roles and reference values; module contracts may narrow
  usage but must not redefine them.

Tokens prevent pages from mixing LobeUI defaults, antd defaults, and one-off inline styles into one inconsistent visual language.

## 2. Token Layers

```text
Primitive tokens
  -> Semantic tokens
      -> Component tokens
          -> Module refinements
```

Rules:

- Primitive tokens are raw color, size, radius, and timing values.
- Semantic tokens express product meaning, such as `surface.base`, `text.secondary`, or `action.primary`.
- Component tokens express reusable anatomy, such as `button.primary.height` or `feed.card.radius`.
- Module refinements may narrow usage but must not redefine global meaning.

## 3. Color Roles

| Role               | Meaning                      | Usage                                   |
| ------------------ | ---------------------------- | --------------------------------------- |
| `surface.canvas`   | application background       | shell and page background               |
| `surface.base`     | primary reading surface      | feed items, cards, panels               |
| `surface.subtle`   | low-emphasis grouping        | composer background, empty state blocks |
| `surface.raised`   | floating surfaces            | popovers, menus, lightweight dialogs    |
| `text.primary`     | main readable content        | body, titles, primary labels            |
| `text.secondary`   | stable metadata              | handle, station, time, helper text      |
| `text.muted`       | low-priority labels          | placeholder, disabled hint              |
| `action.primary`   | one dominant action          | publish, confirm, create                |
| `action.secondary` | low-emphasis action          | back, reply, view comments              |
| `action.danger`    | destructive action           | delete, block, revoke                   |
| `trust.local`      | local verified context       | local station, self-authored state      |
| `trust.remote`     | remote/federated context     | remote station source                   |
| `trust.warning`    | attention-needed trust state | degraded, partial, risky                |
| `trust.blocked`    | policy-denied state          | block, moderation, hidden               |

Rules:

- A page should usually have one `action.primary` region.
- Do not use black as a standalone CTA unless the theme defines black as `action.primary`.
- Do not use red for routine secondary actions.
- Do not use blue links, purple avatars, black CTAs, and red actions together without token ownership.

## 4. Radius Roles

| Role          | Meaning                                        | Usage                                                   |
| ------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `radius.xs`   | tiny affordance                                | inline chips, small status pills                        |
| `radius.sm`   | compact control                                | small buttons, reaction chips                           |
| `radius.md`   | default control                                | inputs, tabs, normal buttons                            |
| `radius.lg`   | reading surface                                | feed cards, composer panels                             |
| `radius.xl`   | high-level container                           | large panels, modal sheets                              |
| `radius.full` | indicator-only circle or compact metadata pill | presence dot, unread badge, compact reaction/count chip |

Rules:

- Related controls inside one surface should use adjacent radius levels.
- Do not put sharp controls inside soft containers unless the sharpness signals data table or code.
- Feed and chat surfaces should prefer `radius.lg` or lighter boundary models, not thick nested boxes.
- User avatars always use rounded-square geometry derived from their size; they never use `radius.full`.
- Interactive inputs and icon buttons never use circular or pill geometry. Use `radius.sm` or `radius.md`.
- `radius.full` is reserved for non-container indicators and compact metadata, not the product's primary visual language.

## 5. Spacing Roles

Spacing should express hierarchy.

| Role        | Meaning                      |
| ----------- | ---------------------------- |
| `space.2xs` | icon/text gap                |
| `space.xs`  | chip gap, compact inline gap |
| `space.sm`  | control group gap            |
| `space.md`  | paragraph/action row gap     |
| `space.lg`  | card internal padding        |
| `space.xl`  | section gap                  |
| `space.2xl` | page rail margin             |

Rules:

- Page gutters must come from layout tokens, not per-page guesses.
- Large empty side gutters are a layout failure unless a split-pane contract owns them.
- Feed item internal spacing must be tighter than page section spacing.

## 6. Border And Shadow Roles

| Role              | Meaning                    | Usage                        |
| ----------------- | -------------------------- | ---------------------------- |
| `border.hairline` | quiet separation           | feed item edge, divider      |
| `border.focus`    | keyboard/focus ownership   | parent control focus state   |
| `border.danger`   | destructive/error boundary | validation or blocking state |
| `shadow.none`     | flat reading flow          | dense feeds and lists        |
| `shadow.soft`     | subtle lifted surface      | composer, lightweight card   |
| `shadow.float`    | popover/dropdown           | floating action surfaces     |

Rules:

- Do not stack border and shadow unless the surface is truly raised.
- Do not use heavy card borders to solve unclear layout.
- Composite controls must not render duplicated external borders.

## 7. Typography Roles

| Role                | Meaning                         |
| ------------------- | ------------------------------- |
| `type.pageTitle`    | page identity                   |
| `type.sectionTitle` | local section title             |
| `type.itemTitle`    | actor, object, or row title     |
| `type.body`         | primary readable content        |
| `type.meta`         | time, station, handle, audience |
| `type.action`       | button and link text            |
| `type.caption`      | low-priority helper text        |

Rules:

- Body text should be visually stronger than metadata.
- Metadata should remain readable, not decorative.
- Do not rely on component-library default typography for mixed surfaces.

## 8. Motion Roles

| Role             | Meaning                    | Reference duration | antd token            |
| ---------------- | -------------------------- | ------------------ | --------------------- |
| `motion.instant` | no perceptible delay       | 0ms                | —                     |
| `motion.fast`    | hover, press, small state  | 100ms              | `motionDurationFast`  |
| `motion.normal`  | panel, popover, tab switch | 200ms              | `motionDurationMid`   |
| `motion.slow`    | major route transition     | 300ms              | `motionDurationSlow`  |

Easing curves (reference values are the antd v6 seed; use the matching
antd token where one exists, never a hand-written cubic-bezier in component
code):

| Role                | Curve                              | Use                                        |
| ------------------- | ---------------------------------- | ------------------------------------------ |
| `motion.ease.standard` | `cubic-bezier(0.645, 0.045, 0.355, 1)` | default enter/exit and continuous state reveal (`motionEaseInOut`) |
| `motion.ease.out`      | `cubic-bezier(0.215, 0.61, 0.355, 1)`  | elements entering / progress arriving (`motionEaseOut`) |
| `motion.ease.emphasized` | `cubic-bezier(0.78, 0.14, 0.15, 0.86)` | deliberate, high-attention transitions only (`motionEaseInOutCirc`) |
| `motion.ease.overshoot` | `cubic-bezier(0.12, 0.4, 0.29, 1.46)` | rare spring/overshoot affordance; never for dismissal or data (`motionEaseOutBack`) |

Rules:

- Pick duration and easing by role; raw millisecond values and inline
  cubic-beziers in component code are defects.
- Continuous reveal driven by real progress (e.g. an upload fill) uses
  `motion.fast` linear interpolation between samples; it is not an enter/exit
  transition. See [patterns/optimistic-commit.md](./patterns/optimistic-commit.md).
- Social reading surfaces should avoid decorative motion.
- Loading and optimistic updates must be understandable even if motion is disabled.
- Focus and keyboard transitions must not depend on animation.

## 9. AI Agent Checklist

- [ ] Are raw color/radius/spacing values justified by a token role?
- [ ] Is there exactly one dominant primary action area?
- [ ] Are destructive actions visually scoped and not competing with primary actions?
- [ ] Are borders/shadows used for boundary ownership, not decoration?
- [ ] Does metadata use the shared type hierarchy?
- [ ] Are LobeUI and antd defaults normalized into shared token roles?

# UI Identity Tokens

> Status: Canonical token contract for client UI identity.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

This document defines token intent. Concrete values may live in theme code, but implementation must preserve these roles.

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

| Role | Meaning | Usage |
| --- | --- | --- |
| `surface.canvas` | application background | shell and page background |
| `surface.base` | primary reading surface | feed items, cards, panels |
| `surface.subtle` | low-emphasis grouping | composer background, empty state blocks |
| `surface.raised` | floating surfaces | popovers, menus, lightweight dialogs |
| `text.primary` | main readable content | body, titles, primary labels |
| `text.secondary` | stable metadata | handle, station, time, helper text |
| `text.muted` | low-priority labels | placeholder, disabled hint |
| `action.primary` | one dominant action | publish, confirm, create |
| `action.secondary` | low-emphasis action | back, reply, view comments |
| `action.danger` | destructive action | delete, block, revoke |
| `trust.local` | local verified context | local station, self-authored state |
| `trust.remote` | remote/federated context | remote station source |
| `trust.warning` | attention-needed trust state | degraded, partial, risky |
| `trust.blocked` | policy-denied state | block, moderation, hidden |

Rules:

- A page should usually have one `action.primary` region.
- Do not use black as a standalone CTA unless the theme defines black as `action.primary`.
- Do not use red for routine secondary actions.
- Do not use blue links, purple avatars, black CTAs, and red actions together without token ownership.

## 4. Radius Roles

| Role | Meaning | Usage |
| --- | --- | --- |
| `radius.xs` | tiny affordance | inline chips, small status pills |
| `radius.sm` | compact control | small buttons, reaction chips |
| `radius.md` | default control | inputs, tabs, normal buttons |
| `radius.lg` | reading surface | feed cards, composer panels |
| `radius.xl` | high-level container | large panels, modal sheets |
| `radius.full` | circular or pill | avatar, icon button, selected pill |

Rules:

- Related controls inside one surface should use adjacent radius levels.
- Do not put sharp controls inside soft containers unless the sharpness signals data table or code.
- Feed and chat surfaces should prefer `radius.lg` or lighter boundary models, not thick nested boxes.

## 5. Spacing Roles

Spacing should express hierarchy.

| Role | Meaning |
| --- | --- |
| `space.2xs` | icon/text gap |
| `space.xs` | chip gap, compact inline gap |
| `space.sm` | control group gap |
| `space.md` | paragraph/action row gap |
| `space.lg` | card internal padding |
| `space.xl` | section gap |
| `space.2xl` | page rail margin |

Rules:

- Page gutters must come from layout tokens, not per-page guesses.
- Large empty side gutters are a layout failure unless a split-pane contract owns them.
- Feed item internal spacing must be tighter than page section spacing.

## 6. Border And Shadow Roles

| Role | Meaning | Usage |
| --- | --- | --- |
| `border.hairline` | quiet separation | feed item edge, divider |
| `border.focus` | keyboard/focus ownership | parent control focus state |
| `border.danger` | destructive/error boundary | validation or blocking state |
| `shadow.none` | flat reading flow | dense feeds and lists |
| `shadow.soft` | subtle lifted surface | composer, lightweight card |
| `shadow.float` | popover/dropdown | floating action surfaces |

Rules:

- Do not stack border and shadow unless the surface is truly raised.
- Do not use heavy card borders to solve unclear layout.
- Composite controls must not render duplicated external borders.

## 7. Typography Roles

| Role | Meaning |
| --- | --- |
| `type.pageTitle` | page identity |
| `type.sectionTitle` | local section title |
| `type.itemTitle` | actor, object, or row title |
| `type.body` | primary readable content |
| `type.meta` | time, station, handle, audience |
| `type.action` | button and link text |
| `type.caption` | low-priority helper text |

Rules:

- Body text should be visually stronger than metadata.
- Metadata should remain readable, not decorative.
- Do not rely on component-library default typography for mixed surfaces.

## 8. Motion Roles

| Role | Meaning |
| --- | --- |
| `motion.instant` | no perceptible delay |
| `motion.fast` | hover, press, small state |
| `motion.normal` | panel, popover, tab switch |
| `motion.slow` | major route transition |

Rules:

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

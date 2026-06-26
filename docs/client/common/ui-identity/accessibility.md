# UI Identity Accessibility

> Status: Canonical accessibility contract for client UI identity.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

Accessibility is part of Peers Touch UI Identity, not a post-implementation audit.

Federated trust, privacy, and social actions must be operable and understandable without relying on color, hover, or animation alone.

## 2. Required Interaction Paths

Every client surface must support:

- Pointer interaction.
- Keyboard navigation.
- Visible focus.
- Screen-reader understandable labels for icon-only actions.
- Reduced-motion comprehension.
- Text expansion and localization expansion.

## 3. Focus Ownership

Rules:

- Focus ring belongs to the semantic owner.
- Composite fields use one parent focus boundary.
- Popovers and menus return focus to the source.
- Route/detail transitions move focus to the new primary heading or thread root.
- Error recovery should move focus only when it helps the user act.

## 4. Color And Contrast

Rules:

- Metadata may be quiet but must remain readable.
- Trust and policy states cannot rely on color alone.
- Danger, warning, pending, and disabled states require shape, icon, text, or placement support.
- Disabled controls must maintain readable labels.

## 5. Hover And Hidden Actions

Rules:

- Hover-only affordances need keyboard-visible alternatives.
- Critical actions cannot be hidden behind hover.
- Repeated feed actions may be visually quiet but must remain discoverable.
- Long-press/mobile alternatives must preserve the same semantic action.

## 6. Motion

Rules:

- Motion must clarify state, not carry the only meaning.
- Reduced-motion users must still understand open, close, pending, success, and failure states.
- Loading skeletons must not create layout shift that breaks reading continuity.

## 7. Social Minimum

Social surfaces must ensure:

- Reaction picker is keyboard reachable.
- Comment composer is reachable after opening comments.
- `New Post` is reachable from the header.
- Author/source/audience/reason metadata has readable text.
- Moderation and delete actions are not color-only.

## 8. AI Agent Checklist

- [ ] Are icon-only actions labeled?
- [ ] Is focus ownership correct for composite surfaces?
- [ ] Can keyboard users reach primary and secondary actions?
- [ ] Does the UI avoid color-only trust or error states?
- [ ] Does reduced motion preserve state meaning?

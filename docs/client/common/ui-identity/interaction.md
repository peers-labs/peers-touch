# UI Identity Interaction

> Status: Canonical interaction contract for client UI identity.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

Interaction quality determines whether Peers Touch feels trustworthy.

Every action must expose state ownership: what is pending, what changed, what failed, and whether the user can recover.

## 2. State Ownership

State belongs to the user intent before it belongs to a child element.

Rules:

- Posting state belongs to the composer surface.
- Reaction state belongs to the reaction action group.
- Comment submission state belongs to the reply composer.
- Follow/block/moderation state belongs to the relationship or trust control.
- Detail loading state belongs to the thread surface, not only the spinner.

## 3. Interaction States

Every actionable component must define:

- Normal.
- Hover.
- Focus.
- Pressed.
- Loading.
- Disabled.
- Success.
- Error.
- Recovering.
- Offline or degraded when the action depends on network/runtime state.

Minimum rule:

- If the disabled state blocks a user task, the UI must explain the reason.

## 4. Optimistic Updates

Optimistic UI is allowed only when recovery is clear.

Rules:

- Reaction and lightweight local toggles may update optimistically.
- Publish may show pending content only if failure can restore the draft.
- Delete, block, moderation, and privacy-sensitive actions must confirm server success before removing critical context.
- Station policy state must never be fabricated locally; show pending policy only as pending.

## 5. Feedback

Feedback should be local first, global second.

Rules:

- Prefer inline pending/success/error near the affected surface.
- Use toast for completion that does not require follow-up.
- Use modal confirmation only for destructive, irreversible, or policy-changing actions.
- Do not use global alerts for routine feed refresh or reaction changes.

## 6. Recovery

Every failed action must answer:

- What failed?
- Which object/action was affected?
- Is the user's input preserved?
- Can the user retry?
- Is the failure local, runtime, station, network, permission, or policy?

Rules:

- Draft text must survive publish failure.
- Reply text must survive comment failure.
- A failed reaction must restore the previous count/state.
- A failed moderation command must not imply the station is blocked.

## 7. Accessibility

Rules:

- Keyboard users must be able to reach primary actions, secondary actions, tabs, menus, and composers.
- Focus must return to the source control after popover/menu close.
- Hover-only affordances need keyboard-visible alternatives.
- Motion-sensitive users must still understand the state transition without animation.

## 8. Covered UX Dimensions

This interaction contract covers:

- State ownership.
- Interaction discoverability.
- Feedback and recovery.
- Trust and safety.
- Accessibility.
- Performance perception.

Out of scope:

- Concrete runtime event ownership.
- Module-specific mutation rules, unless defined by module contracts.

## 9. AI Agent Checklist

- [ ] Does each action have a named state owner?
- [ ] Is loading local to the affected intent?
- [ ] Does failure preserve user input?
- [ ] Are sensitive trust/policy actions server-authoritative?
- [ ] Does optimistic UI have rollback?
- [ ] Can keyboard users complete the action path?

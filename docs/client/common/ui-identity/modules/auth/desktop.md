# Desktop Auth UI Identity

> Status: Desktop refinement for Auth UI Identity.
> Audience: Desktop engineers, reviewers, and AI agents.
> Updated: 2026-06-20.

## 1. Purpose

This document adapts Auth UI Identity to Desktop.

It does not redefine the Auth product model. It defines Desktop layout, surface,
and motion constraints for implementing it.

## 2. Desktop Auth Layout

Desktop Auth uses **a floating card over a full-window backdrop**.

Rules:

- The window is one continuous surface. The card floats; the backdrop fills.
- The card sits in a stable, consistent position (right-aligned on wide windows)
  and keeps the shared card radius and shadow tokens.
- The federated mesh occupies the backdrop layer behind the card at a lower
  z-index and must not receive pointer events.
- Do not split the window into two equally-weighted halves. A side-by-side
  "illustration panel + form panel" reads as two products and is forbidden.
- The backdrop must mask or fade near the card edge so no node sits under the
  card.

## 3. The Auth Card

Rules:

- The card is the only foreground surface and the only place using the brand
  accent at full strength (logo, primary CTA, selected/secured affordances).
- Card internals follow shared component anatomy: logo, title, helper text,
  account rows, primary action, secondary action.
- Account rows show avatar, friendly account name, and a quiet handle/email;
  the secured/trust affordance is secondary, not a colored banner.
- Popovers and arrows attached to the card must not cover account rows or the
  primary action.

## 4. The Federation Backdrop

Rules:

- Single brand accent only. No cyan/green/amber/rose decorative set, no glow,
  no drop shadow on edges or nodes.
- Nodes are confined to the side of the window away from the card; the mesh
  fades out before reaching the card.
- Node labels are friendly names (Alice, Station, Relay, Service, Agent,
  Storage) and the selected station's friendly name. Never an IP, host, port,
  internal id, or raw i18n key.
- The header chip ("human mesh" or equivalent) is quiet metadata weight, not a
  badge that competes with the card title.

## 5. Motion

Desktop Auth motion is strictly limited.

Rules:

- Allowed: slow data-flow tokens drifting along edges; the station-swap
  transition where the placeholder node becomes the chosen station.
- Forbidden: background sweeps, swaying gradients, pulsing halos on every node,
  dashed edge marching, or any motion whose purpose is to attract attention.
- Data-flow tokens stay low-opacity and thin so they read as ambient, not as a
  foreground animation.
- `prefers-reduced-motion` must stop data flow and freeze transitions.

## 6. Inline OAuth Progress

OAuth progress belongs to the provider action that started it.

Rules:

- The first provider click starts OAuth immediately; do not open a second
  confirmation card before opening the provider.
- Opening-browser, waiting, cancellation, account initialization, success, and
  failure/retry render inside the original provider action.
- The auth card and provider action preserve the same `x`, `y`, `width`, and
  `height` across those states. Icon, label, and trailing cancel/retry slots
  reserve stable geometry so copy changes cannot shift the page.
- A detached side card, popover, or inline row that expands the auth card is
  forbidden for routine OAuth progress and recovery.
- While one provider is opening, waiting, or initializing, other login entries
  are disabled. Cancellation restores all entries without navigating away.
- Failure keeps recovery local: the provider action becomes retryable and
  exposes a fixed trailing cancel action. Error detail may use a tooltip or
  accessible description without entering document flow.
- After account initialization succeeds, show a short in-place success state
  and continue through the existing identity/PIN pipeline automatically.

## 7. State Coverage

Auth must represent each state on the same calm backdrop:

- Logged out: email/OAuth sign-in.
- Account picker: one account, multiple accounts.
- PIN entry, PIN set, PIN relink.
- Expired-session re-auth (revoked vs. continue).
- Active station known vs. unknown (friendly placeholder, never raw host).

## 8. Acceptance States

Every Desktop Auth implementation must capture or manually verify:

- Account picker with multiple accounts.
- Sign-in form (email and OAuth entry points).
- PIN entry and PIN set/relink.
- Expired-session re-auth banner.
- Active station selected (friendly name shown in the mesh).
- Active station with no label (friendly placeholder, not an IP/host).
- Long account name and long station name.
- Narrow desktop window (card dominates; mesh recedes further).
- Reduced-motion enabled.
- OAuth idle, waiting/cancellable, failure/retry, initializing, and success
  states with identical auth-card and provider-action geometry.

## 9. AI Agent Checklist

- [ ] Is there one floating card over one backdrop, not two side-by-side panels?
- [ ] Does the card dominate and use the brand accent; is the mesh single-accent and quiet?
- [ ] Does the backdrop fade so no node sits under the card?
- [ ] Are all labels friendly names, never raw IP/host/port/keys?
- [ ] Is motion limited to data flow and the station-swap transition?
- [ ] Does reduced-motion stop the data flow?
- [ ] Does every auth state stay on the same calm backdrop with one primary action?
- [ ] Does OAuth progress remain inside the original fixed-size provider action?
- [ ] Do state transitions avoid card growth, provider-action resizing, and page shift?

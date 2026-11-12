---
status: active
owner: Client Platform Team
updated: 2026-11-11
review-cadence: semiannual
next-review: 2027-04-27
---

# Desktop Auth UI Identity

## 1. Purpose

This document adapts Auth UI Identity to Desktop.

It does not redefine the Auth product model. It defines Desktop layout, surface,
and motion constraints for implementing it.

## 2. Desktop Auth Layout

Desktop Auth uses **one full-bleed surface that is the window content**. There
is no outer app canvas band and no floating card: outside the surface only the
OS window chrome remains — the traffic-light cluster and a transparent title
bar. The title text and the title-bar divider are hidden (see §2.1); the
traffic lights and native dragging remain.

### 2.1 Native window geometry and title bar

The login surface is a compact, phone-like native window, not a full-size app
window with empty space. Geometry is owned by the native shell
(`src-tauri/src/application/window_sizing.rs`), never by CSS.

- The window opens at **360×640** (declared in `tauri.conf.json` so first paint
  is already compact) and stays compact across `onboarding` and `resuming`.
- On entering the ready shell it expands to the **last user-adjusted ready
  size**, persisted in logical pixels under config storage
  (`window/geometry.json`); with no saved value it falls back to **1200×800**.
  Every programmatic resize re-centers the window.
- Only user-driven resizes while in the ready surface are remembered, and they
  are debounced to a single final write. Programmatic auth/ready resizes are
  flagged and never persisted, so the compact size cannot overwrite the
  remembered ready size. Logging out shrinks the window back to 360×640.
- The hard window floor stays 320×440; persisted geometry below it or outside a
  sane maximum is discarded in favor of the default.
- The feature is inert under the `acceptance-webdriver` build, where harness
  window placement remains the single authority.
- macOS chrome uses `titleBarStyle: "Overlay"` with `hiddenTitle: true` and
  decorations retained. The web content fills the title bar, so the in-window
  headers rise into that band instead of leaving an empty strip. Geometry is
  split into two tokens: `--pt-titlebar-inset` (8px on macOS, 0 elsewhere) is
  the small top clearance for the list/chat/auth columns whose header sits
  beside the lights, while `--pt-rail-top` (28px) is the larger offset for the
  icon rail, the only column whose avatar sits under the lights. Each header is
  a slim 48px band marked `data-tauri-drag-region`. All three traffic lights
  (close/minimize/zoom — none hidden) shift as one cluster toward the left edge
  and down 2pt to center on that band, matching the macOS WeChat convention.
  `maximizable` stays `true` so the green zoom light is enabled rather than
  greyed out; it only affects user zoom, not the configured/remembered size.
  The platform flag is set synchronously in `kernel/hostPolicy` before first
  paint, so there is no layout flash.

Rules:

- The auth card fills the shell edge to edge at every size — no padding band,
  no card radius/border/shadow separating it from a backdrop. It is the
  surface, not a tile floating on one.
- The surface carries the light pine tint; the shell uses the same tint so
  overscroll never reveals a second background.
- Inner content (header, brand hero, form, Station footer) keeps a fixed
  reading measure (`--pt-auth-card-width`, 336px) and centers, so wide windows
  do not stretch the controls even though the surface itself is full-bleed.
  Header controls sit on a tight 12px horizontal inset so they hug the window
  edges instead of floating in wide gutters.
- The Station footer pins to the window bottom via a flex column
  (`margin-top: auto`); the body absorbs the free space.
- Short windows scroll within the shell (no visible scrollbar) instead of
  clipping; the layout is size-independent and has no auth width breakpoints.
- Do not split the window into two equally-weighted halves. A side-by-side
  "illustration panel + form panel" reads as two products and is forbidden.

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

## 4. Surface Treatment

The full-bleed model removes the separate backdrop/mesh layer; the surface is
the only background.

Rules:

- Single brand accent only. No cyan/green/amber/rose decorative set, no glow,
  no drop shadow on edges or nodes.
- The pine tint is the calm background; decoration is confined to the centered
  content measure, never spread across the full window.
- Any identity/network metadata uses friendly names (Alice, Station, Relay,
  Service, Agent, Storage) and the selected station's friendly name. Never an
  IP, host, port, internal id, or raw i18n key.
- A header chip or status label is quiet metadata weight, not a badge that
  competes with the card title.

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
- Active station selected (friendly name shown in the Station switcher).
- Active station with no label (friendly placeholder, not an IP/host).
- Long account name and long station name.
- Narrow desktop window (full-bleed surface holds; content stays centered at the reading measure).
- Reduced-motion enabled.
- OAuth idle, waiting/cancellable, failure/retry, initializing, and success
  states with identical auth-card and provider-action geometry.

## 9. AI Agent Checklist

- [ ] Is the auth surface full-bleed (the window content), with no outer canvas band or floating card and no side-by-side panels?
- [ ] Does the window open compact at 360×640 and only expand on entering the ready shell, restoring the remembered size without persisting any programmatic resize?
- [ ] Is the title bar an overlay with the title/divider hidden, traffic lights aligned to the slim header row, and each column header reserving the inset and acting as a drag region?
- [ ] Does the centered content keep the fixed reading measure and use the brand accent only at full strength on the surface?
- [ ] Is the pine tint the single calm background with no separate backdrop/mesh layer or decoration outside the content measure?
- [ ] Are all labels friendly names, never raw IP/host/port/keys?
- [ ] Is motion limited to data flow and the station-swap transition?
- [ ] Does reduced-motion stop the data flow?
- [ ] Does every auth state stay on the same full-bleed surface with one primary action?
- [ ] Does OAuth progress remain inside the original fixed-size provider action?
- [ ] Do state transitions avoid card growth, provider-action resizing, and page shift?

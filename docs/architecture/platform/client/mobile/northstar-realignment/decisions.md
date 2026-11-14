# Mobile North-Star Realignment — Decisions

> Status: draft · Created: 2026-11-09 · Owner: Mobile / Client Architecture
> Each ADR lists context, decision, rationale, rejected alternatives,
> consequences, and reversal condition.

## Index

| ID | Title | Status |
|---|---|---|
| ADR-1 | Consume `@peers-touch/ui` in the real app | draft |
| ADR-2 | Drop blue-purple gradient; ink primary + pine accent | draft |
| ADR-3 | Reuse the peers-ui feedback channel (no second dialog/toast) | draft |
| ADR-4 | Confirmed navigation governs presentation; preserve real capabilities | navigation confirmed 2026-11-13; remaining capability mapping draft |
| ADR-5 | iOS Simulator target; progressive gates | draft |
| ADR-6 | Webview compatibility is evidence-bound | draft |
| ADR-7 | Delivery units must satisfy a fixed vertical closure (no schedule here) | draft |

---

## ADR-1 Consume `@peers-touch/ui` in the real app (no parallel mobile UI kit)

- **Context [F]**: real app uses antd/lobehub + private CSS; peers-ui is a
  scoped (`.pt-ui`) source-only ESM React-19 package already consumed by
  desktop and by the mobile prototype at 390pt. Owner selected full unification.
- **Decision**: add `@peers-touch/ui workspace:*`, wrap the product root in
  `UIProvider theme="light"` with north-star flat variables, migrate surfaces
  to peers-ui primitives, retire antd/lobehub per surface.
- **Rationale**: one design-system truth across desktop/mobile/prototype;
  reuse primitives instead of maintaining a second kit; remove dependence on
  source-scraping alignment as the primary guard.
- **Rejected alternatives**: token-only bridge (keeps two systems and the CSS
  debt); hybrid freeze (uncloseable gap).
- **Consequences**: +single system, prototype fixes flow to product; −~40
  files touched, bundle/compat checks required, controlled coexistence window.
- **Reversal**: only if a peers-ui primitive provably cannot meet a real mobile
  contract on-device; fix peers-ui (shared), never fork a mobile kit.

## ADR-2 Drop the blue-purple gradient; adopt ink primary + pine accent

- **Context [F]**: north-star primary is neutral ink with pine accent; the
  private `#667eea→#764ba2` gradient maps to nothing.
- **Decision**: remove `--brand-primary/secondary` and the 135° gradient;
  primary actions use ink, identity/current-position uses pine; define only
  mobile geometry tokens (`--pt-m-*`), no new color tokens.
- **Rationale**: required by ADR-1; competing brand hues would defeat
  unification and contradict the audited north-star identity.
- **Rejected alternative**: keep gradient as a mobile-only accent (third
  identity, permanent fork).
- **Consequences**: visible CTA color change; accepting this ADR is the brand
  sign-off. Reversal only via a new UI Identity decision applied upstream.

## ADR-3 Reuse the peers-ui feedback channel (no second dialog/toast)

- **Context [F]**: peers-ui provides `createFeedbackChannel()` with
  `notify`, promise `requestConfirmation`, `requestChoice`, and a serial queue,
  plus `FeedbackHost` mounted via `UIProvider feedback`. Mobile currently uses
  imperative antd `Modal.confirm/success` (12 sites) and `message.*` (17 sites).
- **Decision**: instantiate ONE channel at the root, mount it through
  `UIProvider feedback`, and expose thin typed app wrappers (confirm/
  confirmDestructive/notify*). Migrate all call sites; build no competing
  dialog/toast host.
- **Rationale**: reuse-before-specialize; keeps imperative ergonomics without a
  second control library and renders dialogs inside the scoped provider.
- **Rejected alternatives**: a mobile-owned confirm bridge + toast host
  (duplicates a shipped primitive, violates §2.2); keeping antd only for these
  two APIs (blocks retirement).
- **Consequences**: one presentation-only feedback seam; wrappers stay free of
  runtime/data access and are unit-bound.
- **Reversal**: none anticipated; if a need arises the channel cannot express,
  extend the shared peers-ui channel rather than fork it.

## ADR-4 Confirmed navigation governs presentation; preserve real capabilities

- **Context [F]**: the user reconfirmed on 2026-11-13 that chats and contacts
  share messages, distinguished by top subtabs; bottom navigation is
  messages/moments/me. Commit `2431345e1` wrongly split contacts into a fourth
  bottom tab. The earlier rule conflated existing implementation structure
  with accepted design and cannot govern shell navigation.
- **Decision**: restore the prototype's three destinations and shared
  chats/contacts header. Store messages pane selection across pushed details
  and tab changes. Migrate the real shell to that navigation while preserving
  contacts, friend requests, group administration, search, badges, and native
  back behavior. Keep real runtime/action ownership; remove fixture-only
  fake controls and mount genuine owner-backed presentation gaps.
- **Rationale**: confirmed product design governs navigation and appearance;
  real runtime ownership governs capability and behavior.
- **Rejected alternatives**: forcing four bottom tabs because the app already
  renders them; dropping contacts capabilities to reduce tab count; carrying
  fixture data or fake success into production.
- **Consequences**: prototype shell is restored; real `MobileShell` navigation
  remains a required migration item, with fixtures/selectors updated together.
  This correction does not claim native App alignment or whole-product proof.
- **Reversal**: navigation changes require a new explicit product decision;
  a proven real owner can restore a previously removed fake capability as
  REAL-GAP-PRESENT, without changing the confirmed shell.

## ADR-5 iOS Simulator is the acceptance target for this pass; progressive gates

- **Context [F/X]**: harness build + `mobile_simulator` provisioner exist;
  toolchain present; iOS 26.5 runtime presence unverified; product/whole-product
  gates need reviewed remote Station profiles; this worktree's gates are UNPROVEN.
- **Decision**: target the iOS Simulator cell; station-free build/layout/
  lifecycle gates run without external services; Station-backed scenario gates
  run per delivery unit with a supplied non-stable profile; the full 166-surface
  whole-product gate runs only at program delivery. Android stays separate.
- **Rationale**: matches owner-selected strength; keeps early iterations on
  reproducible station-free evidence; avoids claiming whole-Mobile readiness.
- **External prerequisites [X]**: iOS 26.5 + iPhone 17 runtime; one (direct) or
  two (station-lifecycle) reviewed remote Station profiles; foreground
  simulator for whole-product. These gate the relevant gates, not source work.
- **Consequences**: whole-Mobile delivery cannot be claimed until the Android
  cell and full gate also pass.
- **Reversal/scope**: if 26.5 cannot be installed, escalate; never silently
  retarget the provisioner's pinned runtime.

## ADR-6 Webview compatibility is an evidence-bound decision

- **Context [F]**: iOS target 15.0; peers-ui CSS uses dvh/`:has`/`color-mix`
  (15.4 / 16.2+); glass blur defaults off.
- **Decision**: measure the minimum OS the migrated surfaces need on the
  simulator; raise the deployment target if accepted, otherwise add scoped
  fallbacks per modern feature; record the resolved floor in `ios-host.md`.
- **Rejected alternative**: assume compatibility or ship unverified on old OS.
- **Consequences**: possible deployment-target raise (product sign-off captured
  in this ADR) or fallback CSS work.
- **Reversal**: device evidence showing the chosen floor fails.

## ADR-7 Delivery units must satisfy a fixed vertical closure (no schedule here)

- **Context**: architecture must not encode task ordering (methodology rule),
  but every delivery unit must be independently complete and proven.
- **Decision**: adopt the six-point closure in `design.md §5` as an invariant
  for any surface unit; naming, numbering, dependency order, and selection of
  units belong only to the accepted execution plan.
- **Rationale**: keeps architecture a statement of allowed relationships and
  falsifiable completeness while leaving delivery sequencing to the plan.
- **Rejected alternative**: embedding ordered slices in the architecture doc.
- **Consequences**: the plan is the single place a slice/order exists and can
  change through plan governance without amending architecture.
- **Reversal**: none; the invariant persists even if the plan is restructured.

## ADR-8 Native navigation retains bounded visited views

- **Context**: active-only rendering remounted headers/controllers on every
  switch. Whole-page Settings loading and post-paint scroll restoration
  produced the refresh/jitter experience explicitly rejected on 2026-11-14.
- **Decision**: use one `MobileNavigationHost` with React 19.2 Activity:
  three visited primary frames, two nested Messages panes, and four last
  current-stack detail views. Preserve the Messages header/tabbar; restore
  scroll before paint; keep background readback section-local.
- **Ownership**: navigation owns presentation retention, feature runtimes
  own freshness, and `MobilePageActivity` owns retained presentation assets.
  Hidden Effects/capture stop; media pauses; eviction or identity replacement
  disposes retained assets. Session identity fences the entire cache.
- **Rejected alternatives**: fade animations over remounts; keeping every
  page/effect active; caching an unbounded detail history; lowering native
  keyboard or continuity assertions.
- **Consequences**: a bounded DOM/resource cost replaces repeated remount
  cost. Activity reactivation must be distinguished from first initialization.
  Deep stack eviction requires external recovery and never drops back-route
  identity. Source checks alone cannot claim native continuity.
- **Reversal**: change the bound only with native memory/performance evidence;
  the user's no-refresh/no-jitter product contract remains.

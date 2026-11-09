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
| ADR-4 | Real product wins structural conflicts; prototype reconciled | draft |
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

## ADR-4 Real product wins structural conflicts; prototype is reconciled

- **Context [F]**: prototype 3 tabs vs real 4 tabs; Moments nav differs;
  prototype is outgoing-call-only and has dead controls, while the real app
  already implements incoming call, friend requests, block, and group admin.
- **Decision**: keep and re-skin the real surfaces (REAL-RESTYLE); correct the
  prototype to real shell/navigation and real action ownership; remove
  prototype-only fakes; only mount/build UI for genuine owner-backed gaps
  (notification center; credentials detail).
- **Rationale**: owner's explicit rule; a north-star contradicting the shipped
  product is misleading; real behavior is never degraded to a fixture.
- **Rejected alternative**: rebuilding already-real UI or carrying prototype
  fakes into the product.
- **Consequences**: prototype loses controls and changes shape; no new fake
  surface enters the app.
- **Reversal**: only if a "fake" point is later proven to have a real owner, in
  which case it re-enters as REAL-GAP-PRESENT with evidence.

## ADR-5 iOS Simulator is the acceptance target for this pass; progressive gates

- **Context [F/X]**: harness build + `mobile_simulator` provisioner exist;
  toolchain present; iOS 26.5 runtime presence unverified; product/whole-product
  gates need reviewed remote Station profiles; this worktree's gates are UNPROVEN.
- **Decision**: target the iOS Simulator cell; station-free build/layout/
  lifecycle gates run without external services; Station-backed scenario gates
  run per delivery unit with a supplied non-stable profile; the full 162-surface
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

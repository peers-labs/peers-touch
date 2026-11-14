---
kind: pitfall
title: Whole-product surface audit fails one fail-fast layer at a time
status: active
owns:
  - tooling/acceptance/gates/mobile/simulator_whole_product_usability_e2e.py
  - tooling/acceptance/gates/mobile/simulator_whole_product_usability_e2e_test.py
  - tooling/acceptance/gates/mobile/surface_audit.py
  - tooling/acceptance/gates/mobile/surface_audit_test.py
  - packages/ui/web/src/selection.tsx
  - packages/ui/web/src/styles.css
  - apps/mobile/src/components/recovery/RecoveryOverlayHost.tsx
  - apps/mobile/src/pages/contacts/ContactsAcceptanceSurface.tsx
  - apps/mobile/src/styles.css
  - apps/mobile/src/pages/contacts/FindPeopleSurface.tsx
  - apps/mobile/src/acceptance/debug/
  - apps/mobile/src/app/installMobileWebGuards.ts
  - apps/mobile/src/pages/chat/ChatAcceptanceSurface.tsx
  - apps/mobile/src/pages/chat/ChatOverlayHost.tsx
referenced-by: []
related:
  - docs/knowledge/pitfalls/mobile-parity-design-system-selector-drift.md
  - docs/architecture/engineering/acceptance/design.md
detected: 2026-11-11
---

# Whole-product surface audit fails one fail-fast layer at a time

## Symptom

The `mobile-simulator-whole-product-usability-e2e` Gate raises a single
`GateError` per run and stops, so each repaired run exposes the next defect
class instead of a full list. The observed failure sequence was:

1. unlabeled controls
2. undersized controls (44x44 CSS px minimum)
3. interaction artifacts with zero controls
4. occluded content
5. a PASS/PROVEN gate report that the acceptance runner still marked
   `UNPROVEN` ("source report is unproven")

A green `result.json` written by the Gate module is not sufficient; the runner
re-validates the proof chain in `tooling/acceptance/core/proof.py`.

## Root causes and the layer each belongs to

### Rules of Hooks before fixture-only branches

`RecoveryOverlayHost` returned early for the `recovery.session-valid-restore`
fixture before calling `useEffect`/`useState`. Fixture entry changed hook counts
and crashed the overlay, so the surface selector never rendered. Every hook
must run unconditionally; branch on the fixture only after all hooks.

### Accessible names cannot live only in sibling markup

The create-group fixture rendered bare `Checkbox` controls while member names
sat in sibling row content. The audit labels a control from
`aria-label`/`placeholder`/`title`/its own `textContent`. Bind the input
`aria-label` to the same name the production picker already uses
(`ContactsPage` is the reference contract).

### Touch sizing is a design-system responsibility, not app CSS

The `@media(pointer:coarse)` block in `packages/ui/web/src/styles.css` covered
buttons, icon buttons and select options but omitted other boundary classes
the audit measures (`.pt-check-label`, `.pt-field-frame`, `.pt-switch`).
App-level per-surface 44px overrides duplicate the rule and drift; keep touch
geometry in the design system:

- check labels need both `min-width` and `min-height` (a label-less checkbox
  collapses to the 16px native box width).
- field frames need comfortable `min-height`; the frame is the audit boundary,
  not the inner input.
- Switch separates the hit target from the visual track: the button grows to
  44x44 only on coarse pointers while a nested `.pt-switch-track` keeps the
  intrinsic 36x20 pill and 16px thumb geometry on every pointer type.

App CSS must not target `.pt-*` classes; extend the component stylesheet
instead.

### Launch-notice surfaces need page-wide control scope

Handshake, OAuth progress/failure and access-unavailable markers wrap only a
status/notice body; their usable controls (scan, language, change station,
debug) live at entry-shell level. A root-scoped audit emits an empty
`controls` array, which the interaction artifact validator rejects. Such
surfaces belong in `ENTRY_PAGE_CONTROL_SURFACES`, which switches the audit
scope to `document.body`. Widening scope also measures the shell controls, so
every shell button (including `.entry-change-station`) must independently
meet the 44px contract.

### Harness overlays are not product occluders

The fixed acceptance-only debug pill
(`[data-acceptance-debug-toggle]`, present only under
`VITE_ACCEPTANCE_HARNESS=1`) floats over bottom-anchored product controls and
made `elementFromPoint` report widespread false occlusions. The audit now
neutralizes its `pointer-events` while measuring and skips the toggle itself,
then restores hit-testing. Never hide the defect by moving the product
control; the overlay is test infrastructure.

The retained Chat list and active detail both subscribe to the fixture state.
A fixture overlay must render only on its matching, visible route; otherwise
both pages portal the same modal into the shared UI host, and the later scrim
occludes the first modal's controls. `ChatPage` checks the page lifetime and
list/direct/group route kind before rendering the selected fixture.

Place a BottomSheet's surface attributes on its dialog root through the
primitive's HTML attribute API. Its body may be taller than the viewport while
the dialog remains bounded and scrollable; measuring that content body as the
surface incorrectly reports clipping. The browser lifetime owner checks one
modal, dialog containment, actual touch scrolling to the last action, dismissal
and no automatic editing focus. The native inventory must still be rerun.

Chat loading/empty/search-empty markers exclude the retained Messages header.
Their control scope includes the page, just like launch notices, so search and
new-conversation actions remain part of the usability audit.

The diagnostic panel itself must remain usable. Its old fixed right drawer
placed a small close button in the system safe area and let the flex log body
grow beyond the clipped application. It now composes the shared bottom Drawer:
the primitive owns dismissal, focus and the shrinking scroll body; the app
provides diagnostics and safe-area geometry. The launcher no longer overlaps
bottom navigation.

The same touch regression exposed a global `touchend` handler that cancelled
every second touch within 300ms, swallowing a rapid open/close sequence. Delete
that double-tap handler; retain CSS `touch-action: manipulation` and the pinch
gesture guard. The existing browser lifetime owner loads the actual guards and
Debug component, checks rapid touch close, real touch scrolling, fixed close
geometry, outside/Escape dismissal and restored underlying actions at narrow
portrait and landscape sizes. Native Debug controls are exercised by the
original whole-product Gate before the full inventory walk.

### Flex centering clips bottom actions in short landscape viewports

An overlay taller than a landscape viewport, combined with
`align-items: center` and `overflow-y: auto`, clipped the final action beneath
the tab bar where it was both unreachable and occluded. Top-anchor the
container (`align-items: flex-start`), give the panel `margin-block: auto`
plus `max-height: 100%`, scroll the body (`min-height: 0; overflow-y: auto`)
and pin the action row (`flex: 0 0 auto`). The panel centers when it fits and
scrolls from the top when it does not.

### A PASS label is not proof without named assertions

`require_report_proof` rejects an `acceptance-gate-evidence-report` whose
`assertions` array is missing, empty, or contains any non-passing entry,
regardless of its `proofStatus`. Gates with a custom `execute()` that build
their own report bypass the base `EvidenceReport`; they must explicitly record
evidence-backed assertions via `self.assert_condition(...)` and bind
`self.report.to_dict()["assertions"]` into the written report. Assertions must
restate conditions already validated against captured evidence, never
hard-coded `True`.

### Keyboard captures require an actual native keyboard

The 2026-11-14 run stopped at `chat.list-search` because the collector allowed
height contraction only for the message composer. Chat and Contacts searches
also focus native text fields. Their entry actions now touch the native field
and wait for the keyboard before capture. Height contraction is accepted only
for these declared input actions, with unchanged width, positive integer
height, a real native keyboard and a text field above it. Width drift, height
growth, missing keyboard and occluded input remain failures.

Capture screenshot, redacted DOM/accessibility and `capture-observation.json`
before checking findings. A failed surface must retain both expected and actual
geometry; no interaction PASS artifact is emitted for the failure.

Keyboard activation can fail before normal capture begins. The original
inventory owner also captures entry failures: native screenshot/AX, DOM and
active-input/layout/visual-viewport geometry, then rethrows the original error.
Never clear the application before saving that failed native state.

The subsequent landscape search run reported `textFieldBottom=105` and
`keyboardTop=75`, although its screenshot showed the complete input above the
keyboard. The application/text field were in landscape coordinates
(`874x402`, input `y=65,height=40`); the entire keyboard subtree retained
portrait coordinates (`x=2,y=75,width=162,height=724`).
The installed WDA maps `LANDSCAPE` to landscape-left. The shared keyboard audit
normalizes a keyboard rectangle only when it escapes the landscape bounds but
fits the corresponding portrait bounds: `(x,y,w,h)` becomes
`(y,screenHeight-x-w,h,w)`. That observation becomes
`x=75,y=238,width=724,height=162`, matching the native screenshot.
Retain raw and normalized rectangles plus the coordinate-space decision in
the audit evidence. Already landscape-shaped keyboard bounds remain unchanged.
Regression checks must reject both a field below the normalized keyboard top
and a genuine application-coordinate keyboard at `y=75`; normalization must
not waive actual input occlusion.

The next run reached `contacts.add-friend-empty` but its shared search field
was read-only in `ContactsFixturePeople`, so iOS correctly withheld the keyboard.
Fixture result states may be deterministic, but their input must remain editable
like the live page. The shared Find People surface no longer exposes a fixture
read-only switch; the Contacts render regression checks every declared people
state for an enabled, editable input. Keep the native keyboard requirement.

### Station rows must compose inside the Button content container

`station-entry-main` and `station-suggestion` put the Button's single content
container into an 18px grid column. The saved Station name measured 0px wide
and its status escaped the button. Remove those outer icon-column grids and
use the primitive's flex content with the app-owned flexible label slot.
Never override `.pt-button-content` in app CSS.

`apps/mobile/scripts/check-navigation-lifetime.mjs` renders the actual
StationSelector with saved/recommended Stations, short/long names, narrow
portrait and landscape viewports, and 1.35x text. It checks readable label
width, trailing status containment, icon size and touch targets. This browser
regression is component evidence; repeat the native inventory for product proof.

## Triage recipe

1. Read `mobile-whole-product/surface-evidence.json` — `findings[]` names the
   first failing surface and the exact control label/geometry.
2. For occlusions, scan every `interaction.json` for non-empty `occlusions`
   and open the matching `screenshot.png`; labels identify the covered
   control, the screenshot identifies the occluder.
3. When the gate log says PASS but the runner says "source report is
   unproven", inspect `result.json` for the `assertions` array and re-read
   `core/proof.py::require_report_proof`.
4. Each viewport cell (`portrait-normal`, `portrait-maximum-text`,
   `landscape-normal`) is captured independently; maximum-text runs the
   1.35x font scaling and exposes clipping that normal text size hides.
   Reapply the selected size after entering every surface: fixtures and
   navigation replace DOM nodes after the cell is configured. Restore all
   previously scaled inline styles first, measure every baseline before any
   write, then scale. Otherwise later surfaces remain at normal size or
   inherited/repeated multipliers compound. A maximum-text capture with no
   scalable content must fail before collecting its evidence.

## How to detect a recurrence

- `python3 -m unittest tooling.acceptance.gates.mobile.simulator_whole_product_usability_e2e_test`
  covers the page-control classification, debug-toggle hit-testing, proof
  assertion pass/reject paths, and the audit script contract.
- Mobile source-contract tests under
  `apps/mobile/src/components/designSystemTouchTargets.test.tsx`,
  `features/entry/EntryScreen.test.ts` and
  `components/recovery/recoveryActions.test.ts` pin the 44px geometry,
  page-scope markers and landscape-safe panel rules without a simulator.

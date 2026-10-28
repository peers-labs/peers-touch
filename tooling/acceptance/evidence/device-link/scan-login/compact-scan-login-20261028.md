# Compact Reference Scan Login — Post-Merge Regression (2026-10-28)

- Scope: scan login only, on the merged PR #165 tree (`589ba7d4`, identical to
  merge commit `c1c856eb`). Station deployed at that commit via Profile
  `station-1`; Desktop acceptance binary and Android APK built current-source.
- Result: **FUNCTIONAL_PASS** for desktop GUI QR → Android camera scan →
  compact reference exchange → GUI approval → granted session, on two emulators
  (coexistence) plus targeted revocation. iOS camera and real optical capture
  remain `UNPROVEN` (manual).

## Defects found and fixed (working tree, uncommitted)

1. **Transform-polluted QR measurement** — `packages/schema/src/QRCode.tsx`
   sized the encode from `getBoundingClientRect()`. During the modal zoom
   animation under load the first read returned a transformed (sub-threshold)
   width; `ResizeObserver` never re-fires for pure transform resolution, so the
   modal stayed on "Unable to create a readable code" until manual Refresh.
   Fix: measure the transform-immune `clientWidth`. Regression: DOM test with a
   scaled ancestor (rect 238 px, layout 340 px).
2. **QR budget drifted from the payload** — compact locators now carry
   `relayEd25519` and a leaf SPKI pin: the live code is 368 chars / QR v15
   (77 modules). At 280 px that yields 3 px modules, which an independent
   decoder rejects for both styles; 4 px needs 340 px. The old test fixture
   omitted the new fields (251 chars) and masked the drift. Fix: 400 px modal,
   340 px stage, `minModulePixels: 4` so future density growth fails loudly.
   Regression: production-shaped fixture decodes at 340/4px; 280 px under the
   4px floor is rejected `PAYLOAD_TOO_DENSE`.

Files: `packages/schema/src/QRCode.tsx`, `packages/schema/src/QRCode.test.tsx`,
`packages/schema/src/qr/prepare.test.ts`,
`apps/desktop/src/components/settings/DeviceLinkPanel.tsx`,
`apps/desktop/src/components/settings/DeviceLinkPanel.stage.test.ts`.

## Evidence

- Deterministic: schema 50 tests pass; desktop check + 1322 tests pass.
- Real product Journeys A (comparison code 135851) and B (766530): both reached
  kernel state 8 and the phone entered the Chats shell; Station registered both
  mobile sessions. Revoking B kicked only B ("session expired" sheet) while A
  stayed functional.
- Machine-readable record and artifact list:
  `compact-scan-login-20261028.json`. Receiver-visible screenshots and harness
  outputs live in the runtime scratch directory named there; they are not
  committed (large/runtime evidence stays outside Git).

## Harness note

The runtime pauses device-link polling while `document.hidden` is true and
refreshes on `visibilitychange`. The real desktop window must be fronted in an
automation run; the approval UX by design requires a visible desktop.

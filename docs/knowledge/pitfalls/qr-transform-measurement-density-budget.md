---
kind: pitfall
title: QR measurement must ignore transforms and track payload density
status: active
owns:
  - packages/schema/src/QRCode.tsx
  - packages/schema/src/qr/prepare.ts
  - apps/desktop/src/components/settings/DeviceLinkPanel.tsx
referenced-by:
  - docs/client/common/ui-identity/layout.md
related:
  - tooling/acceptance/evidence/device-link/scan-login/compact-scan-login-20261028.md
detected: 2026-10-28
owner: client-platform
review-cadence: annual
next-review: 2027-10-28
---

# QR measurement must ignore transforms and track payload density

## Symptom

The device-link sign-in modal showed "Unable to create a readable code. Refresh
and try again." on its first open after a cold start. Pressing Refresh rendered
the code normally, so the kernel offer and encoder were healthy; only the first
measurement sequence failed and never recovered without manual interaction.

A second, latent defect existed behind the first: once measurement was fixed,
the live 368-char compact reference encoded at QR v15, and the 280px stage
yielded 3px modules that independent decoders (jsQR, both `peers` and
`classic` styles) rejected. Optical scanning only worked from enlarged
posters, not from the on-screen modal.

## Root cause

Two independent properties were misread:

1. `getBoundingClientRect()` reports the **transformed** box. While the modal
   zoom animation (`transform: scale(...)`) is running under load, the first
   size read can return a sub-threshold width. `ResizeObserver` observes the
   layout box, which never changes during a pure transform, so no correction
   callback fires after the animation ends — the failed encode is permanent
   until a manual retry changes an input.
2. QR pixel budget is a function of payload length, not a fixed UI constant.
   The compact locator gained `relayEd25519` and `endpointTlsTrust` material;
   the test fixture omitted those fields and stayed at 251 chars (QR v11), so
   the 280px/3px budget kept passing while production produced v15.

## Mitigation

### What was done in code

- `packages/schema/src/QRCode.tsx`: measure the transform-immune content box
  (`clientWidth`), matching ResizeObserver content-box semantics.
- `apps/desktop/src/components/settings/DeviceLinkPanel.tsx`: 400px modal,
  340px stage, `minModulePixels: 4`. Density growth now fails loudly with
  `PAYLOAD_TOO_DENSE` instead of rendering an undecodable code.
- Test fixtures now use the production-shaped 368-byte reference with the
  relay key and leaf SPKI pin.

### What guards against regression

- `packages/schema/src/QRCode.test.tsx`: a scaled ancestor (rect 238px) with a
  340px layout box must still reach `ready`.
- `packages/schema/src/qr/prepare.test.ts`: the 368-byte reference decodes at
  340px/4px and 280px is rejected with `PAYLOAD_TOO_DENSE` under the 4px floor.
- `apps/desktop/src/components/settings/DeviceLinkPanel.stage.test.ts` pins
  the shared stage geometry so all phases stay one size.

## Recurrence (2026-11-18): zero-margin density budget on a slightly narrow host

### Symptom

The sign-in modal again showed `qrFailed` on cold start even though the
transform-immune `clientWidth` measurement and the 340px stage were both
intact. Frame-by-frame sampling through the real `pt-surface-in` scale
animation showed `clientWidth` holding a steady 340 with zero sub-threshold
frames, so the 2026-10-28 measurement fix was not the culprit.

### Root cause

The v15 compact reference is 85 columns (77 modules + 2×4 quiet zone), so
`floor(340 / 85) = 4.0` — the 4px decodability floor had **zero margin**. Any
real host that measured even 4px narrower (336px) dropped to
`floor(336 / 85) = 3` and failed loudly with `PAYLOAD_TOO_DENSE`, while the
UI discarded the `SchemaError` code, making the failure indistinguishable
from a measurement or render fault.

### Mitigation

- `prepareQr` now adapts the quiet zone (4 → 3 → 2) before failing whenever
  the caller has not pinned `quietZoneModules`. Data modules never shrink
  below `minModulePixels`; only the surrounding margin trades away, and the
  white modal surface still supplies a visual quiet zone. Explicit quiet
  pins opt out, and boxes below the smallest recoverable size (the 280px
  case) still fail loudly.
- `DeviceLinkPanel` forwards the `SchemaError.code` and offer id to
  `console.error` instead of swallowing it, so a future cold-start failure
  is diagnosable from the webview console.

### Guards added

- `prepare.test.ts`: 336px must recover at quiet=3 and 324px at quiet=2 with
  jsQR still decoding the original payload; an explicit `quietZoneModules:4`
  at 336px and the 280px box must still reject.

## How to detect a recurrence

```bash
cd packages/schema && npx vitest run src/QRCode.test.tsx src/qr/prepare.test.ts
```

When adding any field to a QR-carried message, rebuild the encoder test
fixture from a live payload and re-run the size/style decode matrix; do not
trust a synthetic minimal message. When any component sizes itself from an
element inside an animated/transformed ancestor, measure `clientWidth`/
`offsetWidth`, never `getBoundingClientRect().width`, unless the painted size
is explicitly required.

## Crosswalks

- The multi-phase constant-geometry rule lives in
  `docs/client/common/ui-identity/layout.md` §3.2 (device-link reference
  overlay 400×557).
- Runtime polling intentionally pauses while `document.hidden` is true; an
  acceptance run must front the real desktop window before scanning. This is
  product behavior, not part of this pitfall.

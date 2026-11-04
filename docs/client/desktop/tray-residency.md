# Desktop Tray Residency

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-14
> **Updated**: 2026-10-30
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/src-tauri/src/application/tray/`

## 1. Product Contract

`DSTR-C01` keeps Peers Touch available from the macOS menu bar after the main
window is hidden. The status item is a compact rounded-square button with a
cut-out `P`. This dedicated menu-bar mark remains legible at native icon size.

The macOS artifact contract is:

- one 36 x 36 pixel RGBA PNG, interpreted as an 18 x 18 point Retina template image;
- editable SVG artwork in `apps/desktop/src-tauri/icons/tray-icon-macos.svg`;
- a 17 x 17 point filled square, 4 point corner radius, and a geometric cut-out
  `P`, with no font dependency, outline, gradient, or shadow;
- transparent, opaque, and antialiased alpha samples;
- native Template rendering so macOS owns light/dark appearance;
- accessibility help text `Peers Touch`;
- one `AXMenuBarItem` / `AXMenuExtra` status item, targeting 36 x 24 points on
  the supported runtime cell (18 point artwork plus native horizontal padding).
  This revised geometry requires a fresh native Accessibility observation;
  the previous wordmark's proof does not establish it.

Other Desktop platforms retain the packaged application icon until they gain
their own accepted shell contract.

## 2. Journey DSTR-J01

1. A packaged macOS Peers application starts from exact source.
2. The process exposes one `Peers Touch` status item with the accepted
   rounded-square `P` geometry.
3. Closing the main window hides it without terminating the process or status
   item.
4. The status-item `Show Peers Touch` action restores and focuses the main
   window. The implementation also binds a primary tray click to the same
   restore owner.
5. Quitting or Acceptance teardown removes the process, status item, ports,
   and temporary storage.

## 3. Visible State Contract

| State | User-visible result | Allowed action |
|---|---|---|
| `window-visible` | Main window and status item are present | Close or use the tray |
| `hidden-resident` | Main window is absent; status item remains present | Restore or quit |
| `window-restored` | Main window is visible, focused, and frontmost | Continue using Desktop |
| `terminated` | Process and status item are absent | Launch again |

The status item must not disappear while the process is alive, open a duplicate
main window, or require a browser-only surface.

## 4. Acceptance Contract

| ID | Assertion | Required evidence |
|---|---|---|
| `DSTR-A01` | The source asset is exactly 36 x 36 with template-compatible alpha | Source-bound PNG inspection and Rust test |
| `DSTR-A02` | The packaged binary contains the exact tray asset and matches the launched process | Package, binary, process, and SHA-256 identity |
| `DSTR-A03` | macOS exposes one `Peers Touch` `AXMenuBarItem` / `AXMenuExtra` at the targeted 36 x 24 points | Fresh native Accessibility snapshot; revised geometry remains unproven until observed |
| `DSTR-A04` | Closing the main window leaves the process and status item alive | Native window and process observation |
| `DSTR-A05` | The status-item Show action restores a focused frontmost window | Native Accessibility action and postcondition |
| `DSTR-A06` | Reverse cleanup removes the process, status item, ports, and temporary storage | Provisioner and runtime-cell cleanup evidence |

Screenshots are supporting visual evidence only. They cannot replace
Accessibility geometry, exact source/package identity, restore postconditions,
or cleanup proof.

## 5. Non-Claims

- No Linux or Windows tray appearance claim.
- No installer signing or notarization claim.
- No claim that one screenshot proves Template rendering across every macOS
  theme or display arrangement.
- No Chat, Station, account, or message behavior claim.

## 6. Visual Review And Change Record

- Surface: native macOS menu-bar utility button. The visual thesis is immediate
  Peers recognition with a smaller horizontal footprint than the wordmark.
- Positive calibration: one quiet, high-contrast silhouette; a generous `P`
  cut-out and rounded corners remain readable at 18 points.
- Negative calibration: no long text label, decorative color, thin outline,
  or custom hover/pressed treatment. AppKit owns those interaction states.
- 2026-10-30: Replaced the full wordmark at the user's request with the
  rounded-square `P`; kept Template rendering and the existing tray actions.
  Previous source/package and geometry evidence is stale for this artwork.

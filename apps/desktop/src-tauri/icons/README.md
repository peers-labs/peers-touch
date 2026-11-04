# Desktop Icons

The macOS menu-bar icon is a rounded-square button with a cut-out `P`.
`tray-icon-macos.svg` is the editable vector artwork;
`tray-icon-macos.png` is its 36 × 36 RGBA Retina export, embedded by
`src/application/tray/mod.rs` and rendered as a native template image.
Keep the background and letter cut-out transparent, use black RGB channels,
and retain antialiased edges when re-exporting at 144 DPI.

The Dock/application icons and other platforms' tray icons use the existing
application artwork. The governing menu-bar contract is
[`tray-residency.md`](../../../../docs/client/desktop/tray-residency.md).

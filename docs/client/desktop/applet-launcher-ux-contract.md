# Desktop Applet Launcher UX Contract

> Status: Desktop platform contract.
> Audience: Desktop applet runtime engineers, reviewers, and AI agents.
> Updated: 2026-06-17.

## 1. Purpose

The Desktop applet launcher is an app identity surface and a launch surface. It is not a developer management dashboard, permission audit view, or runtime diagnostics panel.

The primary user task is:

- Identify the intended applet quickly.
- Open it with confidence.
- Recover when the applet cannot open.

Management actions such as close, disable, uninstall, version inspection, permission inspection, and diagnostics belong to the applet detail/runtime surface or a dedicated management flow, not the launcher grid.

## 2. UX Dimensions Covered

This contract covers:

- Task success.
- Visual continuity.
- Information hierarchy.
- Interaction discoverability.
- Feedback and recovery.
- Content strategy.
- Platform fit.
- Extreme data.
- Accessibility.

Out of scope:

- Store discovery, ratings, advertising, payment, and distribution ranking.
- Mobile launcher behavior.
- Applet internal page UI.

## 3. Launcher Anatomy

```text
AppletLauncherPage
├─ LauncherHero
├─ RecentAppletSection
└─ AllAppletSection
   └─ AppletTile[]
      ├─ IconSurface
      │  ├─ IconAsset | SemanticMark | GeneratedIdentityMark
      │  └─ OptionalStatusDot
      └─ AppletName
```

Rules:

- `AppletTile` is a launch intent, not an information card.
- `IconSurface` is the primary applet identity.
- `AppletName` is the secondary applet identity and may wrap to two lines.
- Section labels must organize the grid without competing with app identities.
- Launcher copy must be short and user-facing.

## 4. Applet Identity Rules

Logo resolution order:

1. Use `manifest.icon` as an applet package asset when it is a relative path.
2. Use `manifest.icon` as an image URL when it is an absolute `http`, `https`, `data`, or app asset URL.
3. Use an official applet identity override for first-party applets that do not ship a usable icon.
4. Use semantic icon mapping from manifest metadata when available.
5. Use a deterministic generated identity mark from `manifest.id`.

Required behavior:

- Different applets must not collapse to the same default logo.
- Generated identity marks must be deterministic across refreshes.
- Generated identity marks must vary by color and short label.
- A missing icon is acceptable; an indistinguishable icon set is not.

Forbidden patterns:

- Mapping `manifest.icon` only as an enum name.
- Rendering all unknown applets with the same fallback icon.
- Using permission, version, or author metadata as the visual identity on the launcher.

## 5. Tile Visual Rules

Required:

- Icon surfaces must have stable dimensions and aligned centers.
- Tiles must use consistent hit targets across sections.
- Hover and pressed states must confirm clickability without turning tiles into cards.
- Active/running state may be shown as a small status dot, but must not dominate identity.
- Long names must be truncated or wrapped without changing grid rhythm.

Forbidden:

- Large management cards on the launcher.
- Multiple independent borders inside one launch tile.
- Dense technical metadata on the launch surface.
- A visible management CTA next to every applet on the launcher.

## 6. Feedback And Recovery

The launcher must provide:

- Loading state while applet registry data is loading.
- Empty state when no applets are installed.
- Toast or inline feedback when launch fails.
- Runtime page fallback with retry and return path when rendering fails or readiness times out.

## 7. Acceptance Checklist

- [ ] User can identify distinct applets by logo and name without reading technical metadata.
- [ ] Applets with relative `manifest.icon` assets render those assets.
- [ ] Applets without icon assets receive deterministic, visually distinct generated identity marks.
- [ ] Launcher does not expose version, permission, author, enable, disable, uninstall, or diagnostics as primary content.
- [ ] Tile hover, pressed, focus, loading, empty, long-name, and many-app states have defined boundaries.
- [ ] Runtime failure has retry, return, and detail affordances.
- [ ] All user-facing strings use locale keys.

# Desktop Navigation And Settings Ownership

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-28 | **Updated**: 2026-09-28
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/src/components/`, `apps/desktop/src/modules/`, `apps/desktop/src/pages/SettingsPage.tsx`

## 1. Scope

This contract defines which Desktop surfaces qualify for the primary
navigation rail and which utility surfaces belong inside Settings.

It does not change the official Note applet, applet service APIs, Chat's
conversation notebook, or Station persistence.

## 2. Product Decision

The primary rail contains product destinations and pinned product instances.
Configuration and operational utilities do not own primary-nav entries.

| Surface | Owner after cutover | Standalone route |
|---|---|---|
| Notes workspace | Deleted | No |
| Official Note applet (`peers.note`) | Applet launcher/runtime | `applet:peers.note` only |
| My Files | Settings > Data > My Files | No |
| Cron Jobs | Settings > Tools > Cron Jobs | No |
| Channels | Settings > Channels | No |
| Command Palette | Global overlay plus Settings > Tools entry | No |

The canonical Command Palette remains globally available through its existing
shortcut. Settings exposes an explicit action that opens that same overlay; it
must not create a second palette implementation.

## 3. Journey DPNC-J01

1. The user enters the authenticated Desktop shell.
2. The primary rail does not show Notes, My Files, Cron Jobs, Channels, or a
   Command Palette icon.
3. The user opens Settings and can select My Files, Cron Jobs, Channels, and
   Command Palette from their owning Settings groups.
4. Each utility keeps its existing functional controls. The Command Palette
   Settings action opens the canonical global overlay.
5. The global Command Palette shortcut still opens the same overlay.
6. The Applets surface can still expose and launch the official Note applet.

## 4. Route And State Contract

- `notes` is not a host page or applet navigation target.
- Old `#/notes`, `#/notes/<id>`, `/notes/<id>`, and `/pages/<id>` links fall
  back to the normal default page; they never redirect to `peers.note`.
- `pt://cron` opens Settings at `cron`.
- `pt://channels` opens Settings at `channels`.
- Settings-owned My Files, Cron Jobs, and Channels use `selected-only`
  `SectionHost` caching so hidden utilities do not continue fetching or
  polling.
- Leaving a selected-only utility discards transient local filters and open
  drawers. Persisted server state is unchanged.
- Loading, empty, error, and mutation feedback remain owned by each utility.

## 5. Decisions

### DPNC-D01: Utility freshness is visibility-scoped

**Status**: accepted

My Files, Cron Jobs, and Channels have no hidden-shell badge or cross-surface
freshness consumer. Their current list projections therefore remain
view-scoped and reload on each Settings section activation. `selected-only`
unmount is the lifecycle owner: it cancels Cron polling and prevents hidden
fetch work. If another surface later consumes this state, that change must
introduce a RuntimeProjection before enabling hidden freshness.

### DPNC-D02: Command Palette has one overlay owner

**Status**: accepted

`CommandMenu` and `commandMenu` store remain the only overlay implementation.
The Settings section may invoke `openMenu()` but cannot duplicate command
catalog, query, selection, or keyboard handling.

## 6. Acceptance Matrix

| User task | Context | Expected result | Evidence |
|---|---|---|---|
| Scan primary rail | Authenticated Desktop | Five removed entries are absent; remaining entries are usable | Exact-source browser/native DOM journey |
| Manage files | Settings > Data > My Files | Existing list, filters, upload, edit, delete, and restore controls render | Exact-source interactive journey |
| Manage schedules | Settings > Tools > Cron Jobs | Existing job list and create/refresh controls render; hidden polling stops after leaving | Exact-source interactive journey plus lifecycle test |
| Manage channels | Settings > Channels | Full channel management surface renders, not the reduced overview panel | Exact-source interactive journey |
| Open command palette | Settings > Tools and global shortcut | Both paths open the same canonical overlay | Exact-source interactive journey |
| Open old Notes route | Direct hash/deep link | Default page is shown; Note applet is not substituted | Router test and interactive journey |
| Launch Note applet | Applets | `peers.note` remains registered and launchable | Applet contract gate plus source diff |

The dedicated `desktop-primary-navigation-e2e` Gate owns the first six rows and
must produce exact-source DOM evidence. `applet-domain-validation` owns the
official applet contract row.

## 7. Non-claims

- No Mobile navigation change.
- No migration of standalone Notes data into the Note applet.
- No compatibility alias for removed standalone routes.
- No change to Note applet files, service paths, or storage semantics.

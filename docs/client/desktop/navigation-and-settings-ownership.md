# Desktop Navigation And Settings Ownership

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-28 | **Updated**: 2026-10-21
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/src/components/`, `apps/desktop/src/modules/`, `apps/desktop/src/pages/SettingsPage.tsx`

## 1. Scope

This contract defines which Desktop surfaces qualify for the primary
navigation rail and which utility surfaces belong inside Settings.

It does not change the official Note applet, applet service APIs, Chat's
conversation notebook, or Station persistence.

## 2. Product Decision

The primary rail is a fixed shell contract. Feature registration, pinned
Agents, installed applets, and user preferences cannot inject entries.

| Surface | Owner after cutover | User-facing route |
|---|---|---|
| Search | Primary rail, position 1 | `search` |
| Chat | Primary rail, position 2 | `chat` |
| Agent | Primary rail, position 3 | `agent`; Atelier is the Agent-owned secondary work surface and absorbs orchestration |
| Moments / Social | Primary rail, position 4 | `moments` |
| Notifications | Bottom rail overlay | No standalone page |
| Settings | Bottom rail | `settings` |
| Discover / package catalog | Settings > AI > Discover | No standalone page |
| Memory management and configuration | Settings > AI > Memory | No standalone page |
| Applets launcher | Hidden runtime support surface | Internal `applets`; never injected into the primary rail |
| Applet instance | Runtime-owned dynamic surface | Internal `applet:<id>`; never injected into the primary rail |
| Evaluation | Internal capability and Acceptance surface | No user entry |
| Home / Project | Internal or retired capability | No primary-rail entry |
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
2. The top rail is exactly Search, Chat, Agent, Moments in that order. The
   bottom rail owns Notifications and Settings.
3. The rail does not show Home, Project, Evaluation, Discover/Marketplace,
   Memory, Applets, pinned Agents, pinned applets, Notes, My Files, Cron Jobs,
   Channels, or a Command Palette icon.
4. The user opens Settings and can select Discover and Memory under AI, plus
   My Files, Cron Jobs, Channels, and Command Palette under their owning groups.
5. Each Settings utility keeps its existing functional controls. The Command Palette
   Settings action opens the canonical global overlay.
6. The global Command Palette shortcut still opens the same overlay.
7. Internal Applets routing can still launch installed applets without becoming
   a generic first-level destination.

## 4. Route And State Contract

- `notes` is not a host page or applet navigation target.
- `marketplace` and `memory` are not host pages. Old direct hashes fall back to
  the normal default page instead of redirecting through compatibility aliases.
- Semantic Marketplace navigation requests select Settings > AI > Discover.
- `applets` and `applet:<id>` remain internal runtime routes; neither route
  authorizes a global navigation item or Pin-to-Rail affordance.
- `evaluation` remains registered for internal runtime and Acceptance use, but
  has no rail or Command Palette entry.
- Old `#/notes`, `#/notes/<id>`, `/notes/<id>`, and `/pages/<id>` links fall
  back to the normal default page; they never redirect to `peers.note`.
- `pt://cron` opens Settings at `cron`.
- `pt://channels` opens Settings at `channels`.
- Settings-owned Discover, Memory, My Files, Cron Jobs, and Channels use
  `selected-only` `SectionHost` caching so hidden utilities do not continue
  fetching, polling, or rendering large catalogs.
- Leaving a selected-only utility discards transient local filters and open
  drawers. Persisted server state is unchanged.
- Loading, empty, error, and mutation feedback remain owned by each utility.

## 5. Decisions

### DPNC-D01: Utility freshness is visibility-scoped

**Status**: accepted

Discover, Memory, My Files, Cron Jobs, and Channels have no hidden-shell badge
or cross-surface view-state consumer. Their current view projections therefore remain
view-scoped and reload on each Settings section activation. `selected-only`
unmount is the lifecycle owner: it cancels Memory/Cron polling and prevents
hidden catalog or list work. Shared business truth remains in its existing
runtime/store owner. If another surface later consumes view state, that change
must introduce a RuntimeProjection before enabling hidden freshness.

### DPNC-D02: Command Palette has one overlay owner

**Status**: accepted

`CommandMenu` and `commandMenu` store remain the only overlay implementation.
The Settings section may invoke `openMenu()` but cannot duplicate command
catalog, query, selection, or keyboard handling.

### DPNC-D03: Primary navigation is explicit shell policy

**Status**: accepted

`AppSideNav` owns the fixed destination set. The Settings module registry owns
Settings sections only; it has no page or sidebar extension API. Installed
resources and pinned entities may influence content within their owning
surface, but never global information architecture.

## 6. Acceptance Matrix

| User task | Context | Expected result | Evidence |
|---|---|---|---|
| Scan primary rail | Authenticated Desktop | Search, Chat, Agent, Moments appear in exact order; all dynamic and excluded entries are absent | Exact-source native DOM journey |
| Switch Agent work surface | Agent | Secondary selector contains exactly Chat and Atelier; orchestration is Atelier-owned | Exact-source native DOM journey |
| Discover packages | Settings > AI > Discover | Trusted package catalog controls render without a standalone Marketplace page | Exact-source native journey |
| Manage Memory | Settings > AI > Memory | Browse, search, persona, events, and configuration remain available in one Settings owner | Exact-source native journey |
| Manage files | Settings > Data > My Files | Existing list, filters, upload, edit, delete, and restore controls render | Exact-source interactive journey |
| Manage schedules | Settings > Tools > Cron Jobs | Existing job list and create/refresh controls render; hidden polling stops after leaving | Exact-source interactive journey plus lifecycle test |
| Manage channels | Settings > Channels | Full channel management surface renders, not the reduced overview panel | Exact-source interactive journey |
| Open command palette | Settings > Tools and global shortcut | Both paths open the same canonical overlay | Exact-source interactive journey |
| Open old Notes route | Direct hash/deep link | Default page is shown; Note applet is not substituted | Router test and interactive journey |
| Launch Note applet | Internal Applets runtime | `peers.note` remains registered and launchable without a primary Applets entry | Applet contract gate plus source diff |

The dedicated `desktop-primary-navigation-e2e` Gate owns navigation placement,
Settings routing, selected-only lifecycle, legacy fallback, and the internal
launcher-to-applet handoff. Domain Gates continue to own package-catalog,
Memory, and applet business behavior beyond reachability.

## 7. Non-claims

- No Mobile navigation change.
- No migration of standalone Notes data into the Note applet.
- No compatibility alias for removed standalone routes.
- No change to Note applet files, service paths, or storage semantics.

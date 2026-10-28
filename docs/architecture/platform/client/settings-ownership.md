# Client Settings Ownership

> **Status**: accepted
> **Created**: 2026-10-28
> **Owner**: Client Platform Team
> **Applies to**: Desktop, Mobile Web, Mobile native hosts
> **Supersedes (in part)**: MS-D22 / MS-D22A device-vs-actor preference allocation
> (`docs/architecture/platform/client/mobile/decisions.md`); the Station-owned
> sections of MS-D22 remain in force.

## 1. Problem

Settings historically accumulated under whatever storage was closest to the
code. The audit before this contract found:

- Desktop persisted personalization in three unrelated places: a Rust
  profile-global `desktop/config/settings.json`, an app-global TS localStorage
  namespace, and an identity-scoped TS kernel. Actor-bound choices (current
  Agent, default model effort, list filters, theme, language) survived logout
  and leaked to the next person logging in on the same machine.
- Mobile stored theme, font size, density, media download, and language in an
  app-global namespace even though the storage kernel already supported
  identity scoping and the device is multi-user.
- The same conceptual attribute (language, theme) had different ownership on
  the two clients.

## 2. Decision

Settings have exactly three ownership layers. Every control declares one
layer and one owner. There is no generic settings store and no fourth layer.

| Layer | Name | Keyed by | Lifetime | Cross-device |
|---|---|---|---|---|
| **L1** | Station-actor | actor PTID at the Station | Survives login/logout on every device; server authority | Yes, by Station owner API |
| **L2** | Device-actor | `(app, station, actor)` on the device | Deleted atomically on logout, session revocation, or account removal | No. Local personalization only |
| **L3** | Device | `(app)` install / physical device | Survives identity changes; belongs to the machine | No |

Rules:

1. **Personalization follows the person.** Any setting that expresses how an
   individual wants the product to look or behave is L2 even when it is not
   synced: theme, language, font size, density, media auto-download, keyboard
   shortcuts, per-list presentation filters, the currently selected Agent.
   A shared device must never show one user's personalization to another.
2. **L1 owns business configuration and secrets.** Provider keys, Agents,
   Skills, MCP, Memory/Knowledge, channels, bots, cron, applets, Federation,
   OSS files, Actor Profile/privacy, notification category preferences, and
   social block lists are Station-owned. Clients are projections. If an L1
   owner is unavailable, its section is disabled; falling back to local
   persistence is forbidden (carried forward from MS-D22).
3. **L3 owns only what is physically about the install**: OS permission
   grants, push/notification device registrations, device capabilities,
   Station connection registry (endpoints, never actor secrets), and local
   cache/storage maintenance operations.
4. **Symmetry.** A given attribute is the same layer on every client. A
   platform may lack a control (desktop has a screenshot shortcut, mobile
   does not), but two clients may never place the same attribute in different
   layers.
5. **No sync claim for L2.** L2 values do not follow the actor to another
   device. Promoting an attribute to cross-device means moving it to L1 with a
   new Station owner API and a product amendment enumerating its fields and
   conflict behavior. Promotion is per-attribute, never blanket.
6. **Pre-identity surfaces** (login, PIN entry, first run) have no L2
   context. They use OS defaults (system language, system theme) and never
   render a previous actor's personalized value.
7. **Hard cut.** The old app-global personalization namespaces are deleted,
   not migrated. Assigning a previous user's global value to whoever logs in
   next would re-create the leak. Everyone starts at defaults on cutover
   (applies MS-D24 "owner cutovers delete legacy semantics atomically").

## 3. Canonical Control Inventory

### 3.1 Identity and security

| Control | Layer | Owner |
|---|---|---|
| Actor profile (display name, bio, avatar), privacy fields | L1 | Actor Profile owner (MS-D22A CAS) |
| Notification category preferences | L1 | Notification owner (MS-D22A CAS) |
| Blocked users | L1 | Social owner |
| Providers, models, API keys, runtime default model/provider | L1 | Agent provider owner (`runtime-default` is the sole default; duplicate local keys deleted) |
| Agents, Skills, MCP servers, Memory/Knowledge, Voice config | L1 | Respective Station owners |
| Cron jobs, channels, bots, connections, applets, OSS files | L1 | Respective Station owners |
| Federation identity/context catalog | L1 | Federation owner |
| Local session PIN | L2 | Per-local-account session vault; device-local secret, deleted with the session, never synced (see `docs/client/desktop/pin-recovery.md`) |
| Login sessions, credentials, HPKE material | L2 | Per-local-account auth identity storage; deleted on logout |

### 3.2 Personalization

| Control | Layer | Desktop | Mobile |
|---|---|---|---|
| Theme / appearance | L2 | identity-scoped preference | identity-scoped preference |
| Language | L2 | identity-scoped preference | identity-scoped preference |
| Font size, compact density | L2 | (when exposed) | identity-scoped preference |
| Media auto-download | L2 | (when exposed) | identity-scoped preference |
| Chat screenshot shortcut | L2 | identity-scoped preference | n/a (no platform control) |
| Currently selected Agent / work surface | L2 | identity-scoped preference | n/a |
| Provider list "show usable only" filter | L2 | identity-scoped preference | n/a |
| Default model effort | L1 | Station runtime-default | Station runtime-default when exposed |
| Other per-list view filters/drafts | L2 | identity-scoped preference | identity-scoped preference |

### 3.3 Device and system

| Control | Layer | Notes |
|---|---|---|
| OS camera/microphone/notification permission grants | L3 | OS-level per install |
| Push notification device registration | L3 | PTID + device bound, credential protected (MS-D23A) |
| Station registry and active Station selection | L3 | Connection endpoints only; actor secrets stay L2 |
| Local cache clear / storage maintenance | L3 operation | Operates on L2 data of the active identity; never a preference |

No telemetry/crash-report consent control exists in the current product;
telemetry upload is authenticated and Station-mediated. If a consent control is
introduced later, it enters this table through the admission rule (§5) rather
than assuming a layer by default.

## 4. Storage Contract

- Both clients use the shared `@peers-touch/client-storage` kernel scopes
  (`app`, `station`, `actor`, `device`, `session`). One preference mechanism
  per client; parallel key/value stores are not allowed.
- L2 personalization lives under `config.preference` in the identity scope
  `(app, station, actor)`. L3 values live in the `app` scope with a distinct
  domain; they never share keys with L2.
- Logout/session-revocation hard-deletes the identity-scoped preference
  namespace: Desktop already invalidates `config.preference` in the identity
  pipeline; Mobile session revocation invalidates `config.preference` for the
  revoking actor. Readback after logout must show zero identity-scoped
  preference rows.
- The Desktop Rust profile-global `desktop/config/settings.json` KV and its
  Tauri/HTTP command surface are deleted entirely; theme/locale had no Rust
  consumer. The web identity scope is the one L2 mechanism on both clients.
- Station-owned saves keep authoritative readback, observed revision, and
  typed conflict outcomes (MS-D22A).

## 5. Admission Rule For New Settings

A PR adding or moving a Settings control must include in its description:

1. the attribute name;
2. its layer (L1/L2/L3) and concrete owner/store;
3. its lifetime across logout, account removal, and reinstall;
4. the symmetric entry for the other client (control, planned, or n/a with
   platform reason).

Review rejects settings changes that create an unscoped/local-generic store
or that place the same attribute in different layers across clients.

## 6. Verification

- Static: one preference write path per client; grep for app-global writes of
  the L2 keys (`theme`, language, font size, density, media download) returns
  zero outside the identity-scoped repositories.
- Unit: identity scope isolation in the shared kernel (existing) plus
  client-level tests that L2 defaults are read for an unknown actor.
- Product journey (both clients): actor A sets theme + language + an L2
  filter, logs out; actor B logs in on the same device and sees OS defaults
  and none of A's values; L1 data (providers, profile) is independently
  scoped; L3 values (Station registry, permission grants) remain.
- Re-login: A signs back in after B; L2 starts at defaults (local-only) and
  L1 state is A's own.

## 7. Decisions Superseded

- MS-D22 statement "deviceSettingsRuntime owns theme, font size, compact
  density, device-local language, cache controls" is superseded for theme,
  font size, density, media download, and language: those are L2
  identity-scoped. Its Station/Actor/Notification/Social owner split and the
  "no generic settings store" principle remain and are elevated to a
  cross-client rule.
- Desktop `runtime-projections.md` classification of the settings runtime
  as identity-independent `app` scope is superseded for personalization
  reads; the runtime observes the active identity edge for L2 data.

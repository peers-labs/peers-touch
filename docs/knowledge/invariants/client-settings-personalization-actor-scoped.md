---
kind: invariant
title: Client personalization is L2 actor-scoped and dies on logout
status: active
owns:
  - apps/desktop/src/runtimes/personalization.ts
  - apps/desktop/src/runtimes/settingsRuntime.ts
  - apps/desktop/src/store/settings.ts
  - apps/desktop/src/i18n/index.ts
  - apps/mobile/src/runtimes/deviceSettingsRuntime.ts
  - apps/mobile/src/runtimes/sessionRuntime.ts
  - apps/mobile/src/app/mobileI18n.tsx
  - packages/client-storage/src/index.ts
  - docs/architecture/platform/client/settings-ownership.md
referenced-by:
  - pitfalls/global-personalization-leaks-across-actors.md
related:
  - docs/architecture/platform/client/settings-ownership.md
  - docs/global/coding-guide/mobile/storage.md
detected: 2026-10-28
owner: Client Platform Team
review-cadence: annual
next-review: 2027-10-28
---

# Client personalization is L2 actor-scoped and dies on logout

## What must hold

Every Settings control declares exactly one ownership layer — L1
Station-actor, L2 device-actor, or L3 device/install — per
[Client Settings Ownership](../../../architecture/platform/client/settings-ownership.md).

Personalization (theme, language, font size, density, media auto-download,
keyboard shortcuts, per-list presentation filters, currently selected Agent)
MUST be L2 on both Desktop and Mobile: stored in the identity scope
`(app, station, actor)` under the `config.preference` domain of
`@peers-touch/client-storage`, written through the per-client personalization
path, never through an app-global/OS-user namespace. The same attribute MUST be
the same layer on every client.

Logout, session revocation, and account removal MUST hard-delete the actor's
L2 namespace. Pre-identity surfaces (login, PIN, first run) MUST read OS
defaults only. L3 values (Station registry, permission grants, cache
maintenance) stay app-scope and survive identity changes; L1 business config
stays Station-owned with no local fallback. There MUST NOT be a second,
generic settings key/value store on either client.

## Why this is non-negotiable

A device is multi-user. The original Desktop implementation persisted
personalization in an OS-user-global Rust `config/settings.json` and an
app-global TS namespace; Mobile used an app-global namespace for theme and
language. Actor-bound choices therefore survived logout and were rendered to
the next person signing in on the same machine — a cross-actor data leak, not
a cosmetic bug. Language additionally gates what every screen says, so the
leak is visible before the user opens Settings.

Three failure modes return immediately if the invariant is weakened:

1. a new app-global write path silently recreates the leak even though the
   identity-scoped path still exists (two stores diverge);
2. logout that clears UI state but not the persisted namespace resurrects the
   values on the next login;
3. asymmetric placement across clients (e.g. language synced as L1 on one
   client, L2 on the other) makes the attribute's lifetime undecidable and
   reintroduces cross-device claims the product never authorized.

L2 values are deliberately local-only. Promoting an attribute to cross-device
is an L1 product amendment per attribute, never a blanket sync of the L2
namespace.

## How to verify

- `rg -n "settingsGet|settingsSet|settings_reset|config/settings\\.json" apps/desktop apps/mobile` — must return zero code hits (documentation history may mention the deleted surface).
- `rg -n "localStorage\\.(get|set)Item" apps/desktop/src/store/settings.ts apps/desktop/src/i18n apps/mobile/src/runtimes/deviceSettingsRuntime.ts apps/mobile/src/app/mobileI18n.tsx` — must return zero hits for personalization keys.
- `rg -n "config.preference" packages/client-storage/src/index.ts` — domain must remain `scope: actor`.
- `cd apps/desktop && pnpm run test -- settings personalization` — must pass, including teardown reset of shortcut/filter/language.
- `pnpm --filter @peers-touch/app-mobile exec vitest run src/runtimes/deviceSettingsRuntime.test.ts src/runtimes/runtimeRegistry.test.ts` — must pass; descriptor must keep `dependsOn: ['session']`.
- Product journey both clients: actor A sets theme/language/filter → logout → actor B sees OS defaults and none of A's values while L1 data and the L3 Station registry remain → A re-logs in: L2 at defaults, L1 is A's own.

## Crosswalks

- See pitfall `pitfalls/global-personalization-leaks-across-actors.md` for the leak that this invariant closes.
- See `docs/architecture/platform/client/settings-ownership.md` for the full three-layer contract and control inventory.
- See `docs/global/coding-guide/mobile/storage.md §5` for the storage scope decision rule.

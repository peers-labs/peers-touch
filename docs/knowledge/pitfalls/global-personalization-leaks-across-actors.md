---
kind: pitfall
title: Global settings stores leak one actor's personalization to the next
status: active
owns:
  - apps/desktop/src/runtimes/personalization.ts
  - apps/desktop/src/runtimes/settingsRuntime.ts
  - apps/desktop/src/store/settings.ts
  - apps/desktop/src/i18n/index.ts
  - apps/mobile/src/runtimes/deviceSettingsRuntime.ts
  - apps/mobile/src/runtimes/sessionRuntime.ts
  - apps/mobile/src/app/mobileI18n.tsx
referenced-by: []
related:
  - docs/architecture/platform/client/settings-ownership.md
detected: 2026-10-28
owner: Client Platform Team
review-cadence: annual
next-review: 2027-10-28
---

# Global settings stores leak one actor's personalization to the next

## Symptom

On a shared machine, actor A changes language, theme, the chat screenshot
shortcut, or the Provider list "show usable only" filter, then logs out. Actor
B logs into the same Desktop install and immediately sees A's language and
personalization in the shell. On Mobile, theme/font/language were likewise
stored app-globally and rendered regardless of which actor was authenticated.

## Root cause

Personalization was persisted in whichever store was closest to the code
instead of in a store keyed by identity: Desktop had an OS-user-global Rust
KV at `desktop/config/settings.json` plus an app-global TS localStorage
namespace, and Mobile had an app-global preference namespace. The storage
kernels already supported `(app, station, actor)` scoping, so the leak was an
ownership defect: personalization expresses how an individual wants the
product to behave but was stored as if it were a device/install property, and
logout never deleted it.

## Mitigation

### What was done in code

- Desktop: new `apps/desktop/src/runtimes/personalization.ts` reads/writes the
  identity-scoped `config.preference` domain via
  `createDesktopClientStorageRuntime({ ptid })`; `store/settings.ts` and
  `i18n/index.ts` persist through it; `settingsRuntime.ts` is `session`
  scoped and its teardown resets shortcut/filter/language to defaults.
- Mobile: `deviceSettingsRuntime.ts` persistence is actor-scoped via
  `createMobileActorStorageRuntime(stationPeerId, ptid)` and depends on the
  session runtime; `sessionRuntime.revoke()` hard-deletes the revoking
  actor's `config.preference` domain; `mobileI18n.tsx` reloads actor language
  or falls back to OS default on the identity edge.
- The Desktop Rust settings subsystem (application/domain/interface modules,
  Tauri and HTTP `settings_get/set/reset` arms, `SettingsState`, persistence
  helpers) was deleted outright — hard cut, no migration, no dual path.

### What guards against regression

- Client-level unit tests for default-on-unknown-actor reads and teardown
  reset (`store/settings.test.ts`, `runtimes/settingsRuntime.test.ts`,
  `i18n/index.test.ts`, Mobile `runtimeRegistry.test.ts`).
- Invariant `invariants/client-settings-personalization-actor-scoped.md`
  with grep guards for any new generic settings KV or app-global preference
  write.
- The §6 journey in
  `docs/architecture/platform/client/settings-ownership.md` (A sets values →
  logout → B sees defaults → re-login stays local-default).

## How to detect a recurrence

```sh
# No generic settings KV or Rust settings.json surface may exist on either client.
rg -n "settingsGet|settingsSet|settings_reset|config/settings\\.json" apps/desktop apps/mobile

# Personalization keys must not be written to app-global web storage.
rg -n "localStorage\\.(get|set)Item" apps/desktop/src/store apps/desktop/src/i18n \
  apps/mobile/src/runtimes/deviceSettingsRuntime.ts apps/mobile/src/app/mobileI18n.tsx

# The preference domain must remain actor-scoped in the shared kernel.
rg -n "config\\.preference" packages/client-storage/src/index.ts
```

Runtime check: log in as A, change language/theme, log out, log in as B on
the same install — B must see OS language and default theme with zero
preference rows for A remaining in identity-scoped storage.

## Crosswalks

- Invariant `invariants/client-settings-personalization-actor-scoped.md` formalises the constraint.
- Architecture contract: `docs/architecture/platform/client/settings-ownership.md`.

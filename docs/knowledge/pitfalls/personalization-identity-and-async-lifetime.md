---
kind: pitfall
title: Personalization requires both identity storage and asynchronous lifetime isolation
status: active
owns:
  - apps/desktop/src/kernel/sessionIdentity.ts
  - apps/desktop/src/kernel/identityRuntime.ts
  - apps/desktop/src/hooks/useAppRuntime.ts
  - apps/desktop/src/runtimes/personalization.ts
  - apps/desktop/src/runtimes/settingsRuntime.ts
  - apps/desktop/src/services/appRuntime.ts
  - apps/desktop/src/services/identityPipeline.ts
  - apps/desktop/src/services/identityHandlers.ts
  - apps/desktop/src/services/identity_event.ts
  - apps/desktop/src/store/session.ts
  - apps/desktop/src/store/settings.ts
  - apps/desktop/src/i18n/index.ts
  - apps/desktop/src/storage/desktopClientStorage.ts
  - apps/mobile/src/runtimes/personalizationScope.ts
  - apps/mobile/src/runtimes/languageRuntime.ts
  - apps/mobile/src/runtimes/deviceSettingsRuntime.ts
  - apps/mobile/src/app/mobileI18n.tsx
referenced-by: []
related:
  - docs/architecture/platform/client/settings-ownership.md
  - docs/client/desktop/runtime-projections.md
detected: 2026-10-28
owner: Client Platform Team
---

# Personalization requires identity storage and asynchronous lifetime isolation

## Symptom and root cause

Actor-scoped storage alone did not prevent stale personalization. Mobile kept
its ready theme snapshot across teardown, accepted delayed language reads after
logout and resolved queued language writes against the next active actor.
Desktop accepted delayed shortcut/filter/Station projections after reset.
Local logout duplicated deletion policy, while external logout deleted app
scope and same-actor unlock deleted the incoming actor's preferences.

## Owner correction

The governing contract is
[Client Settings Ownership](../../architecture/platform/client/settings-ownership.md).
Desktop derives the canonical Station/actor/epoch scope from the completed
session binding. Every identity pipeline caller passes the outgoing scope
explicitly; the pipeline contains the sole cache deletion policy. Settings
bootstrap follows session epoch exclusively. Projection and native-effect
commits validate scope and reset generation.

The identity bridge uses one in-memory originator marker. No persistent flag or
debug full-reload branch may replace the transition pipeline.

Mobile `personalizationScope` owns identity, generation, storage admission and
mutation ordering for both device preferences and language. `languageRuntime`
owns language state, readback and retry; the React provider is a projection.
Teardown clears ready snapshots and failed retry intent. No scalar language or
string boolean fallback remains.

## How to detect recurrence

- Run Desktop personalization, settings store/runtime, i18n, identity pipeline,
  identity handlers and session/identity runtime tests.
- Run Mobile device settings, language runtime, i18n and runtime registry tests.
- Delay an A read until after logout: it must not change UI, errors or native
  effects. Queue an A write, activate B and release A: B storage must remain
  unaffected and B work must finish without waiting for A.
- Logout must delete only A's `(app, station, actor)` preferences while preserving
  B and the app-scoped Station registry. Same-actor unlock must preserve L2.
- Run the contract's actual native A → logout → B → logout → A Journey before
  claiming product proof; mock tests establish source behavior only.

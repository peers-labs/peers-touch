---
kind: playbook
title: Desktop Debug Runtime
status: superseded-by:docs/knowledge/playbooks/desktop-debug-runtime-with-qualified-chooser.md
owns:
  - AGENTS.md
  - apps/desktop/
  - apps/applets/
  - tooling/scripts/applet-
  - tooling/acceptance/
referenced-by:
  - AGENTS.md
related:
  - docs/client/desktop/runtime-projections.md
  - docs/client/desktop/execution-plans/20260701-page-runtime-lifecycle-contract.md
detected: 2026-07-01
---

# Desktop Debug Runtime

## When to use

Use this playbook whenever debugging Desktop behavior, Desktop applets, applet lifecycle smoothness, wakeup/return-home behavior, renderer runtime ownership, or acceptance evidence that can be observed in the development Desktop app.

Do not use hard packaged `.app` debugging by default. Packaging is only the right path when the user explicitly asks for release/package validation, installer validation, code signing behavior, or a package-only acceptance gate.

## Pre-conditions

- [ ] Confirm whether the user is asking for development debugging or packaging/release validation.
- [ ] If the work touches Desktop runtime/page/store behavior, read `docs/client/desktop/runtime-projections.md`.
- [ ] If the work touches applet runtime UI behavior, read `docs/client/common/ui-identity/frontend-component-tree-registry.md`.

## Steps

1. **Start from Make** — Use the repo Make entrypoint for Desktop development.
   - Use `make desktop` for the native Tauri application.
   - There is no supported Desktop browser shell.
   - Do not call `pnpm --filter @peers-touch/app-desktop run tauri:build`, `tauri build`, or manually execute `.app/Contents/MacOS/*` for normal debugging.

2. **Keep the loop live** — Reproduce, inspect logs, and iterate against the live dev runtime.
   - Prefer fixing lifecycle/runtime contracts in source and reloading the dev runtime.
   - Use embedded WebDriver semantic actions for routine UI interaction.
   - Local development defaults to `semantic-nonintrusive`; it must not
     activate the Desktop process, move the system pointer, redirect keyboard
     focus, or force the window above the operator's current application.
   - macOS Acceptance WebViews disable initial window focus and use Tauri's
     `BackgroundThrottlingPolicy::Disabled` before window creation. Semantic
     windows also start invisible, and the application uses `Prohibited`
     activation policy before the event loop starts: Tao's launch hook activates
     visible windows and the application even when initial focus is disabled.
     Once that hook finishes, main-thread setup switches to `Accessory` and
     orders the windows behind the operator with `NSWindow.orderBack`.
     Semantic startup and reopen must never call a focus or activation path.
     Verify
     actual background frame progress, fresh per-window screenshots, and
     operator focus preservation; the SDK setting alone is not rendering proof.
     A stalled frame remains `UNPROVEN`. Do not spoof document visibility,
     override animation scheduling, or remove product animations to pass a Gate.
   - Before recording overlay geometry, wait for animations on the measured
     surface and its ancestors to finish through the native Web Animations
     lifecycle. Opacity `1` and removal of a prepare class do not imply a
     finished transform: Modal zoom can still scale every measured region.
     Preserve the product animation and the original geometry tolerance.
   - Native file panels, permission sheets, physical hover/drag and focus
     claims require `exclusive-native-input` in an `isolated-gui-session`.
     A shared user session must fail closed before global input.

3. **Separate acceptance tiers** — Treat package gates as a different evidence tier.
   - Local lifecycle and runtime gates may run during debugging.
   - Packaged product-window gates are not substitutes for dev runtime E2E.
   - A packaged gate failure should not derail root-cause work unless the requested scope is packaging.

4. **Escalate deliberately** — Move to hard packaging only with an explicit reason.
   - Valid reasons: release bundle, installer, signing/notarization, app bundle resource layout, package-only regression.
   - State the reason before running package commands.

## Verification

- [ ] `make desktop` was used for Desktop app debugging, or the report explains why packaging was explicitly required.
- [ ] No new debugging script requires `tauri build` or manual `.app` execution unless it is a package/release gate.
- [ ] Acceptance reports distinguish dev-runtime evidence from packaged-bundle evidence.
- [ ] Semantic reports do not claim physical native-input or native-focus proof.
- [ ] Any exclusive input run identifies its isolated GUI session.
- [ ] Final report does not claim product readiness from a gate that was not run in the selected runtime.

## Crosswalks

- This playbook operationalizes `AGENTS.md §4` Desktop debug uses Make.
- It avoids conflating Desktop runtime lifecycle work with release packaging validation.

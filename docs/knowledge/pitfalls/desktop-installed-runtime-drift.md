---
kind: pitfall
title: Installed Desktop can hide stale runtime prerequisites
status: active
owns:
  - apps/desktop/src-tauri/src/infrastructure/i18n/
  - apps/desktop/src-tauri/src/application/auth/
  - apps/desktop/src/pages/login/
  - packages/locales/
referenced-by: []
related:
  - docs/architecture/shared/i18n/i18n-architecture.md
  - docs/architecture/platform/station/access/design.md
  - docs/client/common/ui-identity/modules/auth/desktop.md
detected: 2026-10-05
---

# Installed Desktop Can Hide Stale Runtime Prerequisites

## Symptom

An installed release app rendered a newly added i18n key literally, and OAuth
provider actions failed before opening the browser even though the selected
Station appeared online.

## Root Cause

Development mode concealed two persisted-runtime boundaries:

- debug i18n reads `packages/locales/` directly, while release reads the
  deployed runtime copy; comparing metadata version alone allowed stale locale
  files to survive when a locale edit omitted the version increment;
- a persisted Station selection starts in `Connecting`, while Access Gate
  callers require `AccessGate` or `Bound`; the first unauthenticated access
  request did not resume the persisted binding.

The OAuth error state then focused its cancel control, exposing the browser's
unnormalized native focus outline instead of emphasizing retry.

## Mitigation

- Release i18n deployment compares both metadata version and built-in pack
  content before taking the fast path.
- Debug direct-read of `packages/locales/` is enabled only when the running
  executable lives inside the cargo `target/` tree (`tauri dev` / cargo run).
  A debug build installed as an app bundle keeps `dev_source = None`: the
  compile-time `CARGO_MANIFEST_DIR` points back at a source tree that is not
  guaranteed readable from the installed context. In the observed incident
  the direct-read call stalled for ~7.4 minutes (exact OS mechanism
  unconfirmed; TCC authorization on the protected Documents tree was a
  hypothesis, not proven), and the frontend fell back to empty resources so
  every string rendered as its raw key. `load_resources()` additionally falls
  back to the deployed `config/i18n/` packs when a dev-source scan errors.
- `i18n_load_resources` is an `async` command whose directory scan runs in
  `spawn_blocking`. A synchronous Tauri command executes on the main thread,
  so the same slow filesystem call froze the entire IPC queue (frontend logs
  included) — not just i18n. Any command that touches the filesystem or does
  unbounded work must be async plus `spawn_blocking`.
- Missing keys can no longer ship silently:
  `tooling/scripts/check-desktop-locales.mjs` runs in the Desktop `check`
  chain and verifies every literal `t()` key against the bound namespace
  (including per-call `{ ns }` options), plural variants, and en/zh-CN parity.
  English `defaultValue`s were what concealed the original missing keys.
- Access scope resumes a persisted `Connecting` or retryable `Failed` Station
  binding before creating an Access Attempt.
- OAuth failure restores focus to the retry action, and global actionable
  controls use one visible two-pixel focus treatment.

## How To Detect A Recurrence

1. Install from a clean source checkout with `make desktop-install`.
2. Verify the app bundle and runtime locale trees contain the same built-in
   namespace files and that a same-version content drift is redeployed.
3. Start with only a persisted active Station, then begin GitHub or Google
   login while logged out; `oauth2_start_loopback` must return an authorization
   URL rather than `Station identity has not been verified`.
4. Force OAuth failure/retry and verify focus is on the provider retry action;
   no control may display the browser's thick default focus outline.
5. Build a debug bundle (`tauri build --debug --bundles app`), install and
   launch it through LaunchServices on a machine where the source tree sits
   under `~/Documents`. The login gate must render translated text, never raw
   `auth.*` keys; the app log must show no `i18n_load_resources timed out`
   fallback event. This catches installed-bundle direct-read regressions that
   `tauri dev` cannot reproduce.

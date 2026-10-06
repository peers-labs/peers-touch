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

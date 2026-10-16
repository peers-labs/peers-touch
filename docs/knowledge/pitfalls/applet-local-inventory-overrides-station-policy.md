---
kind: pitfall
title: Local applet inventory must not override Station denial
status: active
owns:
  - apps/desktop/src/store/applets.ts
  - apps/desktop/src/applet/AppletManager.ts
referenced-by: []
related:
  - docs/client/desktop/runtime-projections.md
  - docs/architecture/platform/applet-runtime/README.md
detected: 2026-10-16
---

# Local applet inventory must not override Station denial

## Symptom

Merging an installed local or bundled package after the Station catalog could
replace the same canonical ID's revoked/disabled state with installed/active.
The original load path rejected revoked state only, and direct installation
did not validate compatibility before changing installation state.

## Cause

Availability and authorization were merged using the same object precedence.
Local availability is not authority to clear a Station denial. A failed refresh
could also discard the known denial and reconstruct local availability.

## Required boundary

- Preserve Station revoked/disabled state when IDs overlap.
- Preserve known denials when Station reconciliation fails; fresh authoritative
  state may replace them after reconnection.
- Reject denied and missing catalog identities before installation or loading.
- Use AppletManager's schema/Desktop/platform check before installation and load.
- Recheck policy after asynchronous installation/materialization/session creation.
  Destroy a newly opened session if its identity becomes denied during loading.
- Keep Launcher, command search and Settings on the same runtime projection.

## How to detect a recurrence

Run the AppletManager, applet store and applet runtime focused checks. The store
cases cover installed local ID overlap, disabled/revoked state, failed Station
refresh, package-level revocation, incompatible installation, missing identity
and revocation during session creation.

```bash
pnpm --dir apps/desktop exec vitest run \
  src/applet/AppletManager.test.ts \
  src/store/applets.test.ts \
  src/runtimes/appletsRuntime.test.ts
```

These checks use controlled boundaries. Real Native Store, picker and lifecycle
Acceptance remains separate.

---
kind: pitfall
title: iOS Simulator uninstall does not clear Keychain
status: active
owns:
  - tooling/acceptance/provisioners/mobile_simulator.py
  - tooling/acceptance/tests/test_mobile_simulator_provisioner.py
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/design.md
  - docs/knowledge/invariants/acceptance-suite-runtime-reuse.md
  - docs/knowledge/invariants/mobile-session-device-identity.md
detected: 2026-10-17
---

# iOS Simulator uninstall does not clear Keychain

## Symptom

Independent Mobile Acceptance runs selected the same machine-global iOS
Simulator and treated application uninstall as a complete client-storage
reset. That lifecycle could not prove a fresh installation because secure
storage may survive uninstall in the Simulator Keychain.

## Root cause

`simctl uninstall` removes the application container but does not reliably
remove Keychain state from a reused Simulator. The Provisioner selected fixed,
machine-global Simulator devices across independent runs, so application
uninstall was not a storage-isolation boundary.

Suite-scoped client reuse remains valid within one declared Suite Runtime.
Independent runs may explicitly share a resource ID, but must not describe its
retained storage as fresh.

## Mitigation

### What was done in code

- Base, selected-client and layout Provisioners consume explicit Profile
  assignments through the canonical Machine Dev owner.
- A Profile's fresh-data requirement rejects previously used or unknown devices.
  Explicit creation produces an empty device; exact reset requires its own
  impact/decision and actual provider/data readback.
- Installation preserves app data and Keychain. Suite cleanup releases sessions
  and locks while retaining devices and contents. Detach is not deletion.

### What guards against regression

`MobileSimulatorProvisionerTests` forbids direct per-run creation and uninstall,
and requires shared-content projections and release-only cleanup. Native/data
proof separately verifies preserved Keychain and explicit reset effects.

## How to detect a recurrence

```bash
rg -n '_create_isolated_ios|simctl", "(create|delete|uninstall)"' \
  tooling/acceptance/provisioners/mobile_simulator.py
```

The search must return no matches.

```bash
PATH="$PWD/.local/acceptance/python-venv/bin:$PATH" \
  python3 -m unittest \
  tooling.acceptance.tests.test_mobile_simulator_provisioner
```

Run the selected resource native Gate. Its provider/data oracle must distinguish
retained sharing, explicit fresh creation/reset and physical deletion. A released
lease or a missing app container does not prove Keychain erasure.

## Crosswalks

- `docs/knowledge/invariants/acceptance-suite-runtime-reuse.md`
- `docs/knowledge/invariants/mobile-session-device-identity.md`

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
Independent Provisioner runs, however, must not share a Simulator whose secure
storage can outlive application uninstall.

## Mitigation

### What was done in code

- `MobileSimulatorProvisioner` now creates a fresh Simulator for every iOS
  client in each Provisioner run.
- Base, selected-client, and layout Provisioners share the same creation path.
- Cleanup shuts down and deletes every owned Simulator; the fixed-device
  discovery path was removed.

### What guards against regression

`MobileSimulatorProvisionerTests` requires per-client `simctl create`, forbids
fixed-device inventory selection, and verifies shutdown-before-delete cleanup
for both primary and peer Simulators.

## How to detect a recurrence

```bash
rg -n '_ready_ios_simulator|simctl", "list", "--json"' \
  tooling/acceptance/provisioners/mobile_simulator.py
```

The search must return no matches.

```bash
PATH="$PWD/.local/acceptance/python-venv/bin:$PATH" \
  python3 -m unittest \
  tooling.acceptance.tests.test_mobile_simulator_provisioner
```

Then run two Mobile identity Gates sequentially. Their Runtime Manifests must
bind different Simulator UDIDs, and both cleanup reports must prove deletion of
their owned devices.

## Crosswalks

- `docs/knowledge/invariants/acceptance-suite-runtime-reuse.md`
- `docs/knowledge/invariants/mobile-session-device-identity.md`

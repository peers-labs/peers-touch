---
kind: pitfall
title: Station equipment must resolve an operation target without rebinding the workspace
status: active
owns:
  - tooling/acceptance/provisioners/station_equipment.py
  - tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py
  - tooling/acceptance/provisioners/mobile_simulator.py
  - tooling/scripts/local-dev/machine-dev-registry.mjs
  - tooling/scripts/local-dev/machine-dev.mjs
  - tooling/scripts/local-dev/env.sh
  - tooling/devctl/profile.mjs
  - tooling/devctl/station.mjs
referenced-by: []
related:
  - docs/architecture/engineering/local-dev/design.md
  - docs/architecture/engineering/acceptance/integration.md
detected: 2026-10-24
---

# Profile Station equipment

A Native Gate resolved two reviewed Station Profiles, then stopped because
one live Station reported a different commit. Its Provisioner only launched
local Stations; the remote path required a manual deployment. Local Dev
already owned exact-source readiness, but accepted only the active binding.

The operation target now resolves through Machine Dev without changing the
registration or slot. The command and its post-lock validation carry that same
target. Workspace capabilities, reviewed topology, exact deployment identity,
stable protection and current source remain mandatory.

Equipment must complete before the Suite retains its remote source lease.
Canonical source-sync takes that lease itself. Holding it in the parent first
would deadlock nested deployment. After equipment, the Suite acquires its
retained lease and repeats health/source/protocol attestation to close the race.

Native and Mobile use the shared Station equipment caller. It delegates to
Local Dev and owns only its bounded process lifetime and diagnostic logs.
The deployment child must not inherit the parent's Acceptance environment/run
or Agent scenario-control/external-runtime variables. Those belong to the
parent evidence transaction or a separately owned Agent deployment. Passing a
Native run ID into the deployment script triggers its Agent-only runtime
admission and blocks ordinary Station equipment. Capture must retain the
original parent evidence environment so child isolation does not lose the
failure log, machine code, or original run reference.
An equipment timeout must reap the process; it cannot certify readiness.
`EphemeralLaunchCleanupFailed` must propagate unchanged. Its Launcher parent
type cannot be caught as an ordinary equipment block. Runner retains failed
process cleanup separately from successful cleanup of already acquired resources,
and stops downstream dispatch even without `stop-on-failure`.

## How to detect a recurrence

- Run `node --test tooling/scripts/local-dev/machine-dev.test.mjs`; target
  deployment must preserve binding bytes, reject the wrong deployment, reject
  dirty definitions after preparation, and forbid borrowed stable authority.
- Run `python3 -m unittest tooling.acceptance.tests.test_station_equipment`;
  a runtime profile file must not replace the target and timeout must reap the
  actual process while retaining its diagnostic. Native and Mobile child
  processes must observe no inherited runtime fields; capture must preserve
  the original parent run ID, failure bytes, machine code and log reference.
- Inject the typed failure at `GateProcessLauncher.run`: require the same
  exception and cleanup result at the equipment caller. The actual Runner
  regression must release source/profile resources in reverse order, retain
  failed aggregate cleanup, seal a repair-required Session and skip downstream.
- Run current-source Native/Mobile product Gates. Independent attestation
  after retained source-lease acquisition must match the candidate commit and
  protocol. Self-tests alone do not prove product readiness.

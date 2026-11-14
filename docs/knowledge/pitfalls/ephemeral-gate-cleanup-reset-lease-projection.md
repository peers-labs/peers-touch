---
kind: pitfall
title: Ephemeral Gate cleanup must re-project parent reset lease
status: active
owns:
  - tooling/scripts/acceptance-run.py
  - tooling/scripts/acceptance-run-test.py
referenced-by: []
related:
  - docs/knowledge/invariants/acceptance-scope-is-runner-owned.md
  - docs/architecture/engineering/acceptance/design.md
detected: 2026-11-10
---

# Ephemeral Gate cleanup must re-project parent reset lease

## Symptom

An ephemeral-capability Gate (a Gate declared with `ephemeralCapabilities`,
for example `mobile-simulator-recovery-e2e`) completes its product journey and
seals an inner proven report, but the outer Runner finishes
`completionStatus=PARTIAL` because reverse-order provisioner cleanup fails with:

```
cleanup failed: actor-fixture:station: Destructive Station reset requires the
exact live station.reset lease for scope '<scope>'
```

Ordinary command Gates on the same Environment and provisioner clean up
successfully, which makes the failure look timing-related rather than
structural.

## Root cause

Context Gate children inherit only the minimal
`CONTEXT_GATE_INHERITED_ENV_KEYS` allowlist. This deliberately strips every
`PT_MACHINE_LEASE_*` descriptor so a brokered child cannot hold destructive
reset authority, and `GateProcessLauncher` independently rejects ambient
descriptor inheritance.

The Runner rebuilt the child-bound `gate_env` through
`context_gate_subprocess_environment` and then reused that same stripped
environment for the parent's in-process `provisioner.cleanup()`. The parent
still held the live `station.reset` lease (its release is registered first and
therefore runs last in LIFO cleanup), but the lease descriptors were no longer
projected into `os.environ`, so `require_station_reset_authority` fail-closed.
Non-ephemeral Gates never hit this because they re-apply
`authority_environment` to their `gate_env`.

## Mitigation

### What was done in code

- `tooling/scripts/acceptance-run.py` defines `MACHINE_LEASE_ENV_KEYS` and
  snapshots the parent-held lease projection into
  `cleanup_authority_environment` immediately before the context Gate
  environment rebuild.
- The snapshot is merged only into the environment used for the parent
  `provisioner.cleanup()` call. The child environment is unchanged, the live
  FD still belongs to the parent process, and `verify-held` still validates the
  flock, process identity and lease id, so the guard stays fail-closed.

### What guards against regression

- `python3 tooling/scripts/acceptance-run-test.py` includes
  `test_context_gate_reprojects_reset_lease_only_for_parent_cleanup`, which
  asserts the child environment contains no `PT_MACHINE_LEASE_*` key while the
  parent cleanup handler observes the full authority projection, and that no
  lease descriptor leaks back into the ambient environment.

## How to detect a recurrence

Run:

```bash
python3 tooling/scripts/acceptance-run-test.py
```

A regression makes the new test observe empty lease values during parent
cleanup. For a live Gate, inspect
`reports/provisioner-cleanup.json`: `environmentCleanupStatus` must be
`passed` and `completedResources` must include both `actor-fixture:station` and
the terminal `station.reset:<scope>` release.

## Crosswalks

- Invariant `invariants/acceptance-scope-is-runner-owned.md` keeps Gate
  execution environment ownership with the Runner.
- The least-privilege child boundary is enforced by
  `tooling/acceptance/core/launch_context.py` and must not be relaxed to fix
  parent-side cleanup authority.

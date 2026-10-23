---
kind: pitfall
title: Generic credential resolution must preserve Core diagnostics
status: active
owns:
  - tooling/acceptance/core/gate.py
  - tooling/acceptance/core/provisioner.py
  - tooling/acceptance/provisioners/home_station.py
  - tooling/acceptance/tests/test_resource_diagnostic.py
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
detected: 2026-10-22
---

# Generic credential resolution must preserve Core diagnostics

## Symptom

A concrete Provisioner can return an opaque credential refusal even when Core
already records the resolver failure and actual environment-variable presence.
An ordinary command failure can also carry an unusable owner `__main__` when
its Gate is executed as a script.
The generic Profile/source lease owner can independently discard its actual
failure when converting a lease exception to BlockedError.

## Root cause

Home Station copied Core's generic CredentialRef loop. Its override raised a
new BlockedError without a diagnostic, so improving the canonical Core owner
did not reach this business Provisioner.

## Mitigation

Home Station inherits the Core resolver. Concrete overrides are reserved for
different, business-owned credential sources; they must preserve their actual
observations and the canonical safe-redaction contract.
Ordinary Gate failure ownership uses the actual `run` implementation file and
Gate class, so script invocation does not erase the source location.
Canonical lease conversion records the acquired/failed result and safe
configured target fields. A remote handshake timeout leaves source verification
`NOT_EVALUATED`; it does not establish a remote holder or source mismatch.

## How to detect a recurrence

Run:

```bash
python3 -m unittest tooling.acceptance.tests.test_resource_diagnostic
```

The Home Station case must retain owner `environment-provisioner:home-station`
and the observed absence of the required variable. Review any concrete
`_resolve_credentials` override for a real source difference; copying the
generic CredentialRef loop creates a second owner.
The actual subprocess script case must retain its absolute source path and
`ScriptGate` identity through the ordinary command failure report.
The real subprocess handshake timeout must survive Runner sealing and Reporter
projection with no missing diagnostic fields, failed lease acquisition and
unevaluated source verification. Product proof remains `UNPROVEN`.
Station health probes must retain their actual endpoint, HTTP status or safe
exception type/cause/errno, and timeout. A boolean alone discards the evidence
needed by the concrete Provisioner. Native Tauri consumes the same Core probe
and records the assigned service, Profile, deployment and recovery action.
Health failure before attestation leaves source identity `NOT_EVALUATED`;
it cannot establish source drift or a missing device. Real loopback HTTP and
connection-refusal regressions must survive Runner sealing and Reporter
validation without recording response bodies or private headers.

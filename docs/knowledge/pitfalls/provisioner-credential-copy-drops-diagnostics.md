---
kind: pitfall
title: Generic credential resolution must preserve Core diagnostics
status: active
owns:
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

## Root cause

Home Station copied Core's generic CredentialRef loop. Its override raised a
new BlockedError without a diagnostic, so improving the canonical Core owner
did not reach this business Provisioner.

## Mitigation

Home Station inherits the Core resolver. Concrete overrides are reserved for
different, business-owned credential sources; they must preserve their actual
observations and the canonical safe-redaction contract.

## How to detect a recurrence

Run:

```bash
python3 -m unittest tooling.acceptance.tests.test_resource_diagnostic
```

The Home Station case must retain owner `environment-provisioner:home-station`
and the observed absence of the required variable. Review any concrete
`_resolve_credentials` override for a real source difference; copying the
generic CredentialRef loop creates a second owner.

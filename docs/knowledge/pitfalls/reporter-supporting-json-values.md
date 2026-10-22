---
kind: pitfall
title: Reporter must accept sealed supporting JSON values
status: active
owns:
  - tooling/scripts/acceptance-report.py
  - tooling/acceptance/tests/test_resource_diagnostic.py
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
detected: 2026-10-23
---

# Reporter must accept sealed supporting JSON values

## Symptom

The Reporter marks native activation diagnostics and the runtime launch ledger
invalid although their arrays belong to the original sealed Gate inventory and
their SHA-256 values match.

## Root cause

The generic supporting evidence reader used Evidence Store's `read_json`,
which intentionally accepts objects only. Runner already records JSON arrays.

## Mitigation

Resolve supporting ArtifactRefs through Evidence Store with hash verification,
then parse generic JSON. Keep the same Gate/run/inventory checks. Source
observations remain objects. Arrays and scalars supply supporting type metadata
only; their contents and caller labels cannot become runtime or deployment
observations. Do not broaden the Evidence Store object reader.

## How to detect a recurrence

Run `python3 -m unittest tooling.acceptance.tests.test_resource_diagnostic`.
The sealed-array case must retain complete diagnostics, reject changed bytes,
and ignore embedded runtime objects and misleading deployment labels. A sealed
array used as the source observation must still be rejected.

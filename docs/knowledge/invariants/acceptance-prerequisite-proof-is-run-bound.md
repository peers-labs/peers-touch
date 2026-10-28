---
kind: invariant
title: Shared Gate prerequisites retain original proof ownership
status: superseded-by:docs/knowledge/invariants/acceptance-fixed-scope-continuation.md
owns:
  - tooling/acceptance/core/execution_graph.py
  - tooling/acceptance/core/execution_budget.py
  - tooling/acceptance/core/execution_session.py
  - tooling/acceptance/gates.yaml
  - tooling/scripts/acceptance-run.py
  - tooling/scripts/acceptance-plan.py
  - tooling/scripts/acceptance-validate.py
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
  - docs/knowledge/invariants/acceptance-scope-is-runner-owned.md
  - docs/knowledge/invariants/acceptance-suite-runtime-reuse.md
detected: 2026-10-22
---

# Shared Gate prerequisites retain original proof ownership

## What must hold

Only an explicit `dependsOn` contract creates a proof dependency. Equal
commands or equal environment names never authorize reuse. Planner and Runner
use one compiler, include prerequisite closure, reject missing, repeated,
cyclic or excluded dependencies, and dispatch a producer at most once.

A consumer verifies the producer's original SHA-256 ArtifactRef, durable
manifest, current source identity, complete proven result and cleanup.
Missing proof blocks downstream work. A structural prerequisite judgment
references original producer manifests; it never clones an evidence report
under the consumer's gateId. Structural judgments cannot substitute for
native runtime, UI, receiver-visible or negative assertions.

The first overrun pauses downstream dispatch. Its owner diagnoses, repairs,
records validation and begins a new frozen-source attempt. Recording a failure
alone does not complete the engineering task. Unknown attribution requires
judgment. New source invalidates previous proof; a repair ledger neither grants
authority nor manufactures proof, and must retain the full scope and budget.
An explicitly accepted time-contract change creates a fresh Session with
verified durable prior manifest/session lineage. It retains the complete scope,
starts attempt numbering afresh and transfers no attempts or PASS. It must not
weaken same-policy restore validation.

There is no implicit uniform Gate work deadline. Request resource limits,
Catalog command protection from actual command start, explicitly owned
operation limits, business observation windows and measured performance
objectives remain distinct. Missing objectives stay UNPROVEN. Cleanup replaces
the unwound work alarm and fixes its deadline on first entry; process
termination, descendant confirmation and resource cleanup share that tail.
Nested cancellation must retain the identity of the actual earlier owner.

Early initialization and Gate publication failures must produce a full-scope
UNPROVEN run report even without an ExecutionSession. The independently sealed
stop observation owns the exception facts; it must not rewrite a sealed Gate.
The dispatched count derives from actual acquired Gate runs, not attempted
source snapshots. Owner SIGINT is OWNER_INTERRUPTED, not a timeout; existing
Launcher termination, output capture, cleanup and publication remain bounded.

## Why this is non-negotiable

Repeating producers multiplies setup and proof cost. Renaming their reports
destroys traceability. Increasing thresholds or inheriting previous PASS after
repair hides the regression instead of proving the candidate.

## How to verify

Use bounded invocations of:

```text
python3 -m unittest tooling.acceptance.tests.test_execution_graph
python3 -m unittest tooling.acceptance.tests.test_execution_budget
python3 -m unittest tooling.acceptance.tests.test_execution_session
python3 tooling/scripts/acceptance-plan-test.py
python3 tooling/scripts/acceptance-validate-test.py
```

The real Runner tests prove one dispatch for two consumers, original producer
identity, failed prerequisite isolation, source mismatch rejection, descendant
cancellation, untouched unrelated processes, full-scope stop results and an
actual failed-attempt → validated-repair → repeated-execution cycle.
The budget suite also injects early source timeout/SIGINT, real command SIGINT
and result-publication timeout. It checks exact dispatch counts, full scope,
durable stop/run references, child extinction, captured output and no downstream
mutation under the unchanged lifecycle policy.

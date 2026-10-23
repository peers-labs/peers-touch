---
kind: invariant
title: Fixed Acceptance scope retains original proof across bounded requests
status: active
owns:
  - tooling/acceptance/core/execution_graph.py
  - tooling/acceptance/core/execution_budget.py
  - tooling/acceptance/core/execution_session.py
  - tooling/acceptance/core/evidence_store.py
  - tooling/acceptance/core/redaction.py
  - tooling/acceptance/gates.yaml
  - tooling/scripts/acceptance-run.py
  - tooling/scripts/acceptance-plan.py
  - tooling/scripts/acceptance-validate.py
  - tooling/scripts/acceptance-report.py
  - tooling/scripts/acceptance-gap-detect.py
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
  - docs/knowledge/invariants/acceptance-scope-is-runner-owned.md
  - docs/knowledge/invariants/acceptance-suite-runtime-reuse.md
detected: 2026-10-23
---

# Fixed Acceptance scope and original proof

## What must hold

The unique Runner resolves the complete required scope before execution.
Only explicit dependsOn creates a proof dependency; equal commands or environment
names never authorize reuse. The compiler rejects cycles, missing or excluded
dependencies and repeated selections. Structural prerequisite judgments retain
the original producer identity and cannot replace native/UI/receiver/negative proof.

A Session retains the full scope, graph, source and policy across finite requests.
Only a unique request-work expiry with successful owned cleanup permits one explicit
new bounded request. Operation, mixed, cleanup or publication expiry still requires
qualified owner repair; UNKNOWN remains NEEDS_JUDGMENT. No auto-extension or infinite
continuation is allowed. The cancelled Gate restarts its full entry and windows.
The OS lock and single-use request sequence reject concurrent or stale continuation.
A crash without actual cleanup proof cannot resume.

Prior completion is a reference to the original DURABLE producer, never a copied
report. Reuse revalidates complete inventory/hash, source, definition, policy,
current runtime/provider/oracle/action-plan contract, DONE/PROVEN and cleanup.
Missing identities or invalid references return the item to pending scope. Source
change invalidates all old proof. Failed, blocked or cancelled work remains unproven.
Every report accounts for the full required set and separates validation, origin
cost and actual dispatch; absence of a manifest cannot be repaired by a PASS label.

No uniform Gate work cap is implied. Request limits, Catalog protection from actual
command start, explicit owner limits, business windows and performance objectives
remain distinct. Cleanup replaces the unwound work alarm and fixes one tail shared
by termination, descendant confirmation and resource cleanup. Nested cancellation
retains its actual earlier owner. Missing performance objectives remain UNPROVEN.

Early initialization, owner SIGINT and publication failures still produce full-scope
UNPROVEN observations. SIGINT is OWNER_INTERRUPTED. Independently sealed stop
observations never rewrite sealed Gate results; dispatch counts use acquired runs.

Public inventory comes only from actual closed ArtifactRef values, and public graph
metadata from the unique compiler's closed ExecutionGraph. A role containing auth,
key or token cannot delete its typed value. Payload field heuristics and all secret
text/known-value scans remain effective. Secret public identity, extra payload,
mutation or digest/hash loss rejects publication. Every manifest reader and writer
validates every inventory entry; no business whitelist or historical repair exists.

## Why this is non-negotiable

A bounded process cannot promise arbitrary full workloads finish before its deadline.
Forcing a full rerun repeats an already proved prefix; shrinking required scope or
renaming old PASS hides missing proof. Applying payload heuristics to public IDs can
destroy the references needed to audit even a legitimately completed producer.

## How to verify

Run bounded test_execution_session, test_execution_graph, test_execution_budget,
test_evidence_store, test_redaction and the actual Runner/Planner/Reporter/Gap tests.
Use a real synthetic Runner across two requests: no downstream mutation after the
first expiry, no repeat of validated completion, full scope, original runId and costs,
and complete rerun of the cancelled Gate. Reject concurrent/stale continuation,
source/policy/graph/hash drift, missing cleanup and mixed/unknown expiry.

The actual writer must preserve auth/key/token role refs and compiler mappings,
recompute graph digests, reject unknown public payload and preserve secret redaction,
including encoded values. Mutated inventory bytes must reject DURABLE publication
and read. Existing required-finalizer publication and authoritative proof contracts
remain mandatory; plain manifest visibility cannot substitute for their authority.

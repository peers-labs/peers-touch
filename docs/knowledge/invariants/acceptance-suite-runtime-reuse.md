---
kind: invariant
title: Multi-scenario Acceptance reuses one Suite Runtime
status: active
owns:
  - AGENTS.md
  - docs/architecture/acceptance-framework/
  - tooling/acceptance/
  - tooling/scripts/plan/
  - tooling/skills/pt-acceptance-engineering/
  - tooling/skills/pt-acceptance-infra-engineering/
  - tooling/skills/pt-acceptance-pipeline-auditor/
  - tooling/development/
referenced-by:
  - docs/architecture/acceptance-framework/decisions.md
related:
  - docs/architecture/acceptance-framework/design.md
  - docs/architecture/secure-content/decisions.md
detected: 2026-09-29
---

# Multi-scenario Acceptance Reuses One Suite Runtime

## What must hold

A functional Task with two or more Scenarios that share services, actors,
clients, devices, storage, or login state MUST declare a closed `runtimeReuse`
contract.

Build, deployment, service attestation, account provisioning, client/device
launch, isolated storage, and login belong to Task or Suite scope. After the
first Scenario starts, every Scenario is attach-only. It may reset namespaced
business data, execute real product actions, assert receiver-visible outcomes,
and collect supporting diagnostics. It must not recreate an expensive runtime
resource to simulate isolation.

One Suite Runtime report binds:

- one Suite Runtime ID;
- one exact source digest;
- one Fixture Epoch;
- declared Scenario IDs and resource budgets;
- lifecycle events and reuse metrics;
- a terminal cleanup result.

Scenario-owned state must remain available until the Suite owner has captured
the required UI action and receiver-visible assertion. Scenarios must not clear
client state before returning; the Suite owner performs inter-scenario reset
after evidence capture and final cleanup after the last Scenario.

Child results remain unpublished in an owner-private transaction area until
every Scenario has completed its UI action and receiver assertion, final
cleanup has succeeded, and the Suite Runtime report is valid. The Suite owner
then publishes the complete result generation atomically. A failed or retried
Suite must expose no partial child set at the aggregate-visible path.

Harness and API observations are supporting evidence only. A required UI action
or receiver-visible assertion cannot be satisfied by directly invoking a
Harness action, reading a private Store, or checking only an API response.

## Why this is non-negotiable

Scenario-owned provisioning multiplies build, launch, login, cleanup, evidence,
and Agent inspection cost while making retries slower. Harness-only actions can
still pass while the visible product is on the wrong page or the receiver never
observes the outcome. Combining both patterns produces expensive false
confidence.

Suite-scoped reuse removes repeated infrastructure work without weakening Actor
or storage isolation. Scenario namespaces and bounded reset own business-data
isolation; client recreation is reserved for a declared replacement or a
Journey whose product assertion is restart behavior.

## How to verify

```bash
python3 -m unittest tooling.acceptance.tests.test_suite_runtime
python3 tooling/scripts/acceptance-pipeline-audit-test.py
python3 tooling/scripts/acceptance-pipeline-audit.py \
  --plan <plan.md> \
  --tasks <task-id[,task-id...]>
```

For a completed runtime Suite, pass every immutable report through
`--runtime-report`. Verify:

- `provisioningRuns` and `clientLaunches` remain within the Task budget;
- `warmReuseRate` meets the declared floor;
- no expensive event follows the first `scenario-start`;
- every declared Scenario has `ui-action`, `receiver-assertion`, and
  `scenario-end`;
- no Scenario clears client state before its UI evidence is captured;
- a failed Suite leaves no aggregate-visible child results, and retries cannot
  create duplicate child results for one generation;
- the final event is `cleanup-complete`.

Any missing or invalid runtime report keeps lifecycle proof `UNPROVEN`.

## Crosswalks

- Acceptance Framework `D-21` owns the generic Suite Runtime contract.
- Secure Content `SC-D22` requires owner-produced attach-only runtimes and
  receiver-visible proof.

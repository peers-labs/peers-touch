# Runtime Reuse Amendment Review

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-10-01
> **Owner**: Architecture Team

## Review Scope

Review the W7-W13 execution model after the integration checkpoint. The
amendment must reduce repeated build, deployment, account, client, storage,
login, Fixture, and inspection work without weakening Task ownership,
source-generation fencing, product restart semantics, FINAL_CUT isolation, or
formal Acceptance.

## Accepted Boundary

1. W12D owns one immutable source/build generation and one serial deployment
   per approved Profile before W7-W11.
2. W7, W8, W9, W2, W10, and W11 attach to those deployments through fresh
   attestation readback. They do not redeploy.
3. Each functional Task owns one Suite Runtime. Accounts, clients, devices,
   isolated storage, login state, service attestations, and one Fixture Epoch
   are provisioned once before the first Scenario.
4. Scenario execution is attach-only and may reset only namespaced business
   Fixture state after receiver-visible evidence is captured.
5. Product-required restart or recovery is a recorded client replacement, not
   whole-Suite reprovisioning.
6. Mutable runtime resources do not cross Task ownership boundaries. Task
   handoff cleans clients, sessions, storage leases, ports, tunnels, and
   Fixture capabilities; content-addressed build/install artifacts and the
   exact deployment generation remain reusable.
7. W12 serially completes FINAL_CUT for `four` and `fiveArm`, then creates one
   new post-cut Suite Runtime and Fixture Epoch. Every product child binds both
   final-cut results and post-cut service identities.
8. W13 may prepare Gate crosswalk and integrity audits in a read-only lane
   while W12 runs. Formal Gates and Evidence Store writes remain parked until
   W12 reaches `FUNCTIONAL_PASS`.

## Required Checks

1. W7, W8, W9, W2, W10, W11, and W12 expose one functional Suite entry and a
   valid `runtimeReuse` contract.
2. W9 no longer returns `SUITE_RUNTIME_OWNER_PENDING`.
3. W2, W10, W11, and W12 no longer expose per-platform public runner commands
   as Task checks.
4. Product runtime work items own `station.connect`, not `station.deploy`.
   Deploy ownership remains only with W12D activation and W12 FINAL_CUT reset
   children.
5. Suite reports prove one provisioning run, bounded client launches,
   attach-only Scenarios, receiver-visible evidence, scenario reset
   acknowledgements, and terminal cleanup.
6. W12 product results bind both FINAL_CUT children, reset IDs, schema
   attestations, service runtime identities, and the post-cut Fixture Epoch.
7. Plan validation, runtime-owner focused tests, aggregate tests, and the
   runtime pipeline audit pass.

## Concurrency Review

- **Parallel**: read-only source review, static contract validation, immutable
  artifact digest checks, Gate crosswalk inspection, and evidence-integrity
  analysis.
- **Serial**: source freeze, Profile activation/deploy, shared Station access,
  Suite provisioning, Scenario execution on shared actors/storage, FINAL_CUT,
  Task handoff, aggregation, formal Acceptance writes, and cleanup.
- **Integrator only**: Plan Package, Task Slices, work-item registry, generated
  runtime contract, shared owner implementation, commits, and lifecycle state.

## Review Result

**Verdict**: PASS

Plan validation and the W7-W12 pipeline contract audit pass. Runtime behavior
remains `UNPROVEN` until the amended source is invalidated, replayed through
W12A-W12D, and exercised by W7-W13.

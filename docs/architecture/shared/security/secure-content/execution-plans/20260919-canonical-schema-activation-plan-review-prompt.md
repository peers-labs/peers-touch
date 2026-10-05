# Secure Content Canonical Schema Activation Plan - Review Prompt

> **Status**: structural review passed - awaiting DWF-D18 Owner acceptance
> **Version**: v1.3
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Architecture Team

---

You are reviewing a Peers-Touch Schema V2 execution-plan amendment. Review the
repository sources directly. Do not implement code, deploy, acquire runtime
resources, execute either destructive reset intent, or treat this review as
product or Acceptance evidence.

## Plan Background

SC-D24 is accepted. It resolves the W7/W12 dependency cycle by reusing the
single SC-D23 reset implementation for a pre-W7 `SCHEMA_ACTIVATION`, while
retaining a fresh post-W11 `FINAL_CUT` and complete product matrix in W12.

The amendment adds one current task, W12A, and changes the dependency graph to:

```text
W7R + W11-SOURCE
  -> W12A SCHEMA_ACTIVATION
  -> W7 -> W8 -> W9 -> W2/W10 -> W11
  -> W12 FINAL_CUT
  -> W13 formal Acceptance
```

The package now has `13/22` completed closures. W7 is pending and remains
`UNPROVEN`. W12A is the current task only so the active Schema V2 package has
one legal frontier; implementation remains gated by this review and Owner
approval.

## Prior HOLD And Required Corrections

The v1.0 plan review returned `HOLD` for four blocking findings. Verify that
v1.2 closes each one without introducing another source of truth:

1. **Source drift reactivation**: W12A now completes and freezes all remaining
   W7-W11 source. W7-W11 are functional-only. A source defect must release the
   failed declaration, atomically reopen W12A, invalidate affected evidence by
   immutable reference, return affected tasks to pending, and require a new
   source generation plus both activations before retry.
2. **Independent declarations**: `W12A-FOUR`, `W12A-FIVEARM`, `W12F-FOUR`, and
   `W12F-FIVEARM` are distinct work-item projections. Each owns exactly one
   profile, deployment environment, destructive scope, and reset lease. Every
   projection also maps explicitly to parent task W12A or W12 and publishes the
   immutable Plan/task locator; prefix inference is forbidden.
3. **Complete W12 evidence**: W12 declares separate FINAL_CUT, Desktop,
   Browser, iOS, Android, Chat Desktop, Chat iOS, and Chat Android commands,
   followed by one immutable aggregate.
4. **Durable evidence roots**: `integration.md` and the Plan define immutable
   source-freeze, per-profile manifest/journal/invocation/attestation/result,
   product-child, and aggregate roots with one final writer per key.
5. **DWF-D18 invalidation ownership**: `invalidate-source` accepts only the
   failed task and first-failure ref. The transaction mechanically selects the
   immutable policy and owns Session/runtime/lease/declaration cleanup.
6. **Complete DWF-D18 hard cut**: a separate Platform-owned delivery and
   machine bootstrap precede per-Plan migration through
   `SourceCheckpointPublicationTransactionV1(PLAN_SCHEMA_MIGRATION)`. The
   migration converts the package/tasks/evidence/declaration/active-work
   projections without changing the `13/22` baseline.

## Accepted Architecture Baseline

- `docs/architecture/shared/security/secure-content/design.md`
- `docs/architecture/shared/security/secure-content/decisions.md`
  - especially `SC-D10`, `SC-D21`, `SC-D22`, `SC-D23`, and accepted `SC-D24`
- `docs/architecture/shared/security/secure-content/data-model.md`
- `docs/architecture/shared/security/secure-content/integration.md`
- `docs/architecture/shared/security/secure-content/operations.md`
- `docs/architecture/engineering/local-dev/README.md`
- `docs/architecture/engineering/local-dev/design.md`
- `docs/architecture/engineering/local-dev/data-model.md`
- `docs/architecture/engineering/local-dev/integration.md`

The accepted SC-D24 architecture review and Owner decision are recorded at:

- `docs/architecture/shared/security/secure-content/execution-plans/20260919-canonical-schema-activation-amendment-review-prompt.md`

The original DWF-D18 proposal and review artifacts referenced by this review
were not retained. The surviving crosswalk is the accepted historical
[DWF-D18 decision](../../../../engineering/development-workflow/decisions.md#dwf-d18-bind-each-workspace-to-one-immutable-current-plan-generation),
which was later superseded by
[DWF-D38](../../../../engineering/development-workflow/decisions.md#dwf-d38-separate-frozen-plan-versions-from-execution-worktree-mounts).

DWF-D18 independent review is `PASS` with no findings. Do not return Plan
`PASS` until the Platform Owner has explicitly accepted it.

## Plan Sources To Review

- `docs/architecture/shared/security/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md`
- `docs/architecture/shared/security/secure-content/execution-plans/20260913-secure-content-hard-cut/tasks/W12A.md`
- `docs/architecture/shared/security/secure-content/execution-plans/20260913-secure-content-hard-cut/tasks/W7.md`
- [Archived W12 task](./20260913-secure-content-hard-cut/archive/desktop-usability-deferred/W12.md)
- `docs/architecture/shared/security/secure-content/execution-plans/20260913-secure-content-work-items.yaml`
- `docs/architecture/shared/security/secure-content/execution-plans/20260913-secure-content-journeys.yaml`
- `docs/architecture/shared/security/secure-content/integration.md`

## Review Dimensions

1. **Dependency correctness**
   - Is W12A dependency-ready only after W7R and W11-SOURCE?
   - Is every private Social product Journey transitively behind W12A?
   - Does W12 remain behind W11 and W12A, with W13 behind W12?
   - Does moving W7 from `in_progress` to `pending` preserve Schema V2 lifecycle
     validity without rewriting completed history?
   - Does the source-drift reopen transaction return W12A to current and every
     affected functional task to pending while preserving the immutable Plan
     initial HEAD and prior evidence bytes?
   - Does the command reject caller-selected source owner, root, generation,
     cleanup proof, declaration, lease, or evidence identity?

2. **One reset owner and one truth**
   - Does W12A implement one shared reset owner and one non-public Station
     maintenance CLI for both intents?
   - Is there any compatibility writer, nullable/default legacy field,
     alternate table, direct SQL/DDL runner, storage bypass, or second journal?
   - Are Social database and OSS object mutations still executed only by their
     owning services?

3. **Authorization and concurrency**
   - Are `four` / `station-four-social-private` and
     `fiveArm` / `station-five-arm-social-private` the only targets?
   - Does each profile use an independent declaration, reset ID, immutable
     manifest, invocation sequence, journal, exact scope authorization, and
     `station.reset` lease?
   - Is activation serial, with the SSH process a direct child of the generic
     lease wrapper and a remote advisory lock keyed by deployment environment
     plus scope?
   - Does every reset work-item projection contain exactly one
     `station.reset` claim and one matching `destructiveResetScopes` value?
   - Does `execute_projection` receive an explicit parent task and publish both
     `--plan` and `--task` so Plan-bound declarations are executable?

4. **Activation versus final cut**
   - Is W12A restricted to `SCHEMA_ACTIVATION`?
   - Does W12 require a fresh `FINAL_CUT` after W11?
   - Can any activation manifest, journal, attestation, or result incorrectly
     satisfy W12 `FUNCTIONAL_PASS` or formal Acceptance?

5. **Attestation admission**
   - Does W12A require one current `CanonicalPrivateSchemaAttestationV1` per
     referenced Station service before private client launch?
   - Do missing, stale, wrong-source, wrong-profile, wrong-service,
     incomplete-journal, retired-column, and schema-drift cases fail with
     `CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE` before the first product action?

6. **Failure and replay coverage**
   - Do the Journey and task cover success, invalid input, competing
     invocation, exact replay, conflicting replay, timeout, SSH disconnect,
     cancellation before commit, interruption after every durable transition,
     lease loss, resume, and public-snapshot mismatch?
   - Does every partial failure remain non-successful and keep Station quiesced
     where required?
   - Does a W7-W11 source defect fail before code mutation, invalidate affected
     exact-source results, and require fresh dual-profile activation?

7. **Scope and evidence**
   - Are W12A source claims sufficient and no broader than the accepted owner
     surfaces?
   - Are source checks, Station tests, functional activation, and final product
     evidence kept in their correct verification classes?
   - Are W7, W12, and W13 claims still `UNPROVEN` until their own exact-source
     Journeys or formal Gates run?
   - Does every mutable runtime artifact have one final writer and every
     aggregate bind immutable child digests without overwriting them?

8. **Executable handoff**
   - Are task commands, budgets, done conditions, failure behavior, Journey
     steps, runtime claims, and destructive authorizations specific enough for
     `pt-execution-plan-guardian` to execute without redesign?
   - Is any required implementation responsibility or lifecycle step unmapped?
   - Are source-freeze, reopen, per-profile reset, per-runtime product, and
     aggregate commands named explicitly enough to implement and execute
     without another plan amendment?
   - Is the external DWF-D18 implementation plus machine bootstrap and this
     Plan's v3/v2 source-checkpoint migration an explicit receipt-gated
     prerequisite rather than hidden W12A work or a new Secure Content owner?

## Required Verdict

Return exactly:

```text
Verdict: PASS | HOLD | REJECT

Findings:
- severity
- exact file and line
- violated architecture decision or planning invariant
- required correction

Decision checks:
- dependency graph and Schema V2 lifecycle: PASS | HOLD
- one reset owner and no compatibility path: PASS | HOLD
- exact authorization, process ancestry, and locking: PASS | HOLD
- activation versus final-cut separation: PASS | HOLD
- schema-attestation admission: PASS | HOLD
- failure, replay, cancellation, and resume coverage: PASS | HOLD
- source/runtime scope and evidence classes: PASS | HOLD
- execution handoff completeness: PASS | HOLD
```

A `PASS` means the amended plan is ready for explicit Owner approval. It does
not authorize implementation, reset execution, deployment, W7 or W12
`FUNCTIONAL_PASS`, formal Acceptance, push, pull-request creation, or history
rewrite.

## Independent Review Result

- Verdict: `HOLD`
- Structural findings: none
- Decision checks: `8/8 PASS`
- Conditional result: the plan is otherwise `PASS`
- Sole blocker: explicit Platform Owner acceptance of DWF-D18

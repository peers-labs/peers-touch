---
name: pt-dev-workflow
description: >-
  Runs one non-trivial Peers-Touch development lifecycle from verified intake
  through resource declaration, owner dispatch, functional proof, Acceptance,
  delivery, and release.
stage: orchestrator
requires: []
produces: ["closed Development Run", "durable owner state", "bounded delivery claim"]
---

# Dev Workflow

This is the single entry point for non-trivial Peers-Touch development.

Human operating standard: `docs/global/workflow.md`.
Architecture source: `docs/architecture/development-workflow/README.md`.

This Skill coordinates owners and consumes machine decisions. It does not
restate product, architecture, scheduling, policy, runtime, Acceptance, or
delivery methodology.

## Boundary

| Concern | Owner |
|---|---|
| Intent route | `pt-god-view` |
| Product contract | `pt-product-design-methodology` |
| Architecture contract | `pt-architecture-design-methodology` |
| Dependency model | `pt-architecture-execution-methodology` |
| Plan Package persistence | `pt-plan-and-document` |
| Ready/Parked schedule | `pt-goal-orchestrator` |
| Per-action policy | `pt-execution-plan-guardian` |
| Runtime Journey and result commit | `pt-dev-runtime-handoff` |
| Status projection | `pt-context-anchor` |
| Formal proof | Acceptance owner Skills |
| Durable transition order | this Skill through owner commands |

Invoke for non-trivial mutation, tracked continuation, verification, delivery,
or recovery. Status-only work belongs to `pt-context-anchor`.

## Plan Run Authorization

An explicit `continue`, `resume`, `execute the plan`, or equivalent request
starts one Plan Run over the accepted scope and authorization envelope.
Task closure, successor activation, review, retry, Context Anchor, context
compaction, and host change are internal boundaries.

Already-authorized operations execute directly. Stop for user input only at a
typed `HARD_BLOCK` whose decision cannot be derived from accepted sources:
an out-of-envelope or denied action, an actual external permission/credential
failure, an unavailable required external resource, an ungranted destructive
operation, an unresolved material semantic choice, or fixed-point exhaustion.

## Intake And Declaration

1. Verify the explicitly selected worktree root, branch, `workspaceId`, and
   expected HEAD. Never select a worktree from a Skill path.
2. Resolve only that workspace's immutable Plan binding. Ignore synchronized
   foreign Plans.
3. Before mutation, publish the exact source/runtime scope:

   ```bash
   make dev-start WORK_ITEM=<id> PURPOSE='<text>' \
     SOURCE_CLAIMS='<claims>' RUNTIME_CLAIMS='<claims>' \
     [PLAN=<plan.md>] [TASK=<task-id>] [JOURNEY=<journey-id>]
   make dev-check WORK_ITEM=<id>
   ```

4. Use `make dev-update` before scope growth and after an authorized
   source-HEAD change. Use `make dev-heartbeat` before declaration expiry.

A declaration is public intent, not runtime or operation authorization.

## Machine-Driven Run Loop

For tracked work:

1. Run `make workflow-snapshot`.
2. Consume its decision without rebuilding it:
   - `CONTINUE`: repair the named owner or execute the next legal Task action;
   - `HARD_BLOCK`: verify typed boundary plus exhausted runnable frontier, then
     stop;
   - `COMPLETE`: close the Run.
3. Require Snapshot owners to identify the current Plan Package, Task,
   `currentTaskId`, `currentTaskPath`, and Session `devState`.
4. Ask `pt-goal-orchestrator` for one Task-closing Goal Slice and concurrency
   decision.
5. Submit each proposed action to `pt-execution-plan-guardian`.
6. Execute only `ACTION_ALLOWED` work.
7. Persist meaningful results in owner order:
   - Session transition/evidence;
   - Task and manifest lifecycle through `planctl`;
   - workspace active-work through `make active-work-sync WORK_ITEM=<id>`.
   Retain any transient `closureObservation` returned by `planctl advance` only
   for the immediate Context Anchor boundary. Do not persist, reconstruct, or
   request it through another command.
8. Run agent-led review and remediate source-backed findings.
9. Close or park the Task, activate a dependency-ready successor, and repeat
   while Snapshot returns `CONTINUE`.

The scheduler does not execute. The Guardian does not schedule or mutate.
Context Anchor does not repair. A successful administrative action is not Task
progress.

## Functional Fence

Record the first actionable failure, fix it at the owning layer, and run
focused checks. For product or runtime-backed work, dispatch the exact-source
Journey through `pt-dev-runtime-handoff`.

- `HOST_ADAPTER_READY`: consume the result and continue the action.
- `HOST_CAPABILITY_UNAVAILABLE`: for optional workers, recompute serial/hybrid;
  for UI, attempt the repository-native driver once if it has not already been
  attempted for this capability request, then record the capability unavailable
  in the Session and park the current Task only when the interaction is
  mandatory and no legal driver exists. Do not reissue the same native or
  adapter request unless a new `HOST_CAPABILITY_AVAILABLE` observation with the
  same immutable request identity is committed.
- `HOST_TOOL_CALL_FAILED`: when a side effect may remain, submit one idempotent
  cleanup request with the returned `cleanupHandle` to the same adapter and
  require `cleanup=released`; retry once only when the adapter classifies the
  failure retryable, then degrade exactly as unavailable.
- `HOST_CLEANUP_QUARANTINED`: never issue recursive cleanup. Persist the
  bounded lease, handle, expiry and observation in the Session failure record;
  park the current resource-dependent Task, continue independent ready Tasks,
  and submit one read-only `inspect-quarantine` request after expiry.
- `HOST_CLEANUP_ESCALATION_REQUIRED`: the post-expiry observation still found
  the side effect. Do not retry cleanup; keep that resource branch parked and
  treat it as an external-resource hard boundary only after the independent
  frontier is drained.
- `HOST_DIAGNOSTIC_RETAINED`: accept only
  `blocksPlanRun=false`, `cleanup=retained-bounded`, and a concrete
  `leaseExpiresAt`. Commit deterministic project evidence, Session transition,
  Task closure, and successor activation before any host cleanup follow-up.
  Return from the adapter immediately, retain the host-local lease as a
  non-blocking observation, never write the transient envelope to Session
  `currentFailure`, and never wait for its confirmation workflow.

## Host Transport Failure Loop

Repository-native drivers are authoritative. A host adapter is optional
transport after scheduler projection and Guardian admission.

- `HOST_CAPABILITY_UNAVAILABLE`: recompute serial/hybrid execution or park only
  the dependent mandatory action.
- `HOST_TOOL_CALL_FAILED`: retry once only when classified `retryable`; if a
  side effect may remain, issue one idempotent cleanup.
- `HOST_CLEANUP_QUARANTINED`: persist one bounded quarantine and continue
  independent work.
- `HOST_CLEANUP_ESCALATION_REQUIRED`: treat as an external-resource boundary
  only after independent work drains.
- `HOST_DIAGNOSTIC_RETAINED`: accept only
  `blocksPlanRun=false`, `cleanup=retained-bounded`, and a concrete
  `leaseExpiresAt`. Commit deterministic project evidence, Session transition,
  Task closure, and successor activation before any host cleanup follow-up.
  Return from the adapter immediately, retain the host-local lease as a
  non-blocking observation, never write the transient envelope to Session
  `currentFailure`, and never wait for its confirmation workflow.

Never create a zero-progress retry loop. Adapters cannot decide PASS, execute a
repository-native fallback, or mutate project state.

## Agent Review Loop And Amendments

- Undefined Journey or visible state -> `PRODUCT_AMENDMENT_REQUIRED`.
- Undefined ownership, protocol, persistence, or failure semantic ->
  `DESIGN_AMENDMENT_REQUIRED`.
- Accepted semantics with stale inventory/dependency/check mapping ->
  `PLAN_AMENDMENT_REQUIRED`.

Route the amendment to its owner, persist it through `pt-plan-and-document`,
review it with project Review Skills, and continue when accepted sources decide
the result. Routine findings never become a user handoff.

## Acceptance Promotion

After `FUNCTIONAL_PASS`, select scenarios from product states, receiver
outcomes, changed failure semantics, and architecture risks. Run formal
Acceptance on final exact source. `PROVEN` is reserved for formal evidence;
unrun required scope remains `UNPROVEN`.

## Delivery And Close

Run quality, completion, commit, PR, and review owners only within explicit
authorization. Then clean up runtime resources and run:

```bash
make dev-release WORK_ITEM=<id>
make active-work-close WORK_ITEM=<id> EXPECTED_REVISION=<n>
```

Push, PR, deploy, destructive reset, and history rewrite require their own
exact grants.

## Verification

- Public declaration preceded mutation and was released.
- Snapshot supplied every `CONTINUE | HARD_BLOCK | COMPLETE` decision.
- Each successful Goal Slice closed one Task and matched Plan progress.
- Required functional and formal evidence is current.
- Review was agent-led and findings were resolved.
- Durable state changed only through its owner.

## Anti-Patterns

Never:

- duplicate the human workflow standard or a specialist methodology;
- write before declaration or outside scope;
- infer worktree, Plan, authorization, or completion;
- let projections repair owner state;
- ask for repeat authorization;
- stop after a Task/review/Anchor while `CONTINUE` remains;
- run broad Acceptance before `FUNCTIONAL_PASS`;
- claim `PROVEN` from development checks;
- leave owned resources or declarations active.

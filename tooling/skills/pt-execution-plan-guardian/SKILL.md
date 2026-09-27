---
name: "pt-execution-plan-guardian"
description: "Evaluates whether a proposed action may execute under an accepted Peers-Touch plan, binding, declaration, architecture, and evidence policy. It is a read-only policy guard, not an executor or scheduler."
stage: "EXECUTE"
requires: ["accepted active Plan Package", "proposed action", "verified binding and declaration"]
produces: ["ACTION_ALLOWED", "typed denial or amendment escalation"]
---

# Execution Plan Guardian

Human operating standard: `docs/global/workflow.md`.

This Skill is the policy boundary for EXECUTE. It answers:

```text
May this specific proposed action run now?
```

It does not answer what should run next and it does not run anything.

## Boundary

The Guardian:

- reads accepted product, architecture, Plan Package, current Task, binding,
  declaration, and proposed scheduler action;
- verifies scope, dependency, ownership, authorization, evidence, and
  anti-drift policy;
- returns one typed decision.

The Guardian never:

- selects or maintains a Ready/Parked queue;
- chooses concurrency lanes or spawns subagents;
- edits source, tests, docs, plans, Task snapshots, `session.json`,
  workspace active-work, evidence, or Context Anchors;
- acquires runtime resources, deploys, commits, pushes, or opens PRs;
- self-amends a plan;
- claims Task, Journey, stage, or product completion.

`pt-goal-orchestrator` proposes **what** to run.
`pt-execution-plan-guardian` decides **whether** it may run.
`pt-dev-workflow` executes allowed work and persists results.

## Invoke When

- Before each planned source mutation, runtime acquisition, deployment,
  verification, Acceptance action, or delivery action.
- After a proposed action changes scope, dependencies, write sets, runtime
  resources, or evidence strength.
- Before integrating subagent output.
- When execution exposes possible product, design, plan, or Acceptance drift.

Do not invoke to author a plan, schedule a Goal, produce status, or implement
the action.

## Required Inputs

The caller supplies:

- proposed action ID, purpose, and bounded command/operation;
- accepted product and architecture sources;
- validated Plan Package and its current Task;
- Task read/write sets, dependencies, closure, and required evidence;
- verified worktree binding;
- active Development declaration and operation authorization;
- scheduler Concurrency Decision when the action belongs to a parallel lane;
- scheduler Progress Contract identifying whether the action supports or closes
  the current Task boundary;
- current functional and Acceptance state.

Missing required input returns `ACTION_DENIED` with
`EXECUTION_CONTEXT_INCOMPLETE`.

## Decision Procedure

Evaluate in this order:

1. **Identity**
   - canonical worktree, branch, `workspaceId`, and expected HEAD match the
     persisted binding;
   - proposed Plan `planId + planPath` matches the workspace's immutable
     machine binding; synchronized foreign Plans and branch scans are ignored;
   - otherwise `WORKTREE_IDENTITY_MISMATCH`.
2. **Current ownership**
   - the action belongs to the manifest current Task;
   - dependencies are complete;
   - source and runtime owners are unambiguous.
3. **Declared scope**
   - every write is inside both Task/plan scope and the active public
     declaration;
   - runtime use is declared and separately authorized.
4. **Architecture and product**
   - the action implements accepted behavior at the owning layer;
   - no new Journey, visible state, topology, ownership, protocol, persistence,
     or compatibility strategy is invented.
5. **Execution integrity**
   - no silent fallback, error swallowing, temporary dual truth, dirty overlay,
     or weaker substitute for required runtime evidence;
   - generated/shared outputs have one integrator owner.
6. **Concurrency policy**
   - consume the scheduler's Concurrency Decision;
   - reject overlapping write sets, mutable shared runtime resources,
     unfrozen contracts, or undefined integration order;
   - do not redesign the schedule.
7. **Progress policy**
   - the action belongs to the current Task's Progress Slice;
   - a supporting action cannot be reported as Slice completion;
   - Slice success requires the manifest's `in_progress -> done` effect.
8. **Evidence policy**
   - the proposed check proves only its declared class;
   - broad Acceptance remains fenced until required exact-source
     `FUNCTIONAL_PASS`;
   - formal Acceptance uses the current Task closure unless completion/full was
     explicitly authorized.
9. **Operation authorization**
   - consume exact grants from the user and the accepted Plan's explicit
     `authorization` envelope instead of requesting per-Task confirmation;
   - already-authorized operations execute directly; operation category,
     Task handoff, context compaction, retry, or host change cannot turn an
     existing exact grant into `OPERATION_AUTHORIZATION_REQUIRED`;
   - commit, push, PR, deploy, reset, destructive mutation, merge, release, and
     history rewrite each require their own exact grant; one capability never
     implies another;
   - mere Plan existence, a declaration, or an unrelated prior command does not
     grant authority, while an explicit allowed field in the accepted Plan is
     authorization and must not be ignored;
   - return `OPERATION_AUTHORIZATION_REQUIRED` only when the proposed action is
     denied or outside every explicit grant;
   - Task handoff, successor activation, agent review, source-backed
     remediation, and Context Anchor projection are not new operations that
     consume or reset Plan Run authorization.

An actual external permission, credential, or scope failure can be observed
only after Dev Workflow attempts an `ACTION_ALLOWED` operation. Return that
observation to Dev Workflow for typed persistence and bounded remediation; do
not manufacture a preemptive permission question from the operation category.

## Decisions

Return exactly one:

```text
ACTION_ALLOWED
ACTION_DENIED
PRODUCT_AMENDMENT_REQUIRED
DESIGN_AMENDMENT_REQUIRED
PLAN_AMENDMENT_REQUIRED
ACCEPTANCE_PLAN_DRIFT
WORKTREE_IDENTITY_UNAVAILABLE
WORKTREE_IDENTITY_MISMATCH
RESOURCE_DECLARATION_CONFLICT
OPERATION_AUTHORIZATION_REQUIRED
```

Every denial/escalation names:

- proposed action;
- violated source or invariant;
- evidence;
- affected dependents;
- owner that must handle the next step.

## Amendment Routing

- Missing or contradictory Journey/state semantics ->
  `PRODUCT_AMENDMENT_REQUIRED`.
- Missing architecture ownership/protocol/failure semantics ->
  `DESIGN_AMENDMENT_REQUIRED`.
- Accepted semantics with stale inventory, dependency, deliverable, or check
  mapping -> `PLAN_AMENDMENT_REQUIRED`.
- Required Gate absent from the plan contract -> `ACCEPTANCE_PLAN_DRIFT`.

Return the decision to `pt-dev-workflow`. The workflow invokes the owning
methodology and `pt-plan-and-document` persists any accepted plan update.
The Guardian does not perform the amendment, even when it is mechanical.
Accepted-source repairs and their agent review remain inside the Plan Run.
Only an amendment that exposes a DWF-D20 semantic, destructive, authorization,
or external-resource boundary requires user input.

## Functional And Acceptance Policy

- `SOURCE_CHECK`, `STRUCTURAL_CHECK`, and `UX_REVIEW` never establish
  `FUNCTIONAL_PASS`.
- `FUNCTIONAL_PASS` requires one named exact-source Journey or class-specific
  functional boundary in its required runtime and receiver perspective.
- `PROVEN` is reserved for formal Acceptance evidence.
- Scenario selection follows product states, changed failure semantics, and
  architecture risks; a generic five-variant checklist is not mandatory.
- One failed action does not prove the whole plan blocked.

## Concurrency Review

The scheduler owns the lane decision. The Guardian allows a proposed lane only
when:

- prerequisites and shared contracts are frozen;
- exclusive source/write sets are disjoint;
- mutable runtime resources are isolated;
- verification does not rewrite another lane;
- integration and rollback ownership are explicit.

Reject the lane, not the entire plan, when these conditions fail.

## Output

```markdown
**Guardian Decision**
- **Action**: <id and purpose>
- **Decision**: <typed decision>
- **Sources checked**: <paths/IDs>
- **Scope and ownership**: <result>
- **Authorization**: <result>
- **Evidence policy**: <result>
- **Reason / next owner**: <none for ACTION_ALLOWED; otherwise concrete owner>
```

## Verification

- The decision concerns exactly one proposed action.
- No durable or runtime state was mutated.
- Scheduler and execution responsibilities were not duplicated.
- Any escalation points to the owning Skill.
- The strongest permitted claim matches current evidence.
- Supporting activity and Task-closing progress remain distinct.
- A legal denial or amendment returns to the Plan Run owner and does not
  automatically become a user handoff.
- An explicit user or accepted Plan grant produces `ACTION_ALLOWED` without
  repeat confirmation when every other policy check passes.

## Anti-Patterns

Never:

- execute an allowed action;
- choose the next action or maintain queues;
- write or self-amend a plan;
- update Task lifecycle, Session, workspace active-work, or Anchor state;
- infer authorization from mere Plan existence, a declaration, or an unrelated
  prior command;
- ignore an explicit grant in the accepted Plan authorization envelope or ask
  the user to repeat it;
- approve a workaround that violates ownership;
- widen evidence claims;
- treat routine review, remediation, Task handoff, or successor activation as a
  new user-authorization boundary;
- convert one denied action into a plan-wide blocked claim;
- select or change a worktree.

---
name: "pt-execution-plan-guardian"
description: "Executes approved plans without scope or architecture drift. Invoke for implementation, continuation, merging, or status after a formal plan exists."
stage: "EXECUTE"
requires: ["accepted execution plan with status table", "matching active_work entry"]
produces: ["code changes", "tests", "evidence", "updated plan status", "synchronized active_work state"]
next: "pt-github-commit"
---

# Execution Plan Guardian

Use this skill to prevent plan drift. It is mandatory whenever a task is expected
to follow an existing design, execution plan, acceptance checklist, migration
plan, bug-fix protocol, or readiness gate.

## Stage Contract

This skill owns **EXECUTE** only.

```text
accepted product and architecture contracts
  -> pt-architecture-execution-methodology
  -> approved formal execution plan
  -> pt-execution-plan-guardian
  -> implementation, verification, cutover, and evidence
```

It consumes a plan; it does not create or redesign one.

For architecture-level or cross-layer work:

- Missing accepted product contract for product-facing work ->
  `EXECUTION_BLOCKED_BY_PRODUCT`.
- Missing accepted architecture -> `EXECUTION_BLOCKED_BY_DESIGN`.
- Accepted architecture but missing approved plan -> `EXECUTION_BLOCKED_BY_PLAN`.
- Plan execution exposes an undefined architecture semantic ->
  `DESIGN_AMENDMENT_REQUIRED`.
- Execution exposes an undefined user journey, visible state, platform promise,
  or receiver-perspective assertion -> `PRODUCT_AMENDMENT_REQUIRED`.
- Code reality invalidates plan inventory/dependencies but not architecture ->
  `PLAN_AMENDMENT_REQUIRED`.

### Amendment Escalation Rules

**Hard stop (requires user/architect input):**
- `EXECUTION_BLOCKED_BY_PRODUCT` — no product contract exists.
- `EXECUTION_BLOCKED_BY_DESIGN` — no accepted architecture exists.
- `DESIGN_AMENDMENT_REQUIRED` — execution reveals undefined semantics.
- `PRODUCT_AMENDMENT_REQUIRED` — execution reveals undefined journeys/states.

A hard stop fences the affected action and its dependents. It stops the entire
execution horizon only when the missing decision invalidates shared assumptions
for every remaining action. Otherwise park that branch and continue independent
ready work.

**Self-amend and continue (no user confirmation needed):**
- `EXECUTION_BLOCKED_BY_PLAN` — when architecture IS accepted (design doc defines it, proto contracts exist) but no workstream tracks it. The agent adds the workstream entry to the plan, then proceeds.
- `PLAN_AMENDMENT_REQUIRED` — when the architecture remains valid and the amendment is mechanical (inventory update, dependency reorder, new deliverable for already-designed capability). The agent updates the plan inline and continues execution.

**Rationale**: If the architecture source already covers the work (design.md defines the contracts, proto files implement them), blocking on user confirmation for a plan bookkeeping entry adds latency without reducing risk. The agent is capable of writing a workstream entry. What it is NOT capable of is inventing architecture — that's where the hard stops apply.

The agent must still **document what it self-amended** in its progress report so the user can audit the change.

## Invoke When

- The user says "continue", "proceed", "execute", "land it", "merge", "finish",
  "report progress", "what is completed", or the Chinese equivalents "继续",
  "接着做", "推进", "落地", "合入", "汇报进度".
- The user asks to go faster or parallelize: "加速", "加快", "多 subagent",
  "并行", "speed up", "in parallel".
- The user asks whether a capability is "done", "usable", "ready", "complete",
  or "implemented".
- The user warns against shortcuts: "不要打补丁", "别 workaround", "遵守架构规范",
  "符合规划", "no band-aid", "follow the architecture".
- The task references architecture docs, execution plans, specs, readiness
  reports, checklists, PRD docs, or issue plans.
- The work spans multiple domains, phases, gates, or repositories/worktrees.
- The user corrects the agent for drifting, patching, overclaiming, or losing
  focus.

Do not use this skill for isolated one-file edits that have no plan/spec source,
unless the user asks for completion status or readiness.

Do not treat a design document as an execution plan. Architecture says what the
target state permits; an execution plan supplies workstream IDs, dependencies,
cutovers, gates, and evidence.

## Required Discipline

The agent must not say "done", "completed", "ready", or "usable" without naming
the exact scope that is done and the evidence that proves it.

Every execution or progress report must distinguish:

- Formal plan phase or workstream.
- User-requested ad hoc phase.
- Temporary mitigation or local-only implementation.
- Verified behavior.
- Unverified or explicitly not implemented behavior.

If an existing plan document cannot be found, say so before executing and treat
an isolated, non-architectural task as ad hoc with a temporary acceptance
checklist. Architecture migrations and cross-layer refactors must stop with
`EXECUTION_BLOCKED_BY_PLAN`; they may not proceed ad hoc.

## Immutable Worktree Binding

A skill source path identifies instructions only. It does not select an
execution worktree. The current verified worktree remains bound for the entire
execution slice.

Before execution dispatch and before any edit:

1. Require one explicitly selected current worktree. If multiple candidate
   roots are visible and none is explicit, stop for clarification; never infer
   the worktree from the skill, plan, branch name, or repository proximity.
2. From that exact root, capture the candidate identity with
   `python3 tooling/scripts/verify-worktree-binding.py --root '<absolute-root>' --capture`.
3. Reconcile the captured identity with every identity recorded by `active_work`, the
   formal plan, and the latest Context Anchor.
4. From the same root, immediately verify the captured identity with
   `python3 tooling/scripts/verify-worktree-binding.py --root '<absolute-root>' --branch '<branch>' --workspace-id '<workspaceId>' --head '<expected-head>' --worktree-set-digest '<digest>'`,
   then bind its canonical root, branch, `workspaceId`, initial HEAD, expected
   HEAD, and worktree-set digest. Materialized values must each be one POSIX
   shell-safe argument.
5. Treat a missing verifier or unresolved field as
   `WORKTREE_IDENTITY_UNAVAILABLE`. Treat a mismatch, wrong invocation
   directory, or later drift as `WORKTREE_IDENTITY_MISMATCH`. Both stop without
   automatic `cd`, checkout, branch switch, or selection of another worktree.

All mutating tool calls require the bound canonical root as explicit `workdir`;
file mutation tools use absolute paths beneath that root. Every subagent brief
includes the immutable binding, and each subagent runs the verifier against it
before writing.

Re-verify after resume or context compaction and before status, readiness,
handoff, or completion claims. The initial HEAD remains the audit baseline;
expected HEAD may refresh only after an explicitly authorized commit, rebase,
or merge. The worktree-set digest may refresh only after an explicitly
requested worktree operation. Resume and context compaction verify persisted
values; they never recapture current Git state as a replacement baseline.
Never run `git switch`, `git checkout`, `git worktree add`,
`git worktree remove`, or `git worktree prune`, and never create a worktree,
unless the user explicitly requested that exact operation.

## Escalation Decision Logic

The agent self-drives execution. It escalates to the user only when the decision
requires product judgment that cannot be derived from existing sources.

Decision tree for any choice point during execution:

```text
Can the answer be derived from docs/architecture, AGENTS.md, proto, or code?
  └─ YES → Agent decides, proceeds.

Multiple valid approaches exist — does the difference affect user-visible behavior?
  └─ NO (pure implementation detail) → Agent picks the architecturally cleaner option.
  └─ YES (user can perceive the difference) → ASK USER (product decision).

Information is missing:
  ├─ Missing technical info → Agent investigates (read code, run experiment).
  └─ Missing product intent → ASK USER.

Architecture constraint forces a UX difference vs. the reference implementation:
  └─ Forced by constraint (no alternative) → Agent proceeds with constraint-driven design.
  └─ Constraint allows two UX patterns (choice is preference) → ASK USER.
```

Rules:
- Never ask "can I proceed to the next step?" — proceed if completion criteria are met.
- Never ask "is this design OK?" as a blanket confirmation — validate it yourself against architecture sources.
- When escalating, ask ONE specific question with concrete options, not an open-ended "what do you think?"
- Stage review and approval gates are governed by `pt-god-view` and the owning
  stage skill. Within an already approved EXECUTE stage, the agent self-drives
  implementation decisions that are derivable from accepted sources; it does
  not self-approve a stage transition.

## Standing Directive

Treat this as the default operating contract for every execution turn, even when
the user only says "继续" / "continue" without repeating the details:

1. **Go fast via parallelism, not shortcuts.** Prefer fanning out independent
   work to multiple subagents and reusing existing tools/scripts over doing
   serial manual work. Speed never justifies skipping the plan, the architecture
   rules, or the evidence step.
2. **Stay architecture- and plan-conformant.** Every change must map to a plan
   item and land in the layer/module the architecture assigns. Do not invent a
   parallel structure.
3. **No patching (不要打补丁).** Fix the root cause at the correct layer. Do not
   add compatibility shims, silent fallbacks, `try/except`-to-hide, magic
   special-cases, or "just make it pass" hacks. If only a temporary mitigation is
   possible, label it `Local-only` with a `Risk` note and never present it as the
   final fix.
4. **No silent scope or design changes.** Surface deviations instead of hiding
   them.
5. **Keep the queue live.** A blocked action is parked, not promoted to a
   Goal-level blocker, while any other source-defined action or admissible
   root-cause remediation remains dependency-ready.

## Workflow

### 0. Validate Stage Preconditions

Before any code edit, first satisfy `Immutable Worktree Binding`, then verify:

- Product status is accepted/active where product design is required.
- Architecture status is accepted/active where architecture is required.
- A formal execution plan exists and is approved.
- A matching `active_work` entry points to that plan and matches the verified
  branch, `workspaceId`, expected HEAD, and worktree-set digest.
- Requested work maps to a plan workstream/task ID.
- Dependencies for that task are complete.
- Required cutover, deletion, gates, and evidence are defined.

If not, return the matching blocked/amendment state from the Stage Contract.
If only the Anchor is missing or stale, reconcile it before editing; do not
reconstruct progress from conversation memory.

### 1. Find Plan Sources

Before execution or readiness reporting, identify the authoritative sources in
this order:

1. Accepted product definition, experience/state contracts, benchmark
   disposition, prototype status, and product acceptance matrix.
2. Architecture-layer docs, such as `docs/architecture/**`.
3. Platform-layer docs, such as `docs/client/**`, `docs/station/**`.
4. Specification-layer docs, such as `docs/global/coding-guide/**`.
5. Execution plans, progress docs, checklists, readiness reports, issue specs,
   or PRD docs.
6. User-confirmed decisions from the current conversation.

Output a `Plan Source` list with paths or explicitly state `No formal plan
source found`. For architecture work, `No formal plan source found` blocks
execution.

### 2. Bind Scope

Map the requested work to the plan:

- `Workstream / Task ID`: the exact plan unit being executed.
- `In Scope`: plan items or user decisions this task is allowed to change.
- `Out of Scope`: plan items that remain untouched.
- `Local Decision`: choices made for this task that are not yet in the formal
  plan.
- `Risk`: where local decisions might diverge from the formal plan.

If the task uses informal phase names, explicitly say whether those phases are
local to the conversation or belong to the formal plan.

A local decision may choose implementation detail only within the accepted
architecture and plan. It may not change topology, ownership, contracts,
invariants, thresholds, cutover policy, or compatibility strategy.

### 3. Define Acceptance

Before coding, define acceptance criteria from the plan:

- Required behavior.
- Required failure behavior.
- Required product capability, journey, visible state, and acceptance IDs.
- Required architecture IDs and plan task IDs.
- Required old-path deletion/search result.
- Required evidence files or commands.
- Required docs/progress updates, if the plan requires them.

If the user asks for a bug fix, also follow the repository bug-fix protocol:
root cause, plan, user approval, then execution.

### 4. Execute Fast Without Drifting

Aim for maximum speed with zero plan/architecture drift.

**Parallelize with subagents.** Before starting serial work, split the task into
independent units and check whether they can run concurrently:

- Fan out independent units to parallel subagents (e.g. per module, per file
  group, per domain, per worktree). Dependent units stay sequential.
- Every subagent brief MUST inherit the same `Plan Source`, `In Scope` /
  `Out of Scope`, target layer/module, No-Patch rule, canonical root, branch,
  `workspaceId`, initial HEAD, expected HEAD, and worktree-set digest.
  Subagents verify that immutable binding before writes, so they converge on
  the planned architecture in the same worktree instead of inventing a local
  design.
- Give each subagent its own acceptance/verification command so it self-checks.
- After subagents return, run a **reconcile pass**: check for conflicting edits,
  duplicated abstractions, and interface mismatches at the seams before
  integrating. Resolve conflicts toward the plan, not toward whichever subagent
  wrote last.

**During implementation:**

- Do not broaden scope silently.
- Execute only dependency-ready task IDs.
- Fix root causes at the architecture-assigned layer. Do not patch: no
  compatibility shims, silent fallbacks, error-swallowing, or special-case hacks
  to force a pass. If one action is blocked, surface and park that action,
  recompute the complete in-scope ready frontier, and continue other legal work.
- If implementation reveals missing retry, replay, ordering, cancellation,
  overload, auth, lifecycle, or data-plane semantics, stop with
  `DESIGN_AMENDMENT_REQUIRED`.
- If implementation reveals a missing journey, visible state, benchmark
  disposition, platform behavior, or receiver-perspective assertion, stop with
  `PRODUCT_AMENDMENT_REQUIRED`.
- If the architecture remains valid but current inventory, dependency order,
  deliverables, or gates are wrong/incomplete, stop with
  `PLAN_AMENDMENT_REQUIRED`.
- Do not replace planned architecture with a local shortcut without calling it
  out as `Local-only` + `Risk`.
- Do not rename ad hoc work as formal plan completion.
- Do not report readiness higher than the gates prove.
- Keep note of gaps discovered during execution.
- Synchronize the plan status table and Context Anchor after every meaningful
  step, evidence, blocker, scope, worktree, branch, or stage change.

### 4.1 Blocker-Aware Execution Queue

Tracked execution maintains four projected states: `Ready Queue`, `In
Progress`, `Parked Queue`, and `Done`. The formal plan remains the source of
truth.

When execution discovers a blocker:

1. Record the exact failed action, evidence, owner, and blocking edge.
2. Classify it:
   - `RECOVERABLE_IMPLEMENTATION`: diagnose and enqueue the root-cause fix plus
     regression evidence;
   - `MECHANICAL_PLAN_GAP`: update the plan under Amendment Escalation Rules,
     then enqueue the new task;
   - `SOFT_EXTERNAL`: park it and continue independent ready work;
   - `HARD_GOVERNANCE`: park it pending product/architecture decision,
     destructive or version authorization, cross-owner authority, stage review,
     or unavailable external resources.
3. Recompute the dependency-ready frontier across the full approved in-scope
   graph, including work exposed by the newly completed or parked action.
4. Continue until the Ready Queue is empty.

Do not set `active_work.blocked=true` or mark the whole Goal `blocked` on the
first blocked action. Goal-level blocked requires a fixed-point exhaustion
audit proving:

- every omitted in-scope mechanical task was added to the plan;
- no legal diagnosis, root-cause fix, verification, documentation, or other
  independent action can make progress;
- every remaining Parked Queue item is behind a hard governance or unavailable
  external-resource boundary;
- the same blocking condition satisfies the repeated-blocker lifecycle
  threshold.

This queue discipline does not authorize architecture invention, version bumps,
destructive operations, cross-worktree writes, or weaker evidence.

### 4.2 Context Synchronization Checkpoints

Invoke `pt-context-anchor`:

1. after worktree-binding verification and before the first tracked edit;
2. when a workstream or step starts;
3. immediately after verification passes or fails;
4. when worktree, branch, scope, blocker, or decision changes;
5. before progress/readiness reports and session handoff.

The Anchor worktree fields record `<worktree-name> (<repo-root>)`, verified
branch, `workspaceId`, initial HEAD, expected/verified HEAD, and worktree-set
digest. A bare `<repo-root>` is invalid. Never persist a developer or CI
user-home absolute path. Any identity mismatch stops with
`WORKTREE_IDENTITY_MISMATCH`; do not synchronize a drifting identity into the
plan or Anchor as if it were valid.

Update `active_work`, todos, dashboards, and chat only after the durable plan
Anchor is synchronized.

### 5. Report With Evidence

Final answers and progress reports must use this structure when the task is
non-trivial:

```markdown
**Plan Source**
- `<path>`: <what it governs>
- User decision: <if applicable>

**Scope Completed**
- `<workstream/task ID>`: <what was actually completed>

**Evidence**
- `<command>`: PASS/FAIL/NOT RUN
- `<evidence path>`: PASS/FAIL/NOT IMPLEMENTED

**Not Completed**
- <planned item not completed>: <why it remains open>

**Claim**
- <the strongest accurate claim supported by evidence>
```

For readiness reports with predefined gates, use the gate table from the
readiness document instead of a free-form claim.

After updating plan/tracking evidence, synchronize `active_work`. Any
tracked-work progress, readiness, blocker, or handoff response must then invoke
`pt-context-anchor` and end with its required fenced chat projection. Never add
a `## Context Anchor` section to the execution plan.

## Claim Rules

- "Works" means a named product path was executed successfully.
- "Ready" means the relevant plan gates passed.
- "Completed" means all deliverables and pass criteria for a named formal
  workstream passed.
- "Partial" means at least one deliverable, pass criterion, or required evidence
  is missing.
- "Local-only" means the implementation does not yet satisfy the planned
  production architecture, such as Station Store, policy distribution, revoke,
  rollback, audit ingestion, or cross-host parity.
- "Plan ready" is never a Guardian claim; plan readiness belongs to
  `pt-architecture-execution-methodology`.
- "Architecture accepted" is never a Guardian claim; architecture acceptance
  belongs to the owner/reviewer after `pt-architecture-design-methodology`.

## Anti-Patterns

Never:

- Select an execution worktree from the skill source path.
- Continue after `WORKTREE_IDENTITY_MISMATCH` or repair it with implicit
  directory, branch, or worktree operations.
- Mutate without the explicit bound `workdir`, or let a subagent write before
  verifying the inherited binding.
- Execute an architecture migration from `design.md` alone.
- Author missing architecture decisions while coding.
- Continue the affected action or its dependents after
  `DESIGN_AMENDMENT_REQUIRED` or `PRODUCT_AMENDMENT_REQUIRED`; park that branch
  until the user/architect resolves it while unrelated ready branches continue.
- Mark an entire Goal blocked because one action is blocked while other
  dependency-ready or admissible remediation work exists.
- Leave a source-defined root-cause fix or mechanical plan amendment unqueued
  merely because it was discovered after execution started.
- Self-amend the plan in ways that change architecture boundaries, ownership,
  contracts, or acceptance gates (that's design, not plan bookkeeping).
- Say "Phase 3 completed" without specifying which plan owns Phase 3.
- Use a local task phase name that collides with a formal plan phase without
  clarification.
- Hide `NOT_IMPLEMENTED` items behind optimistic summaries.
- Treat a smoke test as proof of full platform readiness.
- Treat a visual/UI contract as the source for runtime capability decisions.
- Claim Station Store readiness from a local preference-backed install model.
- Ship a patch (compat shim, fallback, error-swallow, special-case) as if it
  were a root-cause fix.
- Fan out subagents without giving them the shared plan source and architecture
  constraints, letting each invent its own local design.
- Skip the reconcile pass and merge conflicting subagent outputs blindly.

## Examples

### Good Claim

```markdown
**Claim**
- Desktop `peers.note` runtime path works: the live smoke passed through
  AppletManager, LynxHost, Lynx Web, SDK bridge, and Gateway.
- Formal Station Store integration is not complete: registry, policy
  distribution, revoke, rollback, and audit ingestion remain open.
```

### Bad Claim

```markdown
Applet platform is done.
```

This is invalid unless the formal platform readiness gates prove it.

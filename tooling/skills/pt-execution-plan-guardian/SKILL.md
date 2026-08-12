---
name: "pt-execution-plan-guardian"
description: "Executes an approved plan without architecture or scope drift, preserving dependency order, cutovers, gates, and evidence. Invoke only after a formal plan exists when implementing, continuing, merging, or reporting planned work."
stage: "EXECUTE"
requires: ["accepted execution plan with status table"]
produces: ["code changes", "tests", "evidence", "updated plan status"]
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
- The only natural external gate is PR review (git workflow). All other stage transitions are self-judged.

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

## Workflow

### 0. Validate Stage Preconditions

Before any code edit, verify:

- Product status is accepted/active where product design is required.
- Architecture status is accepted/active where architecture is required.
- A formal execution plan exists and is approved.
- Requested work maps to a plan workstream/task ID.
- Dependencies for that task are complete.
- Required cutover, deletion, gates, and evidence are defined.

If not, return the matching blocked/amendment state from the Stage Contract.

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
  `Out of Scope`, target layer/module, and the No-Patch rule, so subagents
  converge on the planned architecture instead of each inventing a local design.
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
  to force a pass. If a real fix is blocked, stop and surface it instead of
  papering over it.
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

- Execute an architecture migration from `design.md` alone.
- Author missing architecture decisions while coding.
- Continue after `DESIGN_AMENDMENT_REQUIRED` or `PRODUCT_AMENDMENT_REQUIRED`
  (these are hard stops — user/architect must resolve them).
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

---
name: "pt-execution-plan-guardian"
description: "Keeps work tied to plan sources, scope, architecture rules, gates, and evidence, and governs HOW to execute: parallelize with subagents for speed, stay architecture-conformant, and fix root causes instead of patching. Invoke when executing, continuing (继续), accelerating (加速/多 subagent), fixing, merging, or reporting planned work."
---

# Execution Plan Guardian

Use this skill to prevent plan drift. It is mandatory whenever a task is expected
to follow an existing design, execution plan, acceptance checklist, migration
plan, bug-fix protocol, or readiness gate.

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
the current work as an ad hoc task with a temporary acceptance checklist.

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

### 1. Find Plan Sources

Before execution or readiness reporting, identify the authoritative sources in
this order:

1. Architecture-layer docs, such as `docs/architecture/**`.
2. Platform-layer docs, such as `docs/client/**`, `docs/station/**`.
3. Specification-layer docs, such as `docs/global/coding-guide/**`.
4. Execution plans, progress docs, checklists, readiness reports, issue specs,
   or PRD docs.
5. User-confirmed decisions from the current conversation.

Output a `Plan Source` list with paths or explicitly state `No formal plan
source found`.

### 2. Bind Scope

Map the requested work to the plan:

- `In Scope`: plan items or user decisions this task is allowed to change.
- `Out of Scope`: plan items that remain untouched.
- `Local Decision`: choices made for this task that are not yet in the formal
  plan.
- `Risk`: where local decisions might diverge from the formal plan.

If the task uses informal phase names, explicitly say whether those phases are
local to the conversation or belong to the formal plan.

### 3. Define Acceptance

Before coding, define acceptance criteria from the plan:

- Required behavior.
- Required failure behavior.
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
- Fix root causes at the architecture-assigned layer. Do not patch: no
  compatibility shims, silent fallbacks, error-swallowing, or special-case hacks
  to force a pass. If a real fix is blocked, stop and surface it instead of
  papering over it.
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
- <formal workstream or local task>: <what was actually completed>

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

## Anti-Patterns

Never:

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

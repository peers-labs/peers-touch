---
name: "execution-plan-guardian"
description: "Keeps work tied to plan sources, scope, gates, and evidence. Invoke when executing, continuing, fixing, merging, or reporting planned work."
---

# Execution Plan Guardian

Use this skill to prevent plan drift. It is mandatory whenever a task is expected
to follow an existing design, execution plan, acceptance checklist, migration
plan, bug-fix protocol, or readiness gate.

## Invoke When

- The user says "continue", "proceed", "execute", "land it", "merge", "finish",
  "report progress", "what is completed", or similar wording for ongoing work.
- The user asks whether a capability is "done", "usable", "ready", "complete",
  or "implemented".
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

### 4. Execute Without Overclaiming

During implementation:

- Do not broaden scope silently.
- Do not replace planned architecture with a local shortcut without calling it
  out.
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

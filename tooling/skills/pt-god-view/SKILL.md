---
name: "pt-god-view"
description: "Thin facade for classifying Peers-Touch work and dispatching exactly one owning workflow or specialist skill. Invoke for new work, resume, status, handoff, or explicit methodology routing."
stage: "orchestrator"
requires: []
produces: ["work classification", "owning-skill route", "route blocker when intent is ambiguous"]
---

# God View

Human operating standard: `docs/global/workflow.md`.

`pt-god-view` is the methodology facade. It answers one question:

```text
Given the user's intent and current project state, which owner must act next?
```

It does not perform that owner's work.

## Boundary

God View owns:

- intent classification;
- tracked versus standalone determination;
- stage and specialist routing;
- ambiguity detection;
- one concise explanation of the selected route.

God View does not:

- edit repository files;
- create or amend plans;
- update workspace active-work, Task state, `session.json`, or evidence;
- publish Development declarations or acquire runtime resources;
- build Ready/Parked queues or choose concurrency lanes;
- execute implementation, verification, Acceptance, commit, or delivery;
- reproduce the operating procedure of a dispatched Skill.

For non-trivial mutation, route to `pt-dev-workflow`, the sole intake-to-close
application service. For status projection, route to the read-only
`pt-context-anchor`. For Goal authoring or scheduling, route to the
host-neutral `pt-goal-orchestrator` after the owning workflow has supplied
verified sources and binding. Host-specific syntax or tools are selected later
by a detected `pt-*-host-adapter`.

## Invoke When

- The user says `continue`, `resume`, `status`, `handoff`, `new task`, or the
  Chinese equivalents.
- The request spans multiple methodology stages.
- The user explicitly asks to use the Peers-Touch methodology.
- The correct specialist owner is unclear.

Do not invoke for casual conversation or a self-contained read-only question
whose owner is already obvious.

## Routing Procedure

1. Identify the explicitly selected repository/worktree. If multiple candidates
   remain plausible, return `WORKTREE_SELECTION_REQUIRED`.
2. For tracked work, resolve that workspace's immutable Plan binding. Ignore
   other active Plans synchronized into the same repository or PR; never
   replace an existing binding.
3. Classify intent:
   - `STATUS_OR_HANDOFF`
   - `NON_TRIVIAL_MUTATION`
   - `STANDALONE_SMALL_FIX`
   - `PRODUCT`
   - `DESIGN`
   - `PLAN`
   - `REVIEW`
   - `GOAL`
4. Select exactly one primary owner from the table below.
5. Announce the route and reason in one short sentence.
6. Invoke the owner and stop applying God View logic. The owner may dispatch
   narrower specialists under its own contract.

## Route Table

| Intent | Primary owner |
|---|---|
| Non-trivial implementation, continuation, verification, or delivery | `pt-dev-workflow` |
| Tracked-work status or handoff projection | `pt-context-anchor` |
| Small isolated correction | `pt-small-fix-discipline` |
| Product goal, Journey, visible state, or benchmark decision | `pt-product-design-methodology` |
| Architecture boundary, ownership, topology, or contract | `pt-architecture-design-methodology` |
| Accepted architecture needs an execution model | `pt-architecture-execution-methodology` |
| Accepted plan model needs repository persistence | `pt-plan-and-document` |
| Goal authoring/review/next slice | `pt-goal-orchestrator` |
| General PR review | `pt-github-review` |
| Need to optimize/audit Acceptance Infra | `pt-acceptance-infra-engineering` |
| Need business Domain Acceptance injection/proof | `pt-acceptance-engineering` |
| Bug closure with regression protection | `pt-defect-closure` |

When a read-only discussion becomes mutating, reroute to `pt-dev-workflow`
before the first write or runtime acquisition.

## Resume And Status

- `status` routes to `pt-context-anchor`; God View does not reconstruct state
  from chat or inspect plan internals itself.
- `continue` or `resume` routes to `pt-dev-workflow`; the workflow verifies
  physical identity, resolves durable state, and resumes the authorized Plan
  Run across dependency-ready Tasks and internal review gates.
- A resume must not pause merely to print the Anchor. The workflow emits the
  read-only projection at the next meaningful report boundary.
- Ambiguous tracked work returns `TRACKED_WORK_SELECTION_REQUIRED` with the
  minimum identifiers needed to choose.

## Stage Routing

The facade may name the current methodology stage, but stage behavior belongs
to the owner:

| Stage | Owner |
|---|---|
| PRODUCT | `pt-product-design-methodology` |
| DESIGN | `pt-architecture-design-methodology` |
| PLAN analysis | `pt-architecture-execution-methodology` |
| PLAN persistence | `pt-plan-and-document` |
| EXECUTE through DELIVER | `pt-dev-workflow` |

God View never self-approves a stage gate and never embeds stage procedures.
The owning workflow invokes the project's agent-led review loop; routine review
does not route back to the user.

## Output

Use this compact shape:

```text
Route: <skill>
Reason: <one sentence>
Blocked by: <none or one concrete ambiguity>
```

After dispatch, the owning Skill controls all further output.

## Verification

- Exactly one primary owner is selected.
- No repository or durable workflow state was mutated by God View.
- No queue, plan, Task, Session, Acceptance, or delivery procedure was copied
  into the facade.
- Resume/status routing does not use chat history as truth.
- Worktree ambiguity is surfaced, never guessed.

## Anti-Patterns

Never:

- become a second complete-development workflow;
- duplicate plan schemas, Task fields, verifier commands, queue algorithms, or
  execution policy;
- update workspace active-work or a Context Anchor;
- route a non-trivial mutation directly to a late-stage specialist and bypass
  `pt-dev-workflow`;
- select a repository from a Skill source path;
- infer approval, authorization, or completion while routing.

---
kind: invariant
title: Plan Runs continue across internal boundaries
status: active
owns:
  - AGENTS.md
  - docs/global/workflow.md
  - docs/architecture/development-workflow/
  - tooling/skills/pt-dev-workflow/
  - tooling/skills/pt-goal-orchestrator/
  - tooling/skills/pt-context-anchor/
  - tooling/skills/pt-execution-plan-guardian/
  - tooling/skills/pt-product-design-methodology/
  - tooling/skills/pt-architecture-design-methodology/
  - tooling/skills/pt-architecture-execution-methodology/
  - tooling/skills/pt-plan-and-document/
  - tooling/skills/pt-quality-check/
  - tooling/skills/pt-completion-auditor/
  - tooling/skills/pt-github-review/
  - tooling/skills/pt-ew/
referenced-by:
  - docs/architecture/development-workflow/decisions.md
related:
  - docs/architecture/development-workflow/design.md
  - docs/architecture/development-workflow/integration.md
detected: 2026-09-19
---

# Plan Runs continue across internal boundaries

## What must hold

One explicit request to continue or execute an accepted Plan MUST authorize one
continuous Plan Run over its accepted scope and authorization envelope. Task
closure, Goal Slice completion, stage review, Context Anchor output, and
context compaction MUST NOT become user confirmation boundaries while a legal
dependency-ready frontier remains.

Review MUST be agent-led by default. The Development Run invokes the applicable
project Review Skills, fixes source-backed findings, and reruns review. It MUST
escalate only operations outside the accepted authorization envelope,
destructive/irreversible or separately governed operations, missing external
authorization or resources, material semantic choices that accepted sources
cannot resolve, or fixed-point exhaustion.

Already-authorized operations execute directly. An exact grant from the user or
an explicit allowed entry in the accepted Plan's `authorization` envelope MUST
remain valid throughout the Plan Run. Operation category, Task handoff, retry,
context compaction, and host change MUST NOT trigger repeat confirmation.

For authorization specifically, user input is legal only when the proposed
operation is denied or outside every explicit grant, or after an admitted
operation was attempted and returned an actual external permission,
credential, or scope failure. Mere Plan existence, a public declaration, or an
unrelated prior command does not grant authority; the Plan's explicit
authorization fields do.

## Why this is non-negotiable

Task and Goal boundaries exist to preserve deterministic scheduling, recovery,
and evidence. Treating each boundary as a user handoff turns internal control
plane checkpoints into repeated approval work and prevents long Plans from
converging.

Product, architecture, plan, completion, and code Review Skills already own
structured judgment. Sending those reviews wholesale to the user bypasses the
project's quality system and makes the user the default scheduler and reviewer.
Narrow escalation preserves safety without fragmenting execution.

## How to verify

- `tooling/scripts/review/skill-check.sh` passes.
- `rg -n "user decides whether to send|user initiates review|Continue\\?" AGENTS.md tooling/skills docs/global/workflow.md docs/architecture/development-workflow` returns only explicit anti-pattern statements.
- `rg -n "Plan Run|agent-led review|Agent Review Loop" AGENTS.md tooling/skills/pt-dev-workflow/SKILL.md docs/architecture/development-workflow` finds the governing contracts.
- `rg -n "Already-authorized operations execute directly|actual external permission" AGENTS.md tooling/skills docs/global/workflow.md docs/architecture/development-workflow` finds the authorization-reuse contract.

## Crosswalks

- DWF-D15 defines Task-closing Progress Slices.
- DWF-D20 defines the continuous Plan Run and agent review boundary.

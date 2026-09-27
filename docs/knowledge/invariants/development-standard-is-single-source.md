---
kind: invariant
title: Development has one human-facing operating standard
status: active
owns:
  - docs/global/workflow.md
  - docs/architecture/development-workflow/
  - tooling/skills/pt-dev-workflow/
  - tooling/skills/pt-god-view/
  - tooling/skills/pt-goal-orchestrator/
  - tooling/skills/pt-execution-plan-guardian/
  - tooling/skills/pt-context-anchor/
referenced-by:
  - docs/architecture/development-workflow/decisions.md
related:
  - docs/knowledge/invariants/continuous-plan-run.md
  - docs/knowledge/invariants/workflow-snapshot-is-read-only.md
detected: 2026-09-20
---

# Development has one human-facing operating standard

## What must hold

`docs/global/workflow.md` is the only human-facing end-to-end development
procedure. Small, standard, and large work follow the same ownership,
declaration, execution, evidence, review, and cleanup flow; only required
artifact depth differs.

Architecture documents define control-plane ownership, schemas, decisions, and
integration contracts. Skills define one owner's executable behavior and
consume machine decisions. Neither may publish a competing end-to-end
procedure.

## Why this is non-negotiable

Duplicating the flow across global docs, architecture docs, and Skills makes
authorization, continuation, and evidence ordering drift independently. A
single human standard plus owner-specific machine contracts keeps instructions
readable without creating another source of truth.

## How to verify

- `tooling/scripts/review/skill-check.sh` passes.
- `docs/global/workflow.md` names small, standard, and large artifact depth.
- Workflow Skills reference `docs/global/workflow.md` and consume
  `CONTINUE | HARD_BLOCK | COMPLETE` where relevant.
- Architecture docs identify themselves as implementation contracts rather
  than another human procedure.
- No current workflow document or Skill introduces a versioned workflow name
  or compatibility path.

## Crosswalks

- DWF-D23 keeps the internal workflow unversioned.
- DWF-D24 makes continuation and Acceptance admission machine-enforced.

---
kind: invariant
title: Development has one shared operating standard
status: active
owns:
  - docs/development/workflow.md
  - docs/architecture/engineering/development-workflow/
  - tooling/skills/pt-dev-workflow/
  - tooling/skills/pt-god-view/
  - tooling/skills/pt-goal-orchestrator/
  - tooling/skills/pt-execution-plan-guardian/
  - tooling/skills/pt-context-anchor/
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/knowledge/invariants/continuous-plan-run.md
  - docs/knowledge/invariants/workflow-snapshot-is-read-only.md
detected: 2026-09-20
---

# Development has one shared operating standard

## What must hold

`docs/development/workflow.md` is the only end-to-end development procedure for
humans and agents. Small, standard, and complex work follow the same intake,
design, implementation, evidence, review, and delivery flow; only required
artifact depth differs.

Architecture documents define control-plane ownership, schemas, decisions, and
integration contracts. `AGENTS.md`, Skills, Make/devctl, Hooks, and CI adapt or
execute the shared procedure. None may publish a competing end-to-end flow.

## Why this is non-negotiable

Duplicating the flow across human docs, agent docs, architecture docs, and
Skills makes authorization, continuation, and evidence ordering drift. A
single shared standard plus owner-specific machine contracts keeps instructions
readable and prevents audience-specific truth.

## How to verify

- `tooling/scripts/review/skill-check.sh` passes.
- `docs/development/workflow.md` names small, standard, and complex work.
- Workflow Skills reference `docs/development/workflow.md` and consume
  `CONTINUE | HARD_BLOCK | COMPLETE` where relevant.
- `AGENTS.md` links to the shared Dev knowledge base instead of duplicating
  platform guides or command matrices.
- Architecture docs identify themselves as implementation contracts rather
  than another human procedure.
- No current workflow document or Skill introduces a versioned workflow name
  or compatibility path.

## Crosswalks

- DWF-D23 keeps the internal workflow unversioned.
- DWF-D24 makes continuation and Acceptance admission machine-enforced.

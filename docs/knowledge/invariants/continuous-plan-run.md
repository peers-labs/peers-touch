---
kind: invariant
title: Authorized Development Runs continue across internal boundaries
status: active
owns:
  - AGENTS.md
  - docs/global/workflow.md
  - docs/architecture/engineering/development-workflow/
  - tooling/skills/pt-dev-workflow/
  - tooling/skills/pt-goal-orchestrator/
  - tooling/skills/pt-context-anchor/
  - tooling/skills/pt-execution-plan-guardian/
  - tooling/skills/pt-completion-auditor/
  - tooling/skills/pt-github-review/
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/architecture/engineering/development-workflow/design.md
detected: 2026-09-19
---

# Authorized Development Runs continue across internal boundaries

## What must hold

One explicit request to continue or execute accepted work authorizes continuous
progress over that accepted scope and authorization envelope. Goal slices,
optional task checkpoints, internal review, evidence refresh, and context
compaction do not become repeated confirmation boundaries while authorized
ready work remains.

Agent-led review fixes source-backed findings and reruns affected checks.
Escalation is limited to scope changes, separately governed or destructive
operations, missing external permission/resources, unresolved semantic choices,
or an empty ready frontier.

An explicit user grant remains valid for its exact operation and scope. A Plan,
task record, Hook event, chat identity, or prior unrelated command never
creates or expands that grant.

## Why this is non-negotiable

Internal checkpoints support recovery and evidence. Treating each as a user
handoff fragments execution and makes bookkeeping, rather than the requested
result, the workflow owner.

## How to verify

- `tooling/scripts/review/skill-check.sh` passes.
- Goal-driven work parks one blocked action while independent ready work
  continues.
- No internal task/review/checkpoint boundary asks for repeat confirmation of
  an already authorized operation.

## Crosswalks

- DWF-D20 defines continuous execution.
- DWF-D42 removes auxiliary workflow state from ordinary admission.

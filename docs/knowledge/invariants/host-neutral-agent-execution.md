---
kind: invariant
title: Project execution semantics are independent of the agent host
status: active
owns:
  - AGENTS.md
  - docs/global/workflow.md
  - docs/architecture/engineering/development-workflow/
  - tooling/skills/pt-goal-orchestrator/
  - tooling/skills/pt-dev-runtime-handoff/
  - tooling/skills/pt-trae-host-adapter/
  - tooling/skills/pt-cursor-host-adapter/
  - tooling/skills/pt-codex-host-adapter/
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/knowledge/invariants/continuous-plan-run.md
detected: 2026-09-19
---

# Project execution semantics are independent of the agent host

## What must hold

Peers-Touch owns scheduling, product Journeys, runtime admission, verification
classes, formal evidence, and cleanup semantics. TRAE, Cursor, Codex, and
future hosts provide optional tool transports and advisory context only.

Repository-native Make, Harness, WebDriver, Appium, accessibility, browser, and
runtime entrypoints determine behavior and proof strength. Missing host
identity, unsupported events, or Hook failure cannot block ordinary work or
change operation permissions.

Host adapters normalize payloads and render context. They do not create
repository authority, infer the selected worktree, execute fallback, grant
runtime capabilities, or upgrade observations into evidence.

Project Skill projection is scoped to the explicitly selected worktree. Hook
projection is independently optional and uses an absolute interpreter. No
installer operation requires unrelated worktrees to be idle or writes a shared
workspace descriptor.

## Why this is non-negotiable

The same accepted request must mean the same thing in every host. If chat IDs,
Hook availability, or host-specific retention policy decide authority or
completion, source and evidence semantics split across editors.

## How to verify

- `tooling/scripts/review/skill-check.sh` passes.
- `node --test tooling/scripts/local-dev/workflow-kernel.test.mjs
  tooling/scripts/local-dev/workflow-host-adapters.test.mjs
  tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs` passes.
- `python3 -m unittest tooling/scripts/agent-integration-audit-test.py` proves
  selected-root projection, advisory degradation, absolute interpreter use,
  restricted-PATH replay, removal, and non-project configuration preservation.

## Crosswalks

- DWF-D21 defines the host-neutral adapter boundary.
- DWF-D42 removes host and workflow bookkeeping from ordinary admission.

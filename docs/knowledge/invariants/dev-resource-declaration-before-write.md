---
kind: invariant
title: Development resources are declared before mutation
status: active
owns:
  - AGENTS.md
  - tooling/skills/
  - tooling/scripts/local-dev/
  - tooling/make/local-dev.mk
  - docs/global/workflow.md
referenced-by:
  - docs/architecture/engineering/development-workflow/README.md
related:
  - docs/architecture/engineering/development-workflow/design.md
  - docs/architecture/engineering/local-dev/design.md
detected: 2026-09-13
---

# Development resources are declared before mutation

## What must hold

Every non-trivial development task MUST publish and read back its source and
runtime intent in `~/.peers-touch/dev/work.json` before the first repository
write or runtime acquisition. Scope growth MUST update the declaration before
use. An authorized operation that changes Git HEAD MUST publish the new HEAD
before the next mutation slice. Closure or cancellation MUST release the
declaration after runtime cleanup.

A source overlap between different worktrees on different branches is
coordination information, not a lock: it emits `SOURCE_OVERLAP_WARNING` and
allows both declarations. Same-workspace source overlap, same-branch parallel
writes, and exclusive runtime-resource overlap remain hard conflicts.

A declaration is public intent only. It MUST NOT replace worktree binding,
operation authorization, Local Dev leases, process observation, or formal
Acceptance evidence.

## Why this is non-negotiable

Independent worktrees can target the same branch, source paths, generated
outputs, Profile, slot, Station, Fixture, or client storage. Private `.local`
state and process discovery reveal conflicts too late: one agent may already
have edited files or mutated a remote environment.

The machine-wide ledger makes planned ownership visible before mutation.
Separating intent from live lease prevents the opposite error: a stale
declaration cannot be mistaken for a running process or held deploy/reset
authority.

## How to verify

- `make dev-status-all` succeeds and displays every current declaration.
- `make dev-check WORK_ITEM=<id>` succeeds before a mutation slice.
- `node --test tooling/scripts/local-dev/dev-work.test.mjs` passes the
  cross-branch warning, same-workspace/same-branch conflict, runtime conflict,
  expiry, ownership and malformed-ledger cases.
- `rg -n "dev-start|FUNCTIONAL_PASS|dev-release" tooling/skills/pt-dev-workflow/SKILL.md tooling/scripts/review/skill-check.sh`
  finds the enforced workflow markers.
- `find . -name work.json -not -path './node_modules/*'` returns no
  repository-owned development ledger.

## Crosswalks

- Architecture: `docs/architecture/engineering/development-workflow/README.md`.
- Machine allocation: `docs/architecture/engineering/local-dev/README.md`.

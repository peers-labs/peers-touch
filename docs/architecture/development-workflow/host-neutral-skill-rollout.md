# Host-Neutral Skill Rollout

> **Status**: accepted
> **Created**: 2026-09-19 | **Updated**: 2026-09-21
> **Owner**: Platform Team

## Goal

Distribute the canonical project Skill catalog to each supported agent host
without making catalog installation part of a business Plan Run.

## Ownership

`peers-dev-workflow` owns the canonical Skill source and distribution contract.
Each consuming worktree owns its worktree-local host projection and
machine-local observation receipt.

Rollout does not own or mutate:

- Plan, Task, Development Session, declaration, or active-work state;
- business progress, functional results, or Acceptance evidence;
- host process lifecycle or session identity.

This rollout covers canonical repository-owned `tooling/skills/pt-*` only.
Machine-local user Overlays are installed and resolved by
`skill-overlay-control.py`; they never enter the host discovery directories
managed by this rollout.

Catalog drift is observable infrastructure state. It never blocks a business
Plan, releases its declaration, or consumes a Progress Slice.

## Distribution

One verified worktree is one distribution unit. Integrate canonical source by
normal Git semantics, preserving branch-owned changes, then run:

```bash
make skill-rollout-audit ROOT=<worktree-root>
make skills IDE=<trae|cursor|codex>
make skill-rollout-audit IDE=<trae|cursor|codex> ROOT=<worktree-root>
```

The source audit checks canonical Skills, Acceptance registry matchers, legacy
references, and workflow identity. The installer:

- reads only the selected worktree's canonical `tooling/skills/` catalog;
- rejects canonical or host projection symlink escapes;
- retires a real legacy Skill directory outside the discovery root;
- links every canonical `pt-*` Skill into the selected host projection;
- atomically writes one strict `INSTALLED` receipt containing worktree, host,
  branch, HEAD, recursive catalog digest, entry count, and dirty-catalog
  observation.

The host-aware audit verifies the receipt and every projected symlink against
the current worktree. No process restart, session marker, acknowledgement, or
business declaration transition participates in this flow. A host session that
already loaded Skill instructions may continue with that loaded catalog; a
future session naturally discovers the current projection.

## Fleet Audit

```bash
make skill-rollout-audit-all IDE=<trae|cursor|codex>
```

The fleet audit reports source, registry, identity, receipt, and projection
findings per worktree. A failed worktree rollout remains an infrastructure
finding for that worktree and does not become another Plan or progress owner.

## Failure Semantics

- `LEGACY_SKILL_REFERENCE`: migrate the named live source reference.
- `MISSING_CANONICAL_SKILL`: integrate canonical governance source.
- `HOST_PROJECTION_INCOMPLETE`: rerun the installer for that host.
- `SOURCE_CONFLICT`: resolve semantically with normal Git conflict handling.
- `HOST_PROJECTION_ESCAPE`: replace the escaped host projection with a real
  worktree-local directory.
- `CANONICAL_SKILL_SOURCE_INVALID`: restore real worktree-local canonical Skill
  sources.
- `rollout-*-mismatch`: reinstall or repair the observed distribution source;
  do not mutate business workflow state.

## Completion

A worktree's distribution is current when source audit, installation, and
host-aware audit pass, no host discovery root exposes the retired scheduler,
and the installed copy resolves runtime state from the consuming worktree.

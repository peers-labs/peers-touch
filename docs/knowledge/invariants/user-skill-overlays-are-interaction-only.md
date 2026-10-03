---
kind: invariant
title: User Skill overlays are interaction-only
status: active
owns:
  - tooling/skills/pt-ew/
  - tooling/scripts/skill-overlay-control.py
  - tooling/scripts/skill-overlay-control-test.py
  - tooling/make/setup.mk
referenced-by:
  - docs/architecture/development-workflow/decisions.md
related:
  - docs/architecture/development-workflow/design.md
  - docs/architecture/development-workflow/integration.md
detected: 2026-09-21
---

# User Skill overlays are interaction-only

## What must hold

A machine-local user Overlay may change input wording, response language,
response structure, or coaching behavior. It must remain an
interaction policy only. It cannot change task intent, project ownership, Plan scope,
authorization, scheduling, execution, verification, Acceptance, or stop
conditions.

The machine registry is the only enablement source. Runtime resolution reads
the immutable installed copy identified by its content digest, never the
mutable source directory. Installation rejects symlinks, malformed manifests,
name collisions, and modified installed content.

Canonical project agent integration and user Overlay installation are separate:
`make skills` projects repository-owned Skills and supported host
hooks; it never discovers or copies user Overlay sources into host directories.

## Why this is non-negotiable

Personal behavior such as English coaching must not become mandatory project
policy for every contributor. Conversely, a local preference must not gain the
authority to weaken the shared development workflow merely because it is
loaded before routing.

Copying a validated source into a digest-addressed machine store makes runtime
behavior stable after installation and prevents later source edits or symlink
retargeting from changing an active Overlay silently.

## How to verify

- `python3 -m unittest tooling/scripts/skill-overlay-control-test.py` passes.
- `tooling/scripts/review/skill-check.sh` passes.
- `rg -n "Chinese input:|English input:" tooling/skills/pt-ew/SKILL.md`
  returns no personal language policy.
- `make skill-overlay-resolve TARGET=pt-ew` returns only enabled,
  digest-verified installed copies in deterministic order.
- `make skills IDE=<host>` projects only canonical
  `tooling/skills/pt-*` plus `tooling/plugins/pt-ew-plugin`.

## Crosswalks

- DWF-D21 keeps project execution semantics host-neutral.
- DWF-D22 separates canonical distribution from consuming machine state.
- DWF-D25 defines the user Overlay control plane.
- DWF-D33 keeps project host bindings and hooks separate from user Overlay content.

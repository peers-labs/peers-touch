---
kind: invariant
title: Canonical Profile ID solely owns reset policy
status: active
owns:
  - AGENTS.md
  - docs/architecture/local-dev-control-plane/
  - docs/global/local-dev-environment.md
  - tooling/devctl/
  - tooling/scripts/local-dev/
  - tooling/skills/pt-local-dev-env/
referenced-by:
  - docs/architecture/local-dev-control-plane/decisions.md
related:
  - docs/knowledge/invariants/dev-resource-declaration-before-write.md
  - docs/knowledge/invariants/station-profile-only-start.md
detected: 2026-09-21
---

# Canonical Profile ID solely owns reset policy

## What must hold

After the Profile directory name and `PT_DEV_PROFILE` value match exactly,
reset policy is derived only from the canonical ID:

- case-insensitive ID containing `stable` is `stable-protected`;
- every other reviewed ID is `agent-resettable`.

No environment field, registry field, Plan field, Station mode, worktree name,
or legacy cache may override this rule. Non-stable reset does not require human
confirmation. It still requires the current binding capability, a live
declaration for the same Profile and exact exclusive scope, matching source and
tracked-clean remote topology, and the OS-held reset lease.

Failures remain distinct: stable protection is `PROFILE_RESET_PROTECTED`,
missing binding capability is `WORKSPACE_CAPABILITY_MISSING`, and command
scope mismatch is `RESET_SCOPE_MISMATCH`. None may be translated into an
authorization request.

## Why this is non-negotiable

A second policy field previously contradicted the Profile naming contract,
blocked valid reset on development Profiles, and surfaced an internal
capability mismatch as a request for human authorization. That interrupted
continuous Plan execution without adding a real safety boundary.

## How to verify

- `rg -n 'AGENT_CONTROL|agentControl' AGENTS.md docs tooling` returns
  no reset-policy metadata readers.
- Mixed-case `stable` Profile fixtures reject a reset capability.
- Non-stable Profile fixtures accept reset only with matching binding,
  declaration, scope, and lease.
- Machine Dev status projects `resetPolicy`, never a stored control mode.

## Crosswalks

- Architecture: `docs/architecture/local-dev-control-plane/decisions.md#ldcp-d15-canonical-profile-id-reset-protection`.
- Environment contract: `docs/global/local-dev-environment.md`.

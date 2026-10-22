---
kind: pitfall
title: Runtime owners must ignore optional workflow state
status: active
owns:
  - tooling/development/secure_content/schema_activation.py
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/architecture/engineering/development-workflow/decisions.md
  - docs/global/workflow.md
detected: 2026-10-18
---

# Runtime owners must ignore optional workflow state

## Symptom

Secure Content schema activation failed before source freeze with
`SCHEMA_ACTIVATION_BOUNDARY_UNAVAILABLE` because `make dev-check` could not
read a Development declaration. Profile capability, exact source, reset scope,
and runtime lease support were otherwise available.

## Root cause

The schema activation owner treated an optional machine-local Development
declaration as runtime authority. Its source path read the retired
`make dev-check` entrypoint, while its profile path called
`ensure_active_projection` and could mutate the retired declaration ledger.
This recreated the admission chain removed by DWF-D46.

## Mitigation

### What was done in code

- Default schema activation loaders derive deterministic contract metadata from
  the tracked `work-items.yaml` projection and current worktree identity.
- Existing declaration IDs and digests remain source-bound reset metadata; they
  do not grant execution authority.
- Runtime admission remains with the reviewed Profile capability, exact target
  and reset scope, current source identity, and OS-held lease.

### What guards against regression

`test_default_declaration_projection_is_read_only_and_deterministic` rejects
command execution or `ensure_active_projection` calls from the default
projection path.

## How to detect a recurrence

```bash
rg -n 'dev-check|ensure_active_projection|dev-work\.mjs' \
  tooling/development/secure_content/schema_activation.py
python3 -m unittest \
  tooling.development.secure_content.test_schema_activation
```

The grep must return no matches and the focused test suite must pass.

## Crosswalks

- DWF-D46 separates optional task progress from real runtime protection.
- `docs/global/workflow.md` defines current runtime admission inputs.

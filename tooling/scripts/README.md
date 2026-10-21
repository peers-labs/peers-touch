# Tooling Scripts

Scripts implement focused repository capabilities. They are not a parallel
developer command index.

Use:

- `make help` on macOS/Linux;
- `tooling/dev.ps1 help` on Windows;
- [Development Environment](../../docs/development/environment.md) for setup
  and daily runtime commands.

## Current Owners

- `local-dev/machine-dev.mjs`: machine registry, Profile binding, slots, and
  runtime leases.
- `local-dev/workflow-snapshot.mjs`: one-shot read-only development status.
- `local-dev/dev-work.mjs`: optional task recovery state.
- `local-dev/completion-review.mjs`: explicit completion obligations and
  evidence review.
- `plan/planctl.mjs`: explicit Plan inspection and validation.
- `review/`: deterministic review routing and repository rules.
- `acceptance-*.py`: Acceptance planning, execution, validation, reporting,
  and evidence access.
- `agent-integration-*.py`: selected-worktree Skill and optional Hook
  projection.
- `cargo-cache.sh`: shared Rust compiler-cache setup.
- `proto-gen-mobile.sh`: Mobile protobuf generation.

Station and Desktop lifecycle is owned by `tooling/devctl/`; scripts under
`local-dev/` may support modes not yet moved to the cross-platform owner, but
must not reimplement a migrated command.

## Direct Script Use

Call a script directly only when:

- a public Make/devctl command does not own that capability;
- the script README or owning architecture names it as the canonical
  entrypoint;
- required arguments and side effects are understood.

Do not introduce preview wrappers, broad project aliases, or cleanup scripts
that kill processes by name or port without proving ownership.

## Verification

Each script family keeps focused tests beside its implementation or in
`tooling/acceptance/tests/`. A public wrapper change must verify both the owner
and every supported adapter.

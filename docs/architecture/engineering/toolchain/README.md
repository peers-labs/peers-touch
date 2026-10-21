# Developer Toolchain

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

## Scope

This module defines the cross-platform implementation behind the public local
development commands:

- Profile discovery, initialization, selection, and redacted configuration;
- dependency diagnostics;
- local/Compose/remote Station readiness;
- native Desktop lifecycle;
- owned process state and status;
- Make, PowerShell, package, and CI adapters.

It does not define:

- machine-wide worktree allocation and leases, owned by
  [Local Dev](../local-dev/README.md);
- the end-to-end development procedure, owned by
  [Development Workflow](../../../development/workflow.md);
- Acceptance scheduling or evidence;
- product behavior;
- public release installation.

## Public Contract

macOS/Linux uses Make:

```bash
make profile-init local
make profile local
make doctor
make station
make desktop
```

Windows uses `tooling/dev.ps1` with the same `devctl` command model. Wrappers
forward arguments and exit status; they do not own lifecycle policy.

## Design Goals

1. One cross-platform implementation per command.
2. Explicit Profile and machine binding; no ambient fallback.
3. Private, non-overwriting local bootstrap.
4. Owned-process-only stop and restart.
5. Native Desktop as the only Desktop development runtime.
6. Typed, actionable failures and redacted diagnostics.
7. Exact-source readiness for remote Station reuse.

## Documents

- [design.md](./design.md): ownership, command flow, and failure semantics.
- [decisions.md](./decisions.md): current decisions and superseded workflow
  coupling.
- [data-model.md](./data-model.md): Profile and managed-process records.
- [module-layout.md](./module-layout.md): source ownership.
- [integration.md](./integration.md): wrappers, Local Dev, and migration
  boundaries.

The old execution plan under `execution-plans/` is historical delivery input.
It does not override this active module.

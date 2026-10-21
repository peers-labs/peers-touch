# Local Dev Control Plane

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/machine-dev-*`

## Scope

Local Dev coordinates machine-local resources shared by Peers-Touch
worktrees:

- canonical worktree registration;
- Profile selection and local slot allocation;
- Station connect, deploy, and reset capabilities;
- OS-held leases for conflicting operations;
- workspace-scoped runtime roots;
- read-only status for registrations and leases.

It does not own:

- Profile parsing, dependency checks, or product process lifecycle, which
  belong to [Developer Toolchain](../toolchain/README.md);
- work organization, optional task progress, or verification promotion, which
  belong to [Development Workflow](../development-workflow/README.md);
- Station, Relay, Desktop, or Mobile product data;
- reviewed remote topology, which belongs to the sibling `env` repository;
- Acceptance evidence semantics.

## Public Path

Most contributors need only:

```bash
make profile-init local
make profile local
make doctor
make desktop
```

`make profile <name>` is the normal registration and selection boundary.
Advanced allocation and inspection commands remain available through
`make env-*`.

See [Develop Peers-Touch](../../../development/README.md) for the shared human
and Agent guide.

## Sources Of Truth

- machine registration: `~/.peers-touch/dev/registry.json`;
- OS-held leases: `~/.peers-touch/dev/leases/`;
- workspace runtime state:
  `~/.peers-touch/dev/workspaces/<workspaceId>/`;
- remote topology: `env/peers-touch/<profile>/`;
- local topology: `.local/dev/profiles/<profile>.env`;
- local Compose credentials: `.local/dev/compose/<profile>.env`;
- current source identity: Git, read at operation time.

A Profile, task, Plan, Hook, branch name, or open editor does not by itself
own machine resources.

## Core Rules

1. `workspaceId` is derived from the canonical worktree path.
2. Local slots belong to workspaces, not Profiles.
3. Registration is explicit; discovery and observation remain diagnostic.
4. Current Git HEAD is observed, not persisted as durable binding state.
5. Connect, deploy, and reset are separate Station capabilities.
6. Reset policy comes only from the canonical Profile ID: a
   case-insensitive terminal `stable` suffix is protected.
7. Conflicting mutations require an OS-held lease and post-lock revalidation.
8. Runtime and evidence data stay outside the repository and product data
   roots.

## Documents

- [design.md](./design.md): owners, command flow, and safety boundaries.
- [decisions.md](./decisions.md): accepted architecture decisions.
- [data-model.md](./data-model.md): registry, binding, lease, and status
  records.
- [module-layout.md](./module-layout.md): implementation ownership.
- [integration.md](./integration.md): Toolchain, environment, runtime, and
  Acceptance boundaries.

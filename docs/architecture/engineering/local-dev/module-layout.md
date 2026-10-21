# Local Dev Control Plane - Module Layout

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Platform Team

## Core Modules

```text
tooling/scripts/
├── lib/
│   ├── machine-dev-paths.mjs
│   └── machine-dev-paths.test.mjs
└── local-dev/
    ├── machine-dev-registry.mjs
    ├── machine-dev.mjs
    ├── machine-dev-lease.py
    ├── machine-dev.test.mjs
    └── git-workspace.mjs
```

- `machine-dev-paths.mjs`: resolve the machine development root and
  workspace-scoped child paths.
- `machine-dev-registry.mjs`: validate and mutate registrations, resolve
  Profiles, allocate slots, check capabilities, prepare lease requests, and
  render status.
- `machine-dev.mjs`: expose the command-line contract for register, select,
  update, unregister, check, resolve, status, and lease operations.
- `machine-dev-lease.py`: hold POSIX resource locks, inherit the descriptor
  into the child, enforce budgets, and inspect stale metadata.
- `git-workspace.mjs`: resolve canonical Git worktree identity.
- `machine-dev.test.mjs`: cover registry, Profile, capability, source, and
  lease contracts.

## Runtime Adapters

```text
tooling/scripts/local-dev/
├── env.sh
├── config.sh
├── station-dev.sh
├── relay-*.sh
├── mobile-ios-sim.sh
├── desktop-dev.sh
├── status.sh
├── stop.sh
└── restart.sh
```

These scripts consume the machine binding for platform capabilities not fully
owned by `devctl`. They do not create a second registry or Profile selector.

`desktop-dev.sh` remains an internal POSIX adapter; the public Desktop command
is `devctl desktop`. `station-dev.sh` remains the reviewed remote Station
bridge. Relay and Mobile still own their platform-specific runtime details.

## Other Owners In The Same Directory

The directory also contains Development Workflow implementation:

- optional task progress;
- workflow snapshot and doctor;
- completion review and close;
- host adapters.

Those files are governed by
[`development-workflow/`](../development-workflow/README.md), not by Local Dev.
Physical directory placement does not transfer architecture ownership.

## Dependency Direction

```text
Make / PowerShell / devctl / platform adapter
  -> machine-dev CLI or registry library
  -> registry + Profile definition + Git
  -> OS-held lease helper
  -> bounded child operation
```

The lease helper does not parse Profiles. Runtime adapters do not edit the
registry directly. Development Workflow state does not participate in runtime
admission.

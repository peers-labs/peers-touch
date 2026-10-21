# Developer Toolchain - Module Layout

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

## Directory Tree

```text
tooling/devctl/
├── index.mjs
├── errors.mjs
├── profile.mjs
├── doctor.mjs
├── checks.mjs
├── runtime-state.mjs
├── process-adapter.mjs
├── health.mjs
├── station.mjs
├── desktop.mjs
└── test/
    ├── cli.test.mjs
    ├── profile.test.mjs
    ├── checks.test.mjs
    ├── runtime-state.test.mjs
    ├── process-adapter.test.mjs
    ├── station.test.mjs
    ├── desktop.test.mjs
    └── wrapper-policy.test.mjs
```

## Responsibilities

- `index.mjs`: parse the public CLI, route commands, format output, and map
  typed failures to exit codes.
- `errors.mjs`: define stable `DEVCTL_*` failures and serialization.
- `profile.mjs`: parse Profiles, create local Compose bootstrap files, combine
  Profile topology with the machine binding, and redact output.
- `doctor.mjs`: check dependencies required by the selected topology.
- `checks.mjs`: run deterministic cross-platform repository checks.
- `runtime-state.mjs`: persist atomic managed-process records.
- `process-adapter.mjs`: spawn, inspect, and stop owned process trees.
- `health.mjs`: provide bounded HTTP and TCP readiness probes.
- `station.mjs`: own local and Compose Station lifecycle and invoke the
  reviewed remote deployment adapter.
- `desktop.mjs`: prepare dependencies and generated assets, ready Station, and
  run Vite plus native Tauri.
- `test/`: verify command behavior, lifecycle, identity, and wrapper policy.

## Dependency Direction

```text
index
  -> profile -> Local Dev machine binding
  -> doctor -> profile
  -> checks
  -> station -> profile, health, runtime-state, process-adapter
  -> desktop -> profile, station, health, runtime-state, process-adapter

runtime-state <- process-adapter
```

Command modules do not import each other except for Desktop using Station's
ready operation. Lower-level process and health modules never import command
modules.

## External Adapters

- `tooling/scripts/local-dev/machine-dev-registry.mjs` owns worktree binding,
  slot allocation, capabilities, and leases.
- `tooling/scripts/local-dev/station-dev.sh` remains only as the reviewed
  remote Station deployment bridge.
- Relay and Mobile retain their own platform adapters until their command
  families move behind `devctl`.
- `Makefile`, `tooling/make/local-dev.mk`, `tooling/dev.ps1`, package scripts,
  and CI only forward public commands and exit status.

No wrapper parses Profiles, generates credentials, or owns managed-process
lifecycle.

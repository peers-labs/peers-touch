# Developer Toolchain - Module Layout

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-12 | **Updated**: 2026-09-12
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

---

## Directory Tree

```text
tooling/
├── devctl/
│   ├── index.mjs
│   ├── errors.mjs
│   ├── profile.mjs
│   ├── runtime-state.mjs
│   ├── process-adapter.mjs
│   ├── health.mjs
│   ├── doctor.mjs
│   ├── checks.mjs
│   ├── station.mjs
│   ├── desktop.mjs
│   └── test/
│       ├── profile.test.mjs
│       ├── runtime-state.test.mjs
│       ├── process-adapter.test.mjs
│       └── cli.test.mjs
├── dev.ps1
└── scripts/
    └── local-dev/
        └── *.sh
```

## File Responsibilities

| Path | Responsibility |
|---|---|
| `index.mjs` | Parse CLI arguments, route commands, format output, map typed failures to exit codes |
| `errors.mjs` | Stable `DEVCTL_*` errors and serialization |
| `profile.mjs` | Parse, validate, import, activate, and resolve profiles |
| `runtime-state.mjs` | Atomic state records and ownership comparison |
| `process-adapter.mjs` | OS-specific spawn, inspect, terminate-tree, and port observation |
| `health.mjs` | Bounded HTTP and TCP readiness probes |
| `doctor.mjs` | Dependency, SDK, profile, path, and port diagnostics |
| `checks.mjs` | Cross-platform deterministic repository checks |
| `station.mjs` | Local Station build/start/health lifecycle |
| `desktop.mjs` | App/Web composition and isolated Desktop lifecycle |
| `test/` | Unit and CLI integration tests without product mocks |
| `dev.ps1` | Windows argument/exit-code forwarding only |
| `scripts/local-dev/*.sh` | Temporary Unix forwarding adapters until consumer deletion |

## Dependency Direction

```text
index
  -> profile
  -> doctor
  -> checks
  -> station -> health, runtime-state, process-adapter
  -> desktop -> health, runtime-state, process-adapter

runtime-state -> process-adapter
doctor -> profile, process-adapter
```

Lower-level adapters never import command modules. Station and Desktop modules
do not import each other; the command router coordinates dependency order.

## Wrapper Constraint

`Makefile`, `tooling/make/local-dev.mk`, `tooling/dev.ps1`, and package scripts
may contain only command forwarding, help text, and argument defaults. They do
not parse profiles or own process lifecycle.

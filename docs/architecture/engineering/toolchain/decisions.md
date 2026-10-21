# Developer Toolchain Decisions

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Developer Infrastructure

## Decision Index

| ID | Decision | Status |
|---|---|---|
| DTC-D01 | Node owns the cross-platform control plane | accepted |
| DTC-D02 | Wrappers contain no lifecycle policy | accepted |
| DTC-D03 | Machine binding selects Profile topology | accepted |
| DTC-D04 | Managed process identity is re-observed | accepted |
| DTC-D05 | Command-family cutovers are atomic | accepted |
| DTC-D06 | Remote deployment remains a reviewed adapter | accepted |
| DTC-D10 | Local bootstrap creates private Compose credentials | accepted |
| DTC-D11 | Native Desktop is the sole Desktop development mode | accepted |

## DTC-D01: Node Owns The Cross-Platform Control Plane

**Status**: accepted
**Date**: 2026-09-12

### Context

The repository already requires Node through the pnpm workspace and needs one
implementation on macOS, Linux, and Windows.

### Decision

Profile parsing, diagnostics, process lifecycle, and deterministic checks live
in dependency-light ESM under `tooling/devctl/`.

### Rationale

Node is available before product builds and avoids parallel Bash and
PowerShell behavior.

### Alternatives Considered

Bash-only, duplicated PowerShell, and a compiled bootstrap binary were
rejected because each adds a second contract or a build-before-diagnosis loop.

### Consequences

Node is a declared bootstrap dependency with a machine-readable supported
version.

## DTC-D02: Wrappers Contain No Lifecycle Policy

**Status**: accepted
**Date**: 2026-09-12

### Context

Make, PowerShell, package scripts, and CI had multiple opportunities to
reimplement Profile and runtime behavior.

### Decision

Wrappers may translate arguments, provide help, and forward exit status. They
do not parse Profiles, generate credentials, calculate ports, or manage
processes.

### Rationale

One implementation keeps platform behavior and tests aligned.

### Alternatives Considered

Platform-specific wrapper logic was rejected because it creates silent
cross-platform drift.

### Consequences

Behavior changes land in `devctl`; wrapper-policy tests keep adapters thin.

## DTC-D03: Machine Binding Selects Profile Topology

**Status**: accepted
**Date**: 2026-09-12

### Context

Nearby Profile files and worktree-local pointers cannot coordinate multiple
worktrees on one machine.

### Decision

The Local Dev machine binding selects the Profile and slot for each canonical
worktree. `devctl` reads only the Profile named by that binding.

### Rationale

Selection and allocation need one machine owner, while Profile files remain
declarative topology.

### Alternatives Considered

Profile pointers, branch inference, task state, and Profile-owned slots were
rejected as ambiguous or split-brain authority.

### Consequences

Unregistered worktrees fail closed. Explicit Profile selection is the normal
first-use registration path.

## DTC-D04: Managed Process Identity Is Re-Observed

**Status**: accepted
**Date**: 2026-09-12

### Context

PID files and listening ports can outlive or be reused by the process that
created them.

### Decision

Managed records store command, Profile, worktree, start identity, ports, and
identity tokens. Reuse and stop re-observe the live process.

### Rationale

Process ownership must survive PID reuse and reject unrelated listeners.

### Alternatives Considered

PID-only ownership and killing every listener on a configured port were
rejected as unsafe.

### Consequences

Stale records may be removed. Foreign processes require explicit operator
action and are never killed by `devctl`.

## DTC-D05: Command-Family Cutovers Are Atomic

**Status**: accepted
**Date**: 2026-09-12

### Context

Keeping old and new implementations live makes the public command depend on
which wrapper a caller happens to use.

### Decision

When `devctl` takes a command family, all current wrappers, consumers, tests,
and docs move together and the old implementation is deleted.

### Rationale

Atomic cutover preserves one owner and one failure contract.

### Alternatives Considered

Compatibility aliases and indefinite dual-running were rejected.

### Consequences

Rollback uses source control rather than a retained fallback.

## DTC-D06: Remote Deployment Remains A Reviewed Adapter

**Status**: accepted
**Date**: 2026-09-12

### Context

Remote Station deployment already has reviewed SSH and source-transfer
semantics that are not yet cross-platform.

### Decision

Local and Compose Station lifecycle is native `devctl`. Remote Station
deployment calls the reviewed Unix adapter after machine binding and source
checks.

### Rationale

This keeps local development cross-platform without casually rewriting remote
security and deployment behavior.

### Alternatives Considered

Duplicating remote deployment in Node or silently changing targets on Windows
was rejected.

### Consequences

Windows reports remote deployment as unsupported. A future migration requires
its own accepted design and atomic cutover.

## DTC-D10: Local Bootstrap Creates Private Compose Credentials

**Status**: accepted
**Date**: 2026-10-21

### Context

A fresh checkout could create a local Profile but still fail later because its
Compose credential file did not exist.

### Decision

`devctl profile init` atomically creates a topology Profile and a separate
private Compose env with random Station and PostgreSQL secrets.

### Rationale

Bootstrap should fail early, remain non-interactive, and keep credentials out
of topology and source.

### Alternatives Considered

Copying the operator `.env.example`, committing defaults, sharing one repo env,
and generating credentials only during start were rejected.

### Consequences

Initialization never overwrites either file. Lost credentials require explicit
local repair rather than silent rotation.

## DTC-D11: Native Desktop Is The Sole Desktop Development Mode

**Status**: accepted
**Date**: 2026-10-21

### Context

Browser-only Desktop startup bypasses the WebView, Rust, Tauri command, local
storage, and native lifecycle boundaries.

### Decision

`devctl desktop start` always runs managed Vite plus native Tauri and waits for
both dependency readiness and React mount.

### Rationale

Routine debugging must exercise the product boundary being claimed.

### Alternatives Considered

A browser-only Desktop product mode was rejected. Browser tooling remains
valid for actual browser products such as the official site.

### Consequences

Packaging is a separate install or release concern and does not replace the
live native development runtime.

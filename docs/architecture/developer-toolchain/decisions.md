# Developer Toolchain - Design Decisions

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-12 | **Updated**: 2026-09-12
> **Owner**: Developer Infrastructure

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| DTC-D01 | Node is the local-development control plane | accepted |
| DTC-D02 | Wrappers contain no lifecycle policy | accepted |
| DTC-D03 | Profiles remain the configuration source of truth | accepted |
| DTC-D04 | Managed process state is explicit and verified | accepted |
| DTC-D05 | Migration is an atomic consumer cutover | accepted |
| DTC-D06 | Remote deployment is bridged before it is ported | accepted |

---

## DTC-D01: Node Is The Local-Development Control Plane

**Status**: accepted
**Date**: 2026-09-12

### Context

The workspace already requires Node and pnpm on every supported development
platform. Bash is not a native Windows dependency, while PowerShell is not a
native macOS/Linux dependency.

### Decision

Implement local-development orchestration as dependency-light ESM under
`tooling/devctl/`, using Node standard-library APIs by default.

### Rationale

This provides one implementation for filesystem, subprocess, network, hashing,
and JSON behavior without adding another runtime prerequisite.

### Alternatives Considered

- Keep Bash and require Git Bash on Windows: rejected because Bash remains the
  platform contract.
- Implement parallel Bash and PowerShell trees: rejected because behavior and
  fixes would drift.
- Implement in Go or Rust: rejected because build/bootstrap cost is too high
  for the command that diagnoses missing build dependencies.

### Consequences

Positive: one testable control plane and native Windows execution.

Negative: Node becomes a bootstrap prerequisite for local development.
`doctor` must report this clearly when invoked through a wrapper.

---

## DTC-D02: Wrappers Contain No Lifecycle Policy

**Status**: accepted
**Date**: 2026-09-12

### Decision

Make targets, `dev.ps1`, shell wrappers, and package scripts may forward
arguments and exit codes only. They may not resolve profiles, calculate ports,
probe health, or manage processes.

### Alternatives Considered

- Maintain feature-equivalent native scripts: rejected because parity cannot be
  mechanically guaranteed.

### Consequences

Existing shell helpers are deleted or reduced to forwarding adapters after
their consumers migrate.

---

## DTC-D03: Profiles Remain The Configuration Source Of Truth

**Status**: accepted
**Date**: 2026-09-12

### Decision

Retain the current canonical env-repository and worktree-active profile model.
`devctl` parses and validates this model; it does not create a parallel JSON,
registry, or Windows-only profile format.

### Alternatives Considered

- Replace env files with JSON: rejected because it would force an unrelated
  environment-repository migration.
- Infer a default profile: rejected because it can silently target the wrong
  Station.

### Consequences

The env parser supports the repository's declarative assignment subset and
rejects shell evaluation. Profiles that depend on executable shell expressions
must be repaired rather than evaluated.

---

## DTC-D04: Managed Process State Is Explicit And Verified

**Status**: accepted
**Date**: 2026-09-12

### Decision

Persist structured runtime records under
`.local/dev/state/<profile>/<service>.json`. Before reuse or termination,
compare the record with the live PID, command identity, ports, profile, and
worktree.

### Alternatives Considered

- PID files only: rejected because PIDs are reusable.
- Kill all listeners on configured ports: rejected because the process may be
  unrelated and user-owned.

### Consequences

Unknown port occupants fail closed and require explicit operator action.
Platform adapters must expose equivalent identity checks.

---

## DTC-D05: Migration Is An Atomic Consumer Cutover

**Status**: accepted
**Date**: 2026-09-12

### Decision

Move each command family and all of its wrappers/tests to `devctl` in one
closure. Do not maintain two independent implementations for the same command.

### Alternatives Considered

- Leave old shell behavior as fallback indefinitely: rejected because it
  creates two truth owners.

### Consequences

Temporary forwarding wrappers are allowed only while named external consumers
still depend on their paths. Their removal condition is tracked in the
execution plan.

---

## DTC-D06: Remote Deployment Is Bridged Before It Is Ported

**Status**: accepted
**Date**: 2026-09-12

### Decision

The first delivery supports native local Station and Desktop lifecycle.
Remote Station/Relay operations remain owned by current deployment tooling and
are invoked only through an explicit compatibility adapter on platforms where
that tooling is available. Windows returns `DEVCTL_UNSUPPORTED_MODE` rather
than silently changing deployment semantics.

### Alternatives Considered

- Port remote deployment in the first closure: rejected because SSH source
  transfer, remote service management, and credential behavior are a separate
  risk boundary.

### Consequences

The first closure does not claim native Windows remote deployment support.
A later plan may port that owner behind the same `devctl` contract.

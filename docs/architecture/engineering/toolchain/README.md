# Developer Toolchain

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-12 | **Updated**: 2026-09-12
> **Owner**: Developer Infrastructure
> **Module**: `tooling/devctl/`

---

## 1. Document Scope

This module defines:

- the cross-platform control plane for local Peers-Touch development;
- ownership of profile resolution, dependency checks, process lifecycle, and
  runtime status;
- the relationship between `devctl`, package scripts, Make, PowerShell, and
  legacy shell entrypoints;
- failure and evidence contracts for Windows, macOS, and Linux development.

This module does not define:

- Station or Desktop product behavior;
- Acceptance Runtime Cell provisioning;
- remote deployment topology or credentials;
- release packaging and signing.

## 2. Implementation

The daily profile, diagnostic, check, Station, and Desktop lifecycle is
implemented once in `tooling/devctl/` as dependency-light Node ESM. Windows
uses `tooling/dev.ps1`; Make and package scripts forward to the same command
contract. Legacy shell workflows remain only for explicitly out-of-scope
Relay, Mobile iOS, remote deployment, and log-tail operations.

## 3. Design Goals

1. Provide one platform-neutral command contract for local development.
2. Preserve profile isolation and fail closed on ambiguous configuration.
3. Make process ownership and cleanup explicit and inspectable.
4. Keep Make and PowerShell as thin adapters, not competing implementations.
5. Prove Windows behavior in CI and preserve equivalent Unix behavior.
6. Remove legacy shell ownership after all consumers migrate.

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | Architecture, boundaries, contracts, and quality gates |
| [decisions.md](./decisions.md) | Accepted architecture decisions |
| [data-model.md](./data-model.md) | Profile and runtime-state schemas |
| [module-layout.md](./module-layout.md) | Target source layout and ownership |
| [integration.md](./integration.md) | Existing-system mapping and migration |
| [execution plan](./execution-plans/20260912-cross-platform-devctl.md) | Ordered delivery closures and acceptance scenarios |

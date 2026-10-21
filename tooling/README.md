# Tooling

Repository-owned development, verification, build, release, and agent
automation lives here.

This directory is not the developer entrypoint. Start from
[Develop Peers-Touch](../docs/development/README.md) and discover public
commands with `make help` or `tooling/dev.ps1 help`.

## Owners

- `devctl/`: cross-platform Profile, diagnostics, Station, and Desktop
  lifecycle.
- `make/`: thin Make adapters and command help.
- `scripts/local-dev/`: machine registry, leases, optional task state, and
  remaining platform-specific runtime helpers.
- `acceptance/`: formal product evidence framework.
- `distribution/`: Station and Desktop release assets and lifecycle.
- `docker/`: shared development and Acceptance container definitions.
- `scripts/review/`: deterministic review routing and checks.
- `skills/`: canonical project Agent Skills.

## Rules

- Public command semantics have one owner.
- Make, PowerShell, package scripts, and CI forward to that owner.
- Component scripts do not become alternative project-wide workflows.
- Runtime artifacts and evidence stay outside the source tree.
- Component READMEs describe internals; shared setup and workflow remain under
  `docs/development/`.

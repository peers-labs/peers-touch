# Develop Peers-Touch

> **Status**: active
> **Audience**: human developers and development agents
> **Owner**: Developer Infrastructure

This is the shared entry point for working on Peers-Touch. It tells you where
to start and which source owns the next answer. It does not duplicate product,
architecture, platform, or coding-standard content.

## Start Here

New checkout:

1. [Prepare the environment](./environment.md).
2. Start the native product with `make desktop`.
3. Pick the [platform guide](./platforms/README.md) for the code you will
   change.
4. Follow the [development workflow](./workflow.md).
5. Use the [verification guide](./verification.md) before claiming a result.

Developers using an AI coding agent follow the same path. Agent-specific tools
and host integration are explained in [automation](./automation.md); they do
not define a second development process.

## Understand The System

Read only as deep as the task requires:

- [Project identity](../global/project-identity.md): what Peers-Touch is.
- [System architecture](../global/architecture.md): Client, Model, and Station
  ownership.
- [Domain model](../global/domain-model.md): proto-first shared contracts.
- [Architecture index](../architecture/README.md): domain, platform, shared,
  and engineering architecture.
- [Public API contracts](../api/README.md): external integration surface.

## Rules And Experience

- [Coding guides](../global/coding-guide/): implementation rules by platform.
- [Coding standards](../global/coding-standards.md): repository-wide coding
  rules.
- [Operational knowledge](../knowledge/README.md): active invariants,
  pitfalls, and playbooks selected by source path.
- [Glossary](../knowledge/glossary.md): project-specific terms.
- [Historical context](../context/README.md): superseded designs and evolution;
  never a current source of truth.

## Quality And Release Internals

- [Quality architecture](../architecture/engineering/quality/README.md):
  review and evidence internals.
- [Release and distribution](../architecture/engineering/release-distribution/README.md):
  publishing internals.

## Dev Infrastructure Internals

Read these only when changing the development system itself:

- [Local Dev](../architecture/engineering/local-dev/README.md): machine
  registry, Profile binding, slots, and runtime leases.
- [Developer Toolchain](../architecture/engineering/toolchain/README.md):
  `devctl` commands and process lifecycle.
- [Development Workflow](../architecture/engineering/development-workflow/README.md):
  workflow tooling and optional recovery state.
- [Acceptance](../architecture/engineering/acceptance/README.md): formal
  product evidence architecture.

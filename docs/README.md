# Peers-Touch Documentation

> **Status**: active
> **Owner**: Architecture Team

This directory contains current product, architecture, development, platform,
contract, and operational knowledge. Start from the question you need answered.

## Develop The Project

Use [Develop Peers-Touch](./development/README.md) for:

- environment setup and first run;
- the shared human-and-agent workflow;
- platform reading order and commands;
- verification and delivery;
- development automation.

## Understand The Product

- [Project identity](./global/project-identity.md): product purpose and runtime
  units.
- [System architecture](./global/architecture.md): Client, Model, and Station
  ownership.
- [Domain model](./global/domain-model.md): proto-first shared contracts.
- [Architecture index](./architecture/README.md): domain, platform, shared, and
  engineering modules.

## Find Current Architecture

Engineering control planes:

- [Architecture governance](./architecture/engineering/architecture-governance/README.md)
- [Development workflow](./architecture/engineering/development-workflow/README.md)
- [Developer toolchain](./architecture/engineering/toolchain/README.md)
- [Local Dev control plane](./architecture/engineering/local-dev/README.md)
- [API ownership](./architecture/engineering/api-governance/README.md)
- [Release distribution](./architecture/engineering/release-distribution/README.md)

Product and runtime modules:

- [Agent](./architecture/domains/agent/README.md)
- [Bot](./architecture/domains/bot/README.md)
- [OAuth Login Broker](./architecture/domains/identity/oauth-login-broker/README.md)
- [Station Access](./architecture/platform/station/access/README.md)
- [Node Connectivity](./architecture/platform/runtime/node-connectivity/README.md)
- [Chat Storage Governance](./architecture/domains/chat/storage-governance/README.md)
- [Cross-Station Social](./architecture/domains/social/cross-station/README.md)
- [Mobile Social Parity](./architecture/platform/client/mobile/social-parity/README.md)
- [Secure Content](./architecture/shared/security/secure-content/README.md)

## Build A Platform

Use [Platform Development](./development/platforms/README.md) to choose a
product surface, its reading order, runtime entrypoint, and focused checks.
Platform documents refine accepted architecture; they do not redefine
cross-runtime ownership.

## Use Or Define Contracts

- [Public APIs](./api/README.md): external HTTP and integration contracts.
- [Domain models](./global/domain-model.md): shared protobuf semantics.
- [Coding guides](./global/coding-guide/): implementation contracts.
- [Architecture document standard](./global/architecture-document-standard.md):
  architecture module shape and governance.

## Apply Project Experience

- [Operational knowledge](./knowledge/README.md): path-owned invariants,
  pitfalls, and playbooks.
- [Glossary](./knowledge/glossary.md): project-specific terms.
- [Historical context](./context/README.md): superseded decisions and
  investigations.
- [Research](./research/): external references that do not define current
  project truth.

## Source Hierarchy

Use constraint direction to resolve conflicts:

1. Architecture defines allowed relationships and ownership.
2. Platform documents define one platform's implementation.
3. Coding guides define source-level conventions.
4. Operational knowledge adds path-specific invariants and learned pitfalls.
5. Historical, research, IDE, and execution-plan material does not override
   current sources.

The machine-readable architecture registry is
[`architecture-modules.json`](./architecture/engineering/architecture-governance/architecture-modules.json).
Category indexes and module READMEs provide the human navigation layer.

## Writing Rules

- Keep landing pages short and question-oriented.
- Link to the owner instead of copying its details.
- Separate current behavior, target design, and history.
- Put endpoint inventories, schemas, error codes, and decision history in their
  owning documents, not global indexes.
- Update the nearest README when adding or moving a current source.

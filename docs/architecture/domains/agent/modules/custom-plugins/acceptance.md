# Rejected Custom HTTP Plugin - Retirement

> **Status**: superseded
> **Version**: v2.0
> **Created**: 2026-08-14 | **Updated**: 2026-09-18
> **Owner**: Peers-Touch Agent Team

The independent Custom HTTP Plugin product is rejected and removed. It has no
accepted successor mapping and must not be imported into Tool, MCP, or
Connector authority.

Current retirement and proof sources:

- `docs/architecture/domains/agent/execution-plans/20260917-modern-chat-agent-v2-alignment/tasks/MCA-A03.md`
- `docs/architecture/domains/agent/modern-chat-agent/product-state-model.md`
- `tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml`

`AS-16-CUSTOM-PLUGIN-RETIREMENT` requires the page, command, navigation entry,
credential-bearing local storage, direct network execution, proto/generated
contracts, Station CRUD routes, persistence owner, rows, and table to be
absent. Only non-secret migration tombstones and test fixtures may retain the
retired storage identifiers.

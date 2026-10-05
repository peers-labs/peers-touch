# Identity Domain

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-05
> **Owner**: Identity and Access

---

## 1. Document Scope

Identity is a Station-owned business domain consumed by all clients and
business modules. It owns stable Actor identity, discovery projections,
presence, and OAuth identity handoff. Station access admission remains a
platform boundary under `platform/station/access`.

## 2. Architecture Map

| Concern | Entry |
|---|---|
| Stable Actor identity | [unified-actor-system.md](./unified-actor-system.md) |
| Federated discovery | [federation-catalog.md](./federation-catalog.md) |
| Presence lifecycle | [presence-supervisor.md](./presence-supervisor.md) |
| Durable OAuth login handoff | [oauth-login-broker/](./oauth-login-broker/README.md) |

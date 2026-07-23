# Provider Station Ownership

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-23 | **Updated**: 2026-07-23
> **Owner**: Agent Team
> **Domain**: Agent / Provider / Credential / Turn Execution
> **Module**: `apps/station/app/subserver/agent/`, `apps/desktop/src-tauri/src/application/{provider,agent_turn}/`, `apps/desktop/src/store/{agent,provider}.ts`

---

## 1. Document Scope

This module defines:
- Ownership of provider config, credentials, models, and turn execution (Station vs Client)
- Per-actor isolation boundaries
- Version-gated mutation contract
- CLI adapter execution model
- SSE as sole AI response channel

This module does NOT define:
- Agent conversation / memory architecture (see `docs/architecture/agent/`)
- Desktop UI component design (see `docs/client/desktop/`)
- Station framework internals (see `docs/station/`)
- Coding conventions (see `docs/global/coding-guide/`)

## 2. Background

Prior to this design, Desktop Rust owned provider configuration, credential storage, model enumeration, and (for CLI-type providers) local execution. Station's agent subserver acted as a second executor only for "direct" HTTP providers.

2026-07-W30 decision: **Station is the sole authority and executor of all AI providers.** Desktop/Mobile are config editors and SSE consumers. This eliminates split execution paths, enables per-actor credential isolation, and allows Mobile to share the same AI capability without duplicating execution logic.

## 3. Design Goals

1. Station executes all provider types (HTTP, CLI, embedded) for all actors.
2. Desktop/Mobile edit provider/model/credential config and submit to Station.
3. Per-actor isolation — each actor's providers and credentials are independent.
4. Version-gated config mutations prevent split-brain across devices.
5. Desktop/Mobile cache config locally for UI speed; Station is the source of truth.
6. SSE streaming is the sole AI response delivery mechanism to clients.

## 4. Non-Goals

- Station admin UI for provider config (Desktop/Mobile are the only editing surfaces).
- Offline AI execution on Desktop/Mobile.
- Provider marketplace or discovery (out of scope for this architecture).
- Credential sharing across actors.

## 5. Upstream Constraints

| Source | Constraint applied |
|--------|-------------------|
| `docs/global/architecture.md` §3.3 | Station owns shared business truth. Clients orchestrate and present. |
| `docs/global/architecture.md` §3.1 | Client layer maintains local ephemeral state and local runtime orchestration. Client is NOT the shared business source of truth. |
| `docs/global/first-principles.md` L0.1 | Proto-first domain modeling for cross-platform data contracts. |
| `docs/global/first-principles.md` L0.4 | No secrets in logs. Validate auth/ownership for all handlers. |
| `docs/architecture/agent/README.md` §5 | "Station 承担全部后端能力, Tauri 承担通信桥接, Desktop 承担用户交互和成长可视化." |

## 6. Navigation

| Document | Purpose |
|----------|---------|
| [design.md](./design.md) | Architecture design: principles, system diagram, contracts, component relationships, forbidden relationships |
| [decisions.md](./decisions.md) | Design decisions (ADR-lite format) |
| [data-model.md](./data-model.md) | Provider/credential/model data contracts, versioning schema, SSE event protocol |
| [integration.md](./integration.md) | Migration from Desktop-local provider to Station-owned: impact surface, deletion list, compatibility |
| [execution-plans/20260723-phase1-station-api.md](./execution-plans/20260723-phase1-station-api.md) | Phase 1 execution plan: Station API + per-actor + version gate |

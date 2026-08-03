# Modern Chat Agent

> **Status**: design-complete
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-07-30
> **Owner**: Peers-Touch Agent Team
> **Module**: `model/domain/agent/`, `apps/station/app/subserver/agent/`, `apps/desktop/`, `apps/mobile/`

---

## 1. Document Scope

This module defines the architecture of a dependable model-powered
single-Agent chat runtime across Model, Station, and platform clients.

It defines:

- The product promise, target users, benchmark dispositions, journeys, visible
  states, and receiver-perspective acceptance.
- The product boundary between a chat UI and an Agent runtime.
- Station-owned Agent, conversation, turn, context, provider, and trace truth.
- Direct model adapters versus stateful external Agent runtimes.
- Context, memory, skill, knowledge, attachment, and tool semantics.
- Turn admission, ordering, cancellation, replay, retry, and branching.
- Runtime budgets, model capability negotiation, feedback, and evaluation.
- Platform-neutral client capabilities for Desktop and future Mobile.
- Architecture quality gates required before execution planning.

It does not define:

- Multi-Agent planning and collaboration, governed by
  [`agent-canvas-orchestration.md`](../agent-canvas-orchestration.md).
- Agent memory internals, governed by
  [`agent-memory-architecture.md`](../agent-memory-architecture.md).
- Provider configuration CRUD details, governed by
  [`provider-station-ownership/`](../provider-station-ownership/).
- Desktop component styling or page layout.
- Voice/video capabilities or Mobile UI delivery.
- Implementation phases or task sequencing.

## 2. Problem

The repository has most Agent capability foundations, but the current
execution plan does not yet define the full runtime contract needed to claim a
dependable Agent. In particular, context construction, stateful external
runtimes, event recovery, runtime budgets, capability degradation, and
evaluation are not closed as one architecture.

LobeHub and AgentBox are evidence sources for capability shape and failure
semantics. They do not override Peers-Touch ownership boundaries.

## 3. Design Goal

A Modern Chat Agent is:

> A persistent Station-owned Agent that conducts coherent multi-turn
> conversations, uses attributable memory and skills, executes
> policy-controlled tools, recovers safely, exposes capability degradation,
> and produces replayable evidence of what happened and why.

## 4. Documents

| Document | Purpose |
|---|---|
| [product-definition.md](./product-definition.md) | Target users, product promise, capability profile, trust promises, and non-goals |
| [benchmark-disposition.md](./benchmark-disposition.md) | Evidence-backed LobeHub/AgentBox adopt, adapt, reject, and defer decisions |
| [experience-contract.md](./experience-contract.md) | End-to-end journeys, surface anatomy, recovery, and platform adaptation |
| [product-state-model.md](./product-state-model.md) | User-observable readiness, topic, composer, turn, tool, resource, and recovery states |
| [acceptance-matrix.md](./acceptance-matrix.md) | Product-to-architecture-to-prototype-to-production evidence traceability |
| [design.md](./design.md) | Target topology, ownership, lifecycle, contracts, forbidden relationships, and quality gates |
| [decisions.md](./decisions.md) | Proposed architecture decisions and rejected alternatives |
| [data-model.md](./data-model.md) | Canonical entities, state machines, event ordering, persistence, and proto roots |
| [module-layout.md](./module-layout.md) | Target ownership packages, registries, dependency direction, and forbidden imports |
| [integration.md](./integration.md) | Current-code mapping, product acceptance contract, canonical completion locator, and planning handoff |
| [prototype/README.md](./prototype/README.md) | Peers-owned executable product prototype, review states, and confirmation blockers |
| [Execution plan](../execution-plans/20260730-modern-chat-agent-v1.md) | **ACTIVE PLAN** — MODERN_CHAT_AGENT_V1, Phase 0-4 dependency-ordered workstreams |
| [Old blocked plan](../execution-plans/20260730-modern-chat-agent.md) | Superseded — drafted before PRODUCT/DESIGN completion, retained for historical reference only |

## 5. Review Status

Product approved (P1-P4 PASSED). Architecture decisions MCA-D01–D13 approved.
Design quality gate D2 PASSED. All MCA-C01–C10 closure cells mapped to ownership,
contracts, deletion obligations, and evidence requirements. Ready for owner
DESIGN review (D3). After D3 passes, execution plan will be rewritten per
integration.md §14 handoff query.

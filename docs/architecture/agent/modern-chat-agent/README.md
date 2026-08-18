# Modern Chat Agent

> **Status**: product-accepted / design-accepted / planning
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-08-17
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
- Home Command Center, unified Tool/MCP/Connector capability governance, and
  user-visible Evaluation Lab.
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

The repository has most Agent capability foundations, but the accepted
MCA-D01–D13 architecture predates V2 Home, unified capability binding and
operation lifecycles, Connector-to-tool invocation, and durable Evaluation
run/result ownership. Those V2 contracts must be reconciled before a formal
execution DAG can authorize implementation.

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
| [product-state-model.md](./product-state-model.md) | User-observable readiness, Home, topic, composer, turn, capability, Evaluation, and recovery states |
| [acceptance-matrix.md](./acceptance-matrix.md) | Product-to-architecture-to-prototype-to-production evidence traceability |
| [product-review-prompt.md](./product-review-prompt.md) | Independent V2 PRODUCT review instructions, evidence boundaries, and verdict contract |
| [design-review-prompt.md](./design-review-prompt.md) | Independent V2 DESIGN review instructions and acceptance contract |
| [lobehub-v2-reference-analysis.md](./lobehub-v2-reference-analysis.md) | Source-backed Home, capability-plane, and Evaluation reference analysis |
| [design.md](./design.md) | Target topology, ownership, lifecycle, contracts, forbidden relationships, and quality gates |
| [decisions.md](./decisions.md) | Proposed architecture decisions and rejected alternatives |
| [data-model.md](./data-model.md) | Canonical entities, state machines, event ordering, persistence, and proto roots |
| [module-layout.md](./module-layout.md) | Target ownership packages, registries, dependency direction, and forbidden imports |
| [integration.md](./integration.md) | Current-code mapping, product acceptance contract, canonical completion locator, and planning handoff |
| [prototype/README.md](./prototype/README.md) | Peers-owned executable product prototype, review states, and confirmation blockers |
| [Execution plan](../execution-plans/20260817-modern-chat-agent-v2.md) | **ACTIVE PRODUCT PLAN** — V2 scope reconciliation, prototype review, architecture handoff, and later execution phases |
| [Formal V2 execution plan](../execution-plans/20260817-modern-chat-agent-v2-execution.md) | Dependency DAG, W0/F1-F4/W1-W9 closures, atomic cutovers, Gates, and acceptance scenarios |
| [Reviewed V2 runtime matrix](../execution-plans/20260817-modern-chat-agent-v2-runtime-matrix.yaml) | Immutable Gate/platform/runtime/cell/locale/order/sample expansion, Mobile semantic-contract cells, and frozen P12/CLI non-advertisement |
| [Prior V1 plan](../execution-plans/20260730-modern-chat-agent-v1.md) | Historical first-loop plan; does not own current V2 status |
| [Old blocked plan](../execution-plans/20260730-modern-chat-agent.md) | Superseded — drafted before PRODUCT/DESIGN completion, retained for historical reference only |

## 5. Review Status

V2 owner scope decisions are closed: Home and Evaluation are required; image
generation is unsupported; video and server-side audio generation are deferred;
Desktop is the complete delivery target, Browser preserves Station-backed
outcomes, and Mobile UI is deferred while contract compatibility remains
required.

PRODUCT is accepted. Independent DESIGN review passed on 2026-08-17 after
D14-D18, C11-C15, A15-A20, concurrency fencing, deletion/retention, and Gate
oracles were reconciled. The nineteenth independent PLAN review returned
`PLAN_READY_FOR_EXECUTION`; current stage is the Owner EXECUTE approval gate.
Production implementation remains 0/14 and all V2 Gates remain `UNPROVEN`.

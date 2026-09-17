# Modern Chat Agent

> **Status**: product-accepted / design-accepted / execution-active
> **Version**: v1.1
> **Created**: 2026-07-30 | **Updated**: 2026-09-17
> **Owner**: Peers-Touch Agent Team
> **Module**: `model/domain/agent/`, `packages/agent-catalog/`,
> `apps/station/app/subserver/agent/`, `apps/desktop/`, `apps/mobile/`

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
| [MCA-D20A catalog distribution amendment](./proposals/20260917-mca-d20a-catalog-distribution.md) | **ACCEPTED** — replace the unreachable private-GitHub default sync with Station distribution of the same publisher-signed envelope |
| [MCA-D20A review record](./proposals/20260917-mca-d20a-catalog-distribution-review.md) | Approval criteria and Owner verdict for the catalog distribution amendment |
| [prototype/README.md](./prototype/README.md) | Peers-owned executable product prototype, review states, and confirmation blockers |
| [Current V2 Alignment Plan Package](../execution-plans/20260917-modern-chat-agent-v2-alignment/plan.md) | **CURRENT EXECUTION SOURCE** — V2-J01..V2-J06, X3 trusted catalog, and aggregate Acceptance as bounded vertical Task Slices |
| [Product plan](../execution-plans/20260817-modern-chat-agent-v2.md) | Active product and scope source; execution tracking moved to the current Plan Package |
| [Legacy formal V2 execution plan](../execution-plans/20260817-modern-chat-agent-v2-execution.md) | Superseded execution source retained for the detailed historical DAG, cutovers, Gates, and scenarios |
| [Reviewed V2 runtime matrix](../execution-plans/20260817-modern-chat-agent-v2-runtime-matrix.yaml) | Immutable Gate/platform/runtime/cell/locale/order/sample expansion, Mobile semantic-contract cells, and frozen P12/CLI non-advertisement |
| [Prior V1 plan](../execution-plans/20260730-modern-chat-agent-v1.md) | Historical first-loop plan; does not own current V2 status |
| [Old blocked plan](../execution-plans/20260730-modern-chat-agent.md) | Superseded — drafted before PRODUCT/DESIGN completion, retained for historical reference only |

The Owner accepted the MCA-D20 publisher-signed package catalog and
authority-readback contract on 2026-09-17 as the X3/P4-3 closure boundary.
Execution then proved that the configured private GitHub repository cannot
serve the default source anonymously. The Owner accepted MCA-D20A on
2026-09-17, making Station the byte-distribution transport without changing
the publisher trust root.
The Owner accepted the MCA-D19 result-identity, ToolBatch barrier, and durable
continuation core on 2026-08-21. The G1-C entry audit then exposed missing
receipt-recovery, replay-policy, lease-lifecycle, deadline, and opaque-resource
contracts. The Owner accepted `MCA-D19A` on 2026-08-22. G1-A then verified that
actor JWT does not authenticate `X-Device-ID`; proposed `MCA-D19B` adds
device-possession proof for all capability commands. The Owner accepted D19B
into the main Goal G1 task on 2026-08-22. G1-A and G1-B are complete. The G1-C
completion audit then exposed an undefined post-restart execution-authority
handoff for externally idempotent PREPARED work; the Owner accepted
`MCA-D19C` on 2026-08-22. XR-4 later exposed that filtered provider lists and
TurnTrace cannot prove conditional-runtime absence or zero local side effects;
the Owner accepted production-owned advertisement/readiness and monotonic
activity snapshots as `MCA-D19D` on 2026-08-25. The tracked execution source is
`../execution-plans/20260817-modern-chat-agent-v2-execution.md`.

## 5. Review Status

V2 owner scope decisions are closed: Home and Evaluation are required; image
and video generation are unsupported in Peers-Touch, and any future video
capability belongs to a separate project; server-side audio generation is
deferred. Desktop is the complete delivery target, Browser preserves
Station-backed outcomes, and Mobile UI is deferred while contract compatibility
remains required.

PRODUCT is accepted. Independent DESIGN review passed on 2026-08-17 after
D14-D18, C11-C15, A15-A20, concurrency fencing, deletion/retention, and Gate
oracles were reconciled. Execution of F4 exposed an undefined Station-to-client
execution-ingress protocol. The Owner accepted `MCA-D19` on 2026-08-21.
The subsequent G1-C audit reopened G1-A/B formal closure and produced
`MCA-D19A`, accepted on 2026-08-22. The G1-A auth audit then produced
`MCA-D19B`, accepted into the main task on 2026-08-22. MCA-D19C was then
accepted to require Station-authorized higher-fence restart takeover. MCA-D19D
was accepted on 2026-08-25 to make P12/CLI non-advertisement falsifiable through
Station/Desktop production snapshots and isolated Browser evidence. G1-A,
G1-B, G1-C, G1-D, G1-E, and G1-F are complete; Acceptance D-12 and the
G1-XR matrix/schema/validator cutover are complete, while real adapters are active.
No production capability currently advertises external idempotency, and all V2
product Gates remain `UNPROVEN`.

# Modern Chat Agent V2 — Independent DESIGN Review Prompt

> **Status**: ready-for-review
> **Created**: 2026-08-17
> **Owner**: Peers-Touch Agent Team

---

You are the independent architecture reviewer for Modern Chat Agent V2.

Review DESIGN only. Do not implement, create execution tasks, commit, push, or
weaken accepted product requirements.

## Accepted Product Inputs

- `product-definition.md`
- `benchmark-disposition.md`
- `experience-contract.md`
- `product-state-model.md`
- `acceptance-matrix.md`
- `prototype/README.md`
- PRODUCT verdict: `PRODUCT_READY_FOR_ARCHITECTURE`

## Architecture Sources

- `lobehub-v2-reference-analysis.md`
- `design.md`
- `decisions.md` (especially D14-D18)
- `data-model.md`
- `module-layout.md`
- `integration.md` (especially A15-A20 and C11-C15)

## Review Dimensions

1. Evidence ledger distinguishes source facts, inference, and proposals.
2. Home projection ownership prevents page/store durable truth.
3. Capability manifest/binding/readiness is a single source across
   Tool/MCP/Connector/Skill/Knowledge.
4. MCP operation preserves Station lifecycle authority and client-local
   process/secret ownership.
5. Connector OAuth, resources, manifests, Agent binding, and ToolCall are
   separate and versioned.
6. Evaluation owns benchmark/dataset/case/run/attempt/result/metrics in Station
   and executes through canonical TurnService.
7. Contracts cover ordering, idempotency, cancellation, timeout, disconnect,
   retry, replay, stale version, actor/device isolation, cleanup, and typed
   errors.
8. Allowed/forbidden relationships and deletion obligations are explicit.
9. Data model, module layout, integration closures, decisions, and quality
   Gates are internally consistent.
10. Architecture does not contain implementation phase sequencing or weaken
    receiver-perspective Product Gates.

## Blocking Conditions

Return `changes required` if:

- Any V2 capability lacks an architecture closure C11-C15.
- A durable state can be owned by Desktop Web/localStorage.
- A local MCP process or OAuth token becomes Station payload.
- Station terminal state can be inferred from client UI/process exit.
- Evaluation bypasses canonical admission/tool/trace contracts.
- Replay or duplicate delivery can cause a second decision/execution/result.
- A target deletion lacks an explicit replacement owner.
- A proposed decision is treated as accepted without review.

## Required Output

1. Verdict: `passed`, `conditionally passed`, or `changes required`.
2. Blocking findings with exact file/line references.
3. Non-blocking findings.
4. Missing failure semantics, forbidden relationships, or evidence Gates.
5. Explicit result: `DESIGN_READY_FOR_PLAN` or
   `DESIGN_AMENDMENT_REQUIRED`.

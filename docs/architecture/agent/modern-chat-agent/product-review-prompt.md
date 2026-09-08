# Modern Chat Agent V2 — Independent PRODUCT Review Prompt

> **Status**: ready-for-review
> **Created**: 2026-08-17
> **Owner**: Peers-Touch Agent Team
> **Review stage**: PRODUCT only

---

You are the independent PRODUCT reviewer for Modern Chat Agent V2.

Do not redesign architecture, produce an execution plan, or review code style.
Judge whether the product contract is coherent, complete, evidence-backed, and
ready to constrain architecture.

## Sources To Review

Read all of:

- `docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2.md`
- `docs/architecture/agent/lobehub-parity-mindmap.source.md`
- `docs/architecture/agent/modern-chat-agent/product-definition.md`
- `docs/architecture/agent/modern-chat-agent/benchmark-disposition.md`
- `docs/architecture/agent/modern-chat-agent/experience-contract.md`
- `docs/architecture/agent/modern-chat-agent/product-state-model.md`
- `docs/architecture/agent/modern-chat-agent/acceptance-matrix.md`
- `docs/architecture/agent/modern-chat-agent/prototype/README.md`
- `packages/prototypes/desktop/features/modern-chat-agent/src/V2ProductReview.tsx`

Inspect the local LobeHub and Peers sources cited by the benchmark ledger when
a disposition or feasibility claim is uncertain.

## Accepted Owner Scope

- Home Command Center is required and includes pinned/favorite Agents, Station
  recents, Agent/model readiness, Chat/Task composer, Brief/Needs You, Task
  status, Connector/Tool readiness, and actionable failure/recovery.
- Unified Tool/MCP/Connector capability governance and real invocation are
  required.
- User-visible Evaluation Lab is required.
- Image generation is unsupported.
- Video generation is unsupported in Peers-Touch, like image generation; any
  future video capability belongs to a separate project. Server-side audio
  generation remains deferred.
- Desktop is the complete delivery target.
- Browser preserves the same Station-backed business outcomes with explicit
  device-capability degradation.
- Mobile contract compatibility is required; Mobile UI delivery is deferred.
- Promotion, commercial recommendation, Community, hosted subscriptions, and
  independent Custom HTTP Plugin product are outside the claim.

Do not reopen these decisions unless the documents contradict them or they
make the product impossible to accept.

## Evidence Boundaries

- The brain map is the capability completion source of truth.
- `MCA-V2-*` capability, brain-map node, journey, phase, and required Gate must
  form one traceable chain.
- V2 production Gates are currently `UNPROVEN`.
- Prototype L1/L2/L3 evidence proves intended interaction only.
- Historical I1/C6/C7/R9/P2 reports prove their source-bound ancestor snapshot;
  they do not prove current V2 Home, capability invocation, or Evaluation.
- C7 lifecycle evidence does not prove real Connector invocation.
- Debugger post-fix evidence is clean, but cleanup remains open.
- Static checks, screenshots, and aggregate PASS must not substitute for
  receiver behavior plus Station readback.

## Review Questions

1. Are target users, jobs, promise, exclusions, and first/recurring value
   coherent?
2. Are LobeHub observations evidence-backed and assigned an explicit
   adopt/adapt/reject/defer disposition?
3. Do Home, capability governance, MCP, Connector, tool recovery, and
   Evaluation close complete user journeys?
4. Do visible states cover loading, empty, stale, approval, cancellation,
   partial success, failure, retry, disconnect, restart, and terminal success?
5. Are Desktop, Browser, and Mobile claims explicit and honest?
6. Does the review-ready prototype resolve the material Home/Tool/Evaluation UI
   questions without pretending to prove backend behavior?
7. Does every required capability have tangible actions, repository-backed
   foundations, an exact missing closure, and executable production evidence?
8. Is every `MCA-V2-*` capability mapped bidirectionally through brain-map
   nodes, journeys, phases, and required production Gates?
9. Does the acceptance matrix require receiver-perspective Native behavior,
   Station authority/readback, isolation, recovery, and resource cleanup?
10. Are any architecture topology, storage, protocol, or implementation-order
    decisions disguised as PRODUCT requirements?
11. Are any unsupported/deferred benchmark capabilities accidentally counted
    as required completion debt?
12. Are any existing proofs overclaimed beyond their source snapshot or actual
    behavior?

## Blocking Conditions

Return `changes required` if any of these is true:

- Required scope or platform claim remains ambiguous.
- A required journey lacks failure or recovery semantics.
- A capability is absent from the brain-map-to-Gate trace.
- Prototype status is treated as production proof.
- Current V2 production readiness is claimed `PROVEN`.
- Evidence relies on aggregate status without source-bound assertions.
- Home becomes a marketing dashboard instead of a work entry.
- Desktop-local capability is advertised as universally portable.
- Evaluation run/result truth remains conceptually client-owned.

## Required Response

Return:

1. Verdict: `passed`, `conditionally passed`, or `changes required`.
2. Blocking findings ordered by severity with exact file/section references.
3. Non-blocking findings.
4. Missing or overclaimed evidence.
5. Capability/brain-map/journey/phase/Gate trace defects.
6. Prototype review findings for desktop, narrow, light/dark, and
   failure/recovery states.
7. Explicit statement whether the result is
   `PRODUCT_READY_FOR_ARCHITECTURE` or `PRODUCT_DESIGN_INCOMPLETE`.

Do not approve DESIGN, PLAN, EXECUTE, commit, push, or PR actions.

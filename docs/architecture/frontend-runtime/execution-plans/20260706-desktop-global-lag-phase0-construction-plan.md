# Desktop Global Lag Phase 0 Construction Plan

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-06 | **Updated**: 2026-07-06
> **Owner**: Client Platform Team
> **Parent Plan**: `docs/architecture/frontend-runtime/execution-plans/20260706-desktop-global-lag-framework-plan.md`
> **BOM / Spec / Trace**: `docs/architecture/frontend-runtime/execution-plans/20260706-desktop-global-lag-bom-spec-trace.md`
> **Evidence**: `docs/context/implementation-reports/20260706-desktop-global-lag-diagnosis.md`

---

## 1. Purpose

This document is the Phase 0 construction plan for Desktop global lag governance.

It turns the Phase 0 architecture blueprint into implementation-ready work packages. It does not implement telemetry, samplers, runners, or performance fixes.

## 2. How To Read

Read in this order:

1. Requirement: user goal for Desktop global lag governance.
2. BOM / Spec / Trace: required materials, contracts, work packages, gates, and evidence chain.
3. This construction plan: task order, dependencies, gate checklist, and skill governance.
4. Phase 0 ledger: execution state for current work.
5. Completion audit: proven, partial, and unproven scope.

No implementation PR may skip from the framework plan directly to code. Every task must name:

- BOM ID(s)
- Spec ID(s)
- Work package
- Gate
- Evidence artifact

## 3. Scope

### In Scope

- Convert Phase 0 into P0a/P0b/P0c construction packages.
- Define task boundaries, dependencies, gates, and evidence.
- Define the skill governance chain that prevents plan drift and patch-style work.
- Define the next code landing start point.
- Mark all unproven claims explicitly.

### Out Of Scope

- No Shell/PageHost/SectionHost/Store/Overlay behavior changes.
- No component-level performance optimization.
- No Station endpoint, DB table, gateway command, Desktop sampler, or runner implementation.
- No claim that Desktop lag is fixed.
- No claim that Tauri click-frame attribution is complete.

## 4. Dependency Stack

```text
Requirement
  -> BOM
  -> Spec / Contract
  -> Construction package
  -> Task
  -> Gate
  -> Evidence
  -> Completion audit
```

Dependency order:

1. `P0a` creates the Station-managed telemetry loop.
2. `P0b` adds interaction correlation and event families on top of the shared loop.
3. `P0c` runs the matrix and fail-closed gate after events can be collected.

`P0b` can prepare code design while `P0a` is being implemented, but it cannot claim gate-ready evidence until `P0a` ingestion/query and dev mirror exist.

## 5. Work Package P0a: Station-Managed Telemetry Minimum Loop

Goal: prove product telemetry goes to Station, not source-tree tooling.

### Task Breakdown

| Task | Scope | BOM | Spec | Dependencies | Deliverable | Gate | Evidence |
|---|---|---|---|---|---|---|---|
| `P0a-1` Event envelope contract | Define shared frontend telemetry envelope and allowed event families | `BOM-CON-01`, `BOM-CAP-01` | `SPEC-TEL-01`, `SPEC-TEL-02`, `SPEC-PRIV-01` | none | Contract section or model/proto task spec for event envelope | Schema fields and privacy constraints reviewed | Contract doc with `schemaVersion`, `kind`, `source`, `module`, `runtime`, optional `interactionId` |
| `P0a-2` Desktop bounded queue | Define Desktop local buffer, retry, drop count, dev inspection, and no private module buffer rule | `BOM-RUN-02` | `SPEC-DESK-01` | `P0a-1` | Desktop queue implementation task spec | Queue cannot block UI interactions; bounded memory policy exists | Unit/integration evidence for enqueue, flush, drop-count, and dev inspection |
| `P0a-3` Gateway upload command | Define one authenticated Desktop Gateway upload path | `BOM-RUN-03` | `SPEC-GW-01` | `P0a-1`, `P0a-2` | Gateway command task spec | Upload returns structured accept/reject/failure | Gateway command test and failure-mode evidence |
| `P0a-4` Station ingest and validation | Define Station ingestion API and validation rules | `BOM-RUN-04`, `BOM-CON-05` | `SPEC-STA-01`, `SPEC-STA-02`, `SPEC-PRIV-01` | `P0a-1`, `P0a-3` | Station ingest task spec | Invalid schema/private payload rejected before persistence | Station API test for accept/reject cases |
| `P0a-5` Station raw and rollup store | Define raw event persistence and aggregate rollup | `BOM-CON-03`, `BOM-CON-04` | `SPEC-DB-01`, `SPEC-DB-02` | `P0a-4` | DB migration and query task spec | Raw event and p50/p95 rollup queryable | DB migration evidence and query result |
| `P0a-6` Station query API and dev mirror | Define trace lookup API and local/CI mirror generated from same envelope | `BOM-CAP-05`, `BOM-RUN-05` | `SPEC-STA-03`, `SPEC-MIRROR-01` | `P0a-5` | Query API plus mirror writer task spec | Query by `interactionId`; mirror cannot become product sink | Station query evidence plus local JSON/Markdown mirror |

### Exit Gate

`P0a` is complete only when one synthetic Desktop frontend telemetry event can be emitted, uploaded through Gateway, persisted by Station, queried by `interactionId`, and mirrored locally with the same envelope.

## 6. Work Package P0b: Interaction Correlation And Samplers

Goal: prove lag attribution can be measured across React, store, overlay, invoke, and main-thread event families.

### Task Breakdown

| Task | Scope | BOM | Spec | Dependencies | Deliverable | Gate | Evidence |
|---|---|---|---|---|---|---|---|
| `P0b-1` Stable E2E anchors | Primary nav, secondary tab, section item, context menu trigger anchors | `BOM-SMP-01` | `SPEC-ANCHOR-01` | none | Anchor task spec and selector inventory | Browser and Tauri/WebView target the same object identity | DOM/automation evidence that anchors exist without CSS hash/class dependency |
| `P0b-2` Interaction lifecycle | Create and propagate `interactionId` from pointer/contextmenu start to visible/settled/end | `BOM-CON-02`, `BOM-CAP-03` | `SPEC-INT-01` | `P0a-1` | Interaction coordinator task spec | Missing `interactionId` makes sample `diagnostic incomplete` | Event stream with one primary nav interaction window |
| `P0b-3` React commit sampler | Ready shell, PageFrame, SectionHost, OverlayHost commit events | `BOM-SMP-02` | `SPEC-SMP-REACT-01` | `P0b-2` | React Profiler integration task spec | Commit count, total duration, max commit, owner present | Primary nav and secondary tab commit evidence |
| `P0b-4` Store fanout sampler | Shared store factory/middleware and owner tagging | `BOM-SMP-03` | `SPEC-SMP-STORE-01` | `P0b-2` | Store sampler task spec | Store, changed keys, fanout/listener metadata or `unknown` attribution | Store update events in one interaction window |
| `P0b-5` Overlay latency sampler | `contextmenu.intent` to `overlay.visible` measurement | `BOM-SMP-04` | `SPEC-SMP-OVERLAY-01` | `P0b-1`, `P0b-2` | Overlay sampler task spec | Missing visible event fails context-menu gate | Right-click event pair and latency evidence |
| `P0b-6` Invoke/API sampler | Browser gateway and Tauri invoke unified event schema | `BOM-SMP-05` | `SPEC-SMP-INVOKE-01` | `P0b-2` | Invoke wrapper task spec | Click-frame invoke is violation unless budgeted; startup cohort separated | Invoke events classified as click-frame or startup/runtime amplification |
| `P0b-7` Longtask/layout/paint sampler | Main-thread event capture and exception format | `BOM-SMP-06` | `SPEC-SMP-MAIN-01` | `P0b-2` | Main-thread sampler task spec | `>50ms` long task fails unless registered exception exists | Longtask evidence linked to `interactionId` |

### Exit Gate

`P0b` is complete only when primary nav, secondary tab, and right-click samples each include `interactionId` and the required event families, or explicitly mark the missing family as `diagnostic incomplete`.

## 7. Work Package P0c: Baseline Runner And Fail-Closed Gate

Goal: prove every runtime matrix cell reports explicit state and red-line result.

### Task Breakdown

| Task | Scope | BOM | Spec | Dependencies | Deliverable | Gate | Evidence |
|---|---|---|---|---|---|---|---|
| `P0c-1` Startup entrypoint contract | `make station`, `make desktop-web`, `make desktop`, performance gate readiness semantics | `BOM-RUN-01`, `BOM-CAP-04` | `SPEC-RUN-01` | none | Entrypoint contract task spec | No fail-open ready state | Preflight evidence for Station/Gateway/Renderer/Ready Shell |
| `P0c-2` Preflight state model | Fail-closed preflight for Station, Gateway, Renderer harness, login, Ready Shell | `BOM-GATE-01` | `SPEC-GATE-01` | `P0c-1` | Preflight runner task spec | Failed preflight blocks sample emission | `baseline preflight failure` artifact |
| `P0c-3` Matrix runner | Browser/gateway, Tauri WebView, prod preview, offline fixture cells | `BOM-GATE-02`, `BOM-CAP-04` | `SPEC-GATE-02`, `SPEC-RUN-01` | `P0a`, `P0b`, `P0c-2` | Matrix runner task spec | Every cell reports explicit state | Matrix JSON with `sampled`, `blocked`, `baseline preflight failure`, or `diagnostic incomplete` |
| `P0c-4` Red-line policy | Budgets for primary nav, secondary tab, context menu, longtask, hidden render, click-frame invoke | `BOM-GATE-03` | `SPEC-GATE-03` | `P0c-3` | Gate policy task spec | Over-budget or missing required event fails gate | Red-line report with raw evidence links |
| `P0c-5` Report writer | Station rollup plus dev JSON/Markdown mirror | `BOM-RUN-05`, `BOM-CAP-05` | `SPEC-MIRROR-01`, `SPEC-STA-03` | `P0a`, `P0b`, `P0c-4` | Report writer task spec | Reports include raw events, p50/p95, blocked reason, red-line state | Station query key and dev mirror artifacts |

### Exit Gate

`P0c` is complete only when every matrix cell is represented and no sample can be emitted before preflight passes.

## 8. Gate / Evidence Checklist

| Gate | Required evidence | Missing evidence result |
|---|---|---|
| BOM binding | Task references at least one BOM ID | Task cannot start implementation review |
| Spec binding | Task references at least one Spec ID | Task cannot start implementation review |
| Station-managed sink | Station ingestion/query/storage exists for product telemetry | `Local-only`, not product-ready |
| Dev mirror parity | Local JSON/Markdown uses same envelope as Station | CI evidence incomplete |
| Interaction correlation | Required events share `interactionId` | `diagnostic incomplete` |
| React commit | Commit count/duration/owner present | `diagnostic incomplete` |
| Store fanout | Store, changed keys, fanout/owner present or explicit `unknown` | `diagnostic incomplete` |
| Overlay visible | `contextmenu.intent` and `overlay.visible` pair present | Context-menu gate fail |
| Invoke classification | Click-frame vs startup/runtime invoke separated | Tauri/bridge attribution unproven |
| Preflight | Station/Gateway/Renderer/Login/Ready Shell pass | `baseline preflight failure` |
| Runtime matrix | Browser, Tauri, prod, offline cells explicit | Matrix incomplete |
| Red-line budget | p50/p95/raw events and pass/fail state present | Gate fail |
| Completion audit | Proven/unproven scope listed | Cannot claim Phase 0 complete |

## 9. Skill Integration Plan

| Skill | Decision | Role after this pilot | Required iteration |
|---|---|---|---|
| `pt-plan-and-document` | Keep | Chooses doc layer, naming, metadata, and README discoverability | Add reference that large execution plans should link BOM/Spec/Trace when present |
| `pt-architecture-design-methodology` | Keep | Produces architecture contracts and ownership boundaries | Consume BOM as upstream input before final Spec |
| `pt-architecture-execution-methodology` | Keep and narrow | Turns Spec into construction packages and dependency order | Require BOM ID, Spec ID, Gate, Evidence per task |
| `pt-execution-plan-guardian` | Iterate | Runtime execution guard against plan drift and patching | Enforce task binding to BOM/Spec/Plan/Gate/Evidence before code edits |
| `pt-completion-auditor` | Iterate | Final readiness audit | Add audit dimension for Requirement -> BOM -> Spec -> Plan -> Gate -> Evidence closure |
| `pt-quality-check` | Keep | Evidence aggregation before PR review | Add optional report fields for BOM/Spec/Gate coverage when range touches planned work |
| `pt-skill-author` | Keep | Governs skill changes | Use before creating `pt-requirement-bom` or modifying existing skills |
| `pt-read-before-edit` | Keep | Per-file operational knowledge guard | No change for this pilot |

### `pt-requirement-bom` Decision

Recommendation: create `pt-requirement-bom` after this pilot is accepted, not inside this construction-plan goal.

Reason:

- Existing skills cover design, execution, documentation, execution guard, and audit.
- No existing skill owns the upstream conversion from user requirement to BOM materials.
- Creating it before this pilot is reviewed would risk encoding an unvalidated method.

Proposed ownership:

- Input: user requirement, diagnosis evidence, existing architecture docs.
- Output: capability/runtime/contract/data/sampler/gate/governance BOM with owner and evidence columns.
- Non-goal: not an execution plan, not code implementation, not final architecture Spec.

## 10. Anti-Patch Proof

An implementation is a framework-governance task only if all checks pass:

1. It references BOM ID(s), Spec ID(s), work package, gate, and evidence.
2. It lands in the framework contract layer named by the plan.
3. It adds or tightens a reusable gate, sampler, policy, or Station-managed evidence path.
4. It avoids component-only fixes unless they are explicitly downstream of a framework contract.
5. It marks measurement-only work as measurement-only.
6. It keeps unproven runtime cells visible instead of hiding them.

If any check fails, the work is classified as `PATCH-RISK` and cannot claim Desktop global lag governance progress.

## 11. Next Code Landing Start Point

The first code implementation should start with `P0a-1` and `P0a-2`:

1. Define the shared telemetry envelope and privacy constraints.
2. Add the Desktop bounded queue and dev inspection path.
3. Keep upload/query/storage behind the Station/Gateway contracts until their task specs are reviewed.

This is not "边做边设计" because `P0a-1` and `P0a-2` are downstream of known BOM IDs, Spec IDs, gates, and evidence targets. If any contract field changes during implementation, the change must update the BOM/Spec/Trace document before code can claim readiness.

## 12. Completion Audit

| Goal item | Status | Evidence | Remaining gap |
|---|---|---|---|
| Solidify BOM/Spec/Trace pilot | DONE | BOM inventory, Spec inventory, traceability matrix, anti-patch rules | Needs reviewer acceptance before becoming active method |
| Convert framework plan to construction-readable flow | DONE | Framework plan links BOM/Spec/Trace and forbids direct plan-to-code jump | Detailed implementation remains future work |
| Define P0a/P0b/P0c boundaries | DONE | Sections 5-7 define task order, dependencies, gates, evidence | Task specs still need implementation owners |
| Skill integration plan | DONE | Section 9 | Actual skill file edits are NOT STARTED |
| Executable task checklist | DONE | Sections 5-8 and Phase 0 ledger | Code tasks remain pending |
| Prove lag fixed | OUT OF SCOPE | No business performance code changed | Requires future P0a/P0b/P0c implementation and Phase 1-5 fixes |
| Prove method fully works in code | UNPROVEN | Construction chain exists in docs | Requires first implementation PR to pass BOM/Spec/Gate/Evidence audit |

Strongest supported claim: the governance method is now concrete enough to constrain the next implementation PR. It is not yet proven as an implemented engineering system.

# Desktop Global Lag Governance BOM / Spec / Trace Pilot

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-06 | **Updated**: 2026-07-06
> **Owner**: Client Platform Team
> **Parent Plan**: `docs/architecture/platform/client/frontend-runtime/execution-plans/20260706-desktop-global-lag-framework-plan.md`
> **Construction Plan**: `docs/architecture/platform/client/frontend-runtime/execution-plans/20260706-desktop-global-lag-phase0-construction-plan.md`
> **Evidence**: `docs/context/implementation-reports/20260706-desktop-global-lag-diagnosis.md`

---

## 1. Purpose

This pilot validates whether a `BOM -> Spec -> Plan -> Gate -> Evidence -> Trace` method can turn the Desktop global lag governance work from a broad architecture plan into implementation-ready work packages.

It is not an implementation plan replacement. It is the upstream inventory and traceability layer that the execution plan must consume.

## 2. Method Boundary

This document answers:

- What capability, runtime, contract, data, observability, gate, and governance materials are required.
- Which contracts must exist before implementation starts.
- Which evidence proves each material is real.
- How each plan task traces back to a material and a contract.
- Where current evidence is still missing or only diagnostic.

This document does not answer:

- Exact implementation code.
- Final API field names after proto/model review.
- PR ordering beyond the P0a/P0b/P0c work package split.
- Component-level performance fixes.

## 3. Requirement BOM

### 3.1 Capability Materials

| BOM ID | Material | Owner | Required contract | Evidence |
|---|---|---|---|---|
| `BOM-CAP-01` | Desktop interaction telemetry as a product capability | Station + Desktop | `SPEC-TEL-01`, `SPEC-STA-01` | Station can query events by `interactionId` |
| `BOM-CAP-02` | Performance red-line gate for primary nav, secondary tab, context menu | Client Platform | `SPEC-GATE-01` | Gate blocks missing or over-budget samples |
| `BOM-CAP-03` | Root-cause attribution for click frame, hidden render, React commit, store fanout, overlay, invoke | Client Platform | `SPEC-TEL-02`, `SPEC-INT-01` | Report links every event to one interaction window |
| `BOM-CAP-04` | Runtime matrix coverage: browser/gateway, Tauri WebView, prod, offline fixture | Client Platform + Runtime | `SPEC-RUN-01` | Every matrix cell has `sampled`, `blocked`, `baseline preflight failure`, or `diagnostic incomplete` |
| `BOM-CAP-05` | Long-term module health and support trace lookup | Station | `SPEC-STA-03`, `SPEC-PRIV-01` | Station query supports module/runtime/actor/session/time filters |

### 3.2 Runtime Materials

| BOM ID | Material | Owner | Required contract | Evidence |
|---|---|---|---|---|
| `BOM-RUN-01` | Stable startup entrypoints | Runtime Platform | `SPEC-RUN-01` | `make desktop`, `make desktop-web`, `make station`, and performance gate report clean preflight state |
| `BOM-RUN-02` | Desktop local bounded telemetry queue | Desktop | `SPEC-DESK-01` | Events buffered, batched, retried, and mirrored without private module buffers |
| `BOM-RUN-03` | Gateway upload command | Desktop Gateway | `SPEC-GW-01` | Desktop can batch-upload telemetry to Station through one command path |
| `BOM-RUN-04` | Station ingestion endpoint | Station | `SPEC-STA-01` | Station accepts telemetry batches and returns structured accept/reject result |
| `BOM-RUN-05` | Dev/CI mirror | Tooling | `SPEC-MIRROR-01` | Local JSON/Markdown mirror uses the same event envelope as Station |

### 3.3 Contract And Data Materials

| BOM ID | Material | Owner | Required contract | Evidence |
|---|---|---|---|---|
| `BOM-CON-01` | Shared frontend telemetry event envelope | Model + Station + Desktop | `SPEC-TEL-01` | All samplers emit the same `schemaVersion/kind/source/module/runtime/interactionId` envelope |
| `BOM-CON-02` | Interaction lifecycle | Desktop | `SPEC-INT-01` | Pointer/contextmenu start, route/overlay visible, commit, store, invoke, longtask events share one `interactionId` |
| `BOM-CON-03` | Raw telemetry event store | Station | `SPEC-DB-01` | Raw events are queryable without relying on source checkout files |
| `BOM-CON-04` | Rollup store or view | Station | `SPEC-DB-02` | p50/p95 by module/runtime/interaction kind can be queried |
| `BOM-CON-05` | Privacy and retention policy | Station + Security | `SPEC-PRIV-01` | Payload rejects secrets, message bodies, tokens, private keys, and undeclared PII |

### 3.4 Sampler Materials

| BOM ID | Material | Owner | Required contract | Evidence |
|---|---|---|---|---|
| `BOM-SMP-01` | Stable E2E anchors | Desktop | `SPEC-ANCHOR-01` | Browser and Tauri/WebView samplers target the same interaction object |
| `BOM-SMP-02` | React commit sampler | Desktop | `SPEC-SMP-REACT-01` | Report lists commit count, total duration, max commit, owner |
| `BOM-SMP-03` | Store fanout sampler | Desktop | `SPEC-SMP-STORE-01` | Report lists store, changed keys, listener/fanout, active/hidden owner |
| `BOM-SMP-04` | Overlay latency sampler | Desktop | `SPEC-SMP-OVERLAY-01` | `contextmenu.intent -> overlay.visible` latency is measured or fails closed |
| `BOM-SMP-05` | Invoke/API sampler | Desktop + Gateway | `SPEC-SMP-INVOKE-01` | Click-frame invoke and startup/runtime amplification are separated |
| `BOM-SMP-06` | Long task and layout/paint sampler | Desktop | `SPEC-SMP-MAIN-01` | `>50ms` long task fails gate unless exception is registered |

### 3.5 Gate And Governance Materials

| BOM ID | Material | Owner | Required contract | Evidence |
|---|---|---|---|---|
| `BOM-GATE-01` | Fail-closed preflight | Client Platform | `SPEC-GATE-01` | Missing Station/Gateway/Renderer/Ready Shell blocks performance sample emission |
| `BOM-GATE-02` | Baseline runner | Tooling + Runtime | `SPEC-GATE-02` | Matrix cells are explicit and cannot be silently skipped |
| `BOM-GATE-03` | Red-line policy | Client Platform | `SPEC-GATE-03` | Primary nav, secondary tab, context menu, longtask budgets are enforced |
| `BOM-GOV-01` | Page/section lifetime registry | Client Platform | `SPEC-GOV-LIFE-01` | Hidden render requires owner, budget, and exception |
| `BOM-GOV-02` | Store subscription/projection policy | Client Platform | `SPEC-GOV-STORE-01` | Bare wide subscription and render-time shared projection can be detected |
| `BOM-GOV-03` | Overlay lane policy | Client Platform | `SPEC-GOV-OVERLAY-01` | Context menu visibility is not blocked behind page/list recomputation |
| `BOM-GOV-04` | Bridge click-frame policy | Runtime Platform | `SPEC-GOV-BRIDGE-01` | Click-frame Tauri/browser invoke requires explicit budget and trace |

## 4. Spec / Contract Inventory

This section defines the minimum contracts required before code implementation. Exact protocol syntax can be refined in model/proto and Station platform docs.

| Spec ID | Contract | Status | Blocking BOM |
|---|---|---|---|
| `SPEC-TEL-01` | Shared telemetry envelope with version, kind, source, module, runtime, actor/session/device scope, optional `interactionId`, payload, timestamps | proposed | `BOM-CON-01`, `BOM-CAP-01` |
| `SPEC-TEL-02` | Event families: interaction, route, surface, hidden render, React commit, store update, overlay, invoke, longtask, layout/paint, preflight | proposed | `BOM-CAP-03` |
| `SPEC-INT-01` | Interaction lifecycle: input start creates `interactionId`; all synchronous and async child events inherit it until visible/settled/end | proposed | `BOM-CON-02`, `BOM-SMP-*` |
| `SPEC-DESK-01` | Desktop bounded buffer, batching, retry, backpressure, dev mirror, and no private module telemetry buffer | proposed | `BOM-RUN-02` |
| `SPEC-GW-01` | Single Desktop Gateway telemetry upload command with auth/session context and structured failure | proposed | `BOM-RUN-03` |
| `SPEC-STA-01` | Station ingestion API for frontend telemetry batches | proposed | `BOM-RUN-04` |
| `SPEC-STA-02` | Station validation and rejection contract for schema, privacy, actor/session, and size limits | proposed | `BOM-CON-05` |
| `SPEC-STA-03` | Station query API by actor/session/device/module/runtime/interaction/time window | proposed | `BOM-CAP-05` |
| `SPEC-MIRROR-01` | Dev/CI mirror format that reuses the Station event envelope without becoming the product telemetry sink | proposed | `BOM-RUN-05` |
| `SPEC-DB-01` | Raw telemetry event persistence schema | proposed | `BOM-CON-03` |
| `SPEC-DB-02` | Rollup schema or materialized view for p50/p95 and gate trend | proposed | `BOM-CON-04` |
| `SPEC-PRIV-01` | Privacy policy: ids, counts, durations, state names, redacted error class only; no secrets/message body/token/private key | proposed | `BOM-CON-05` |
| `SPEC-ANCHOR-01` | Stable selector semantics for primary nav, secondary tab, section, overlay trigger | proposed | `BOM-SMP-01` |
| `SPEC-SMP-REACT-01` | React commit event schema and dev/prod sampling mode | proposed | `BOM-SMP-02` |
| `SPEC-SMP-STORE-01` | Store update/fanout event schema and store ownership tags | proposed | `BOM-SMP-03` |
| `SPEC-SMP-OVERLAY-01` | Overlay intent/visible event pair and visible detection rule | proposed | `BOM-SMP-04` |
| `SPEC-SMP-INVOKE-01` | Browser gateway and Tauri invoke event schema with click-frame vs startup cohort separation | proposed | `BOM-SMP-05` |
| `SPEC-SMP-MAIN-01` | Longtask/layout/paint event schema and exception format | proposed | `BOM-SMP-06` |
| `SPEC-RUN-01` | Startup entrypoint contract for `make station`, `make desktop-web`, `make desktop`, and performance gate | proposed | `BOM-RUN-01`, `BOM-CAP-04` |
| `SPEC-GATE-01` | Preflight gate: Station, Gateway, Renderer harness, login, Ready Shell | proposed | `BOM-GATE-01` |
| `SPEC-GATE-02` | Baseline matrix status model | proposed | `BOM-GATE-02` |
| `SPEC-GATE-03` | Red-line budgets and fail/exception semantics | proposed | `BOM-GATE-03` |
| `SPEC-GOV-LIFE-01` | Page/section lifetime registry and hidden render exception contract | required after Phase 0 | `BOM-GOV-01` |
| `SPEC-GOV-STORE-01` | Store subscription/projection policy and lint/gate contract | required after Phase 0 | `BOM-GOV-02` |
| `SPEC-GOV-OVERLAY-01` | OverlayHost priority lane and exception contract | required after Phase 0 | `BOM-GOV-03` |
| `SPEC-GOV-BRIDGE-01` | Click-frame bridge invocation budget and trace contract | required after Phase 0 | `BOM-GOV-04` |

## 5. Work Package Split

The existing Phase 0 is too large for a first implementation slice. Split it into three construction packages.

### P0a: Station-Managed Telemetry Minimum Loop

Goal: prove product telemetry goes to Station, not to source-tree tooling.

Consumes:

- `BOM-CAP-01`
- `BOM-RUN-02` to `BOM-RUN-05`
- `BOM-CON-01` to `BOM-CON-05`

Required specs:

- `SPEC-TEL-01`
- `SPEC-DESK-01`
- `SPEC-GW-01`
- `SPEC-STA-01`
- `SPEC-STA-02`
- `SPEC-STA-03`
- `SPEC-DB-01`
- `SPEC-DB-02`
- `SPEC-PRIV-01`
- `SPEC-MIRROR-01`

Acceptance:

- Desktop can emit and buffer one synthetic telemetry event.
- Gateway can upload a batch to Station.
- Station stores raw event data.
- Station query can read by `interactionId`.
- Dev/CI mirror writes the same event envelope locally.
- User-facing analysis does not depend on source checkout paths.

### P0b: Interaction Correlation And Samplers

Goal: prove lag attribution can be measured across React/store/overlay/invoke/main-thread event families.

Consumes:

- `BOM-CAP-03`
- `BOM-SMP-01` to `BOM-SMP-06`

Required specs:

- `SPEC-INT-01`
- `SPEC-ANCHOR-01`
- `SPEC-SMP-REACT-01`
- `SPEC-SMP-STORE-01`
- `SPEC-SMP-OVERLAY-01`
- `SPEC-SMP-INVOKE-01`
- `SPEC-SMP-MAIN-01`

Acceptance:

- One primary nav interaction includes `interactionId`, visible event, React commit, store update, invoke, and longtask window.
- One secondary tab interaction includes section visible and hidden-section evidence.
- One right-click interaction includes `contextmenu.intent` and `overlay.visible`.
- Missing event family marks the sample `diagnostic incomplete`.

### P0c: Baseline Runner And Fail-Closed Gate

Goal: prove every runtime matrix cell reports explicit state and red-line result.

Consumes:

- `BOM-CAP-02`
- `BOM-CAP-04`
- `BOM-GATE-01` to `BOM-GATE-03`

Required specs:

- `SPEC-RUN-01`
- `SPEC-GATE-01`
- `SPEC-GATE-02`
- `SPEC-GATE-03`

Acceptance:

- Browser/gateway, Tauri WebView, prod, and offline fixture cells are explicit.
- Preflight failures cannot emit tab/overlay performance conclusions.
- True Tauri click blocked state records exact blocker instead of disappearing.
- Reports include p50/p95, raw evidence links, blocked reason, and red-line pass/fail.

## 6. Traceability Matrix

| Defect | Current confidence | BOM | Spec | Work package | Gate evidence required |
|---|---|---|---|---|---|
| `DL-FD-01` Shell context broadcast | model-backed, needs commit/fanout proof | `BOM-CAP-03`, `BOM-SMP-02`, `BOM-SMP-03` | `SPEC-INT-01`, `SPEC-SMP-REACT-01`, `SPEC-SMP-STORE-01` | P0b, then Phase 1 | Route interaction shows shell/provider commit and store fanout before fix; reduced after fix |
| `DL-FD-02` PageHost hidden tree | evidence-backed browser samples, needs commit proof | `BOM-SMP-02`, `BOM-GOV-01` | `SPEC-SMP-REACT-01`, `SPEC-GOV-LIFE-01` | P0b, then Phase 2 | Hidden page commit/render during active switch is recorded and later forbidden/budgeted |
| `DL-FD-03` Mixed lifetime semantics | static evidence, needs matrix proof | `BOM-GOV-01`, `BOM-GATE-02` | `SPEC-GOV-LIFE-01`, `SPEC-GATE-02` | P0c, then Phase 2 | All primary surfaces declare lifetime policy and matrix confirms behavior |
| `DL-FD-04` SectionHost hidden sections | evidence-backed secondary samples, needs commit proof | `BOM-SMP-02`, `BOM-GOV-01` | `SPEC-SMP-REACT-01`, `SPEC-GOV-LIFE-01` | P0b, then Phase 2 | Section switch records active and hidden section cost |
| `DL-FD-05` Broad store subscription | static evidence, needs fanout proof | `BOM-SMP-03`, `BOM-GOV-02` | `SPEC-SMP-STORE-01`, `SPEC-GOV-STORE-01` | P0b, then Phase 3 | Store fanout events identify wide subscriptions and affected owners |
| `DL-FD-06` Render-time projection derive/sort | static evidence, needs interaction cost proof | `BOM-SMP-03`, `BOM-GOV-02` | `SPEC-SMP-STORE-01`, `SPEC-GOV-STORE-01` | P0b, then Phase 3 | Projection cost appears in interaction window and disappears after projection ownership fix |
| `DL-FD-07` Row-level overlay queue | evidence-backed right-click DOM sample, needs overlay event proof | `BOM-SMP-04`, `BOM-GOV-03` | `SPEC-SMP-OVERLAY-01`, `SPEC-GOV-OVERLAY-01` | P0b, then Phase 4 | `contextmenu.intent -> overlay.visible` proves queueing and later meets `<50ms` |
| `DL-FD-08` SideNav side effects | static evidence, needs click-frame invoke/store proof | `BOM-SMP-03`, `BOM-SMP-05`, `BOM-GOV-04` | `SPEC-SMP-STORE-01`, `SPEC-SMP-INVOKE-01`, `SPEC-GOV-BRIDGE-01` | P0b, then Phase 1 | Primary nav click frame shows or excludes side effects |
| `DL-FD-09` Browser baseline fail-open | evidence-backed | `BOM-GATE-01`, `BOM-RUN-01` | `SPEC-GATE-01`, `SPEC-RUN-01` | P0c | Gateway absent produces `baseline preflight failure`, not sample output |
| `DL-FD-10` Startup/true-click measurability | evidence-backed blocker | `BOM-CAP-04`, `BOM-RUN-01`, `BOM-GATE-02` | `SPEC-RUN-01`, `SPEC-GATE-02` | P0c, then Phase 5 | Tauri cell records app/gateway/ready state and exact automation blocker or true-click samples |

## 7. Anti-Patch Proof Rules

An implementation is not allowed to claim framework-level remediation unless all of these are true:

1. The PR references at least one BOM ID and one Spec ID.
2. The PR maps to a planned work package or phase.
3. The PR adds or updates a gate that would catch recurrence.
4. The evidence report shows before/after impact or explains why the work is measurement-only.
5. The fix lands in a framework contract layer, not only inside one product component.
6. Any exception has owner, budget, expiry, and Station-queryable evidence.

## 8. Pilot Verdict

This pilot shows the current plan can be made actionable, but only if the method is enforced as a chain:

```text
Requirement
  -> BOM IDs
  -> Spec IDs
  -> Work package
  -> Gate
  -> Evidence
  -> Completion audit
```

The current execution plan is a valid architecture blueprint. This document supplies the missing construction control layer. Without this layer, Phase 0 can drift into a large telemetry platform or individual component patches. With this layer, each task has material scope, owner, contract, gate, and evidence.

## 9. Construction Binding

The Phase 0 construction plan consumes this document. It is responsible for task order, dependencies, gate checklist, skill governance, and completion audit:

- `P0a`: Station-managed telemetry minimum loop.
- `P0b`: interaction correlation and samplers.
- `P0c`: baseline runner and fail-closed gate.

Binding rules:

1. This document owns material and contract identity.
2. The construction plan owns executable task sequencing.
3. The Phase 0 ledger owns current execution status.
4. Implementation PRs must reference all three layers when claiming progress.

## 10. Method Validation Boundary

Validated by this pilot:

- The requirement can be decomposed into BOM materials, contracts, work packages, gates, and evidence.
- Missing contract references are detectable before implementation.
- Patch-style work can be rejected by requiring BOM/Spec/Gate/Evidence linkage.
- P0a/P0b/P0c can be ordered by dependency instead of by component symptoms.

Still unproven:

- Whether the first implementation PR will comply without manual correction.
- Whether `pt-execution-plan-guardian` and `pt-completion-auditor` enforce the chain strongly enough after skill edits.
- Whether Station-managed telemetry, sampler correlation, and baseline gates pass in runtime.
- Whether the resulting evidence is sufficient to start Phase 1-5 fixes.

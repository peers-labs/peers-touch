# Atelier Completion Audit

> Date: 2026-07-06
> Plan source: `docs/architecture/atelier/README.md`, `docs/architecture/atelier/design.md`, `docs/architecture/atelier/data-model.md`, `docs/architecture/atelier/decisions.md`, `docs/architecture/atelier/execution-plans/`, `tmp/atelier-master-goal.md`
> Workstream: `P3-08 - Completion audit`
> Applet: `peers.atelier`
> Verdict: `NOT_READY`

## Audit Target

This audit checks whether the current Atelier official applet work can be
claimed complete against the active goal:

- build Atelier as a Desktop applet / personal workbench / projection surface;
- preserve Station / Agent orchestration ownership of execution, Provider,
  Gate, Artifact, Trace, Checkpoint, Resume, durable outbox, and persistence;
- finish non-real-environment work first;
- leave true Desktop Host + Station + applet end-to-end validation last;
- keep prototype/docs synchronized or explicitly mark divergence as `UNSYNCED`.

The audit is based on current source, tracker, and evidence artifacts. It does
not run a full real Desktop Host + Station + applet scenario.

## Findings

| Severity | Finding | Evidence | Required action |
|----------|---------|----------|-----------------|
| P1 | Full Atelier readiness is not proven. Product-window evidence covers workspace load, createFromGoal task/node/provider-plan/event replay, projection replay/reconnect, cross-restart cursor recovery, rendered projection, unsubscribe, decision resolve, PAUSED live resume into the provider loop, focused Artifact/Gate recovery slices, and a Host-owned rendered artifact preview surface descriptor, but not a complete task lifecycle. | `official-applet/atelier-product-window-gate.json`, `official-applet/atelier-product-window-cross-restart-gate.json`, `official-applet/atelier-decision-product-window-gate.json`, `official-applet/atelier-live-resume-product-window-gate.json`, `official-applet/atelier-artifact-gate-product-window-gate.json`, `official-applet/atelier-artifact-preview-open-product-window-evidence.json`, `official-applet/atelier-artifact-gate-recovery-product-window-gate.json`, `official-applet/atelier-artifact-gate-recovery-accept-risk-product-window-gate.json`, `official-applet/atelier-artifact-gate-recovery-continue-product-window-gate.json`, and `official-applet/atelier-artifact-gate-recovery-cancel-product-window-gate.json` cover focused slices but still list `notCovered` for real executor/provider recovery completion beyond live human-decision resume, rich web iframe/image/html/diff renderer runtime, Console Logs runtime stream, attachment Host Storage runtime, and complete Host + Station + applet E2E. | Keep global goal active. Add E2E gates for complete executor/provider recovery lifecycle and complete Host + Station + applet lifecycle before claiming ready. |
| P1 | Artifact/Gate production and blocking-gate recovery are only proven as focused product-window slices, not as a full real executor/provider loop. | `official-applet/atelier-artifact-gate-product-window-gate.json` proves Station-produced artifact metadata, failed blocking gate metadata, pending recovery decision render, and `atelier.artifact.preview.open` Host-rendered surface descriptor delivery in the normal Desktop product window. Recovery artifacts prove `rerun_failed_node`, `accept_risk`, `continue`, and `cancel` choices reach `/v1/escalations:resolve`, consume the durable interrupt, update Station gate recovery state, and render the resolved decision. These artifacts still list real executor/provider loop completion, rich artifact body renderers, Console Logs, and attachment storage as not covered. | Drive Station-owned GateRunner/artifact production, failing blocking gate, human recovery, rerun/continue/accept/cancel semantics, executor/provider completion, and projection replay through full lifecycle evidence. |
| P2 | Current reconnect proof is controlled EOF recovery, not arbitrary network failure coverage. | `atelier-real-product-gate.json` and product-window report use controlled pre/post replay SSE close. | Add timeout/disconnect/auth-denied/non-retry matrix against the product-window path if readiness needs network robustness claims. |
| P2 | Rich artifact visual rendering remains Host-owned but not fully proven as runtime. | `official-applet/atelier-artifact-preview-open-product-window-evidence.json` proves the official applet submitted the Station-projected sandbox target through `atelier.artifact.preview.open` in a normal Desktop product window and received a Desktop Host-owned `host_sandbox_manifest` rendered surface descriptor with `prepared=true`, `opened=true`, `rendererStatus=rendered`, and `rendererCapabilities` including `host_visual_renderer_surface`. | Prove concrete Host renderers for supported artifact bodies, Console Logs, and attachments without exposing raw body/render fields to applet. |

No P0 finding was found in the audited evidence. The current docs and tracker do
not claim global completion, and the applet boundary remains projection-only in
the inspected artifacts.

## Requirement Matrix

| Requirement | Status | Evidence | Gap |
|-------------|--------|----------|-----|
| Projection-only applet boundary | DONE | `docs/architecture/atelier/README.md`; `apps/applets/atelier/contracts/atelier-projection.contract.json`; `atelier-desktop-injection-gate.json` forbidden permissions | None found in current audit. |
| Official applet package / Desktop injection | DONE | `official-applet/atelier-desktop-injection-gate.json` with indexed package, route alignment, integrity, and forbidden permissions | Runtime E2E beyond injection remains separate. |
| Loading / empty / disconnected / auth denied controlled UI states | PARTIAL | `atelier:official-frontend-gate` is recorded PASS in P3-07 report and tracker; controlled matrix evidence only | Real Host/Station failure matrix not proven. |
| Bridge runtime robustness | PARTIAL | `atelier:bridge-runtime-gate` is recorded PASS in P3-07 report and tracker | Browser/control path evidence is not complete real product E2E. |
| Station workspace load through product window | PARTIAL | `official-applet/atelier-product-window-gate.json` proves `/v1/workspace` inside product window | Uses sqlite-backed gate server, not a full real user task workspace. |
| Projection subscribe/reconnect/render/unsubscribe product-window slice | PARTIAL | `official-applet/atelier-product-window-gate.json`; `official-applet/atelier-product-window-cross-restart-gate.json`; rendered, unsubscribe, and cross-restart evidence JSON files | Arbitrary network failure matrix remains unproven. |
| createFromGoal -> task -> node -> event replay E2E | PARTIAL | P3-04 tracker row product-window slice done; `official-applet/atelier-product-window-gate.json` proves created task/node/provider-plan/event replay in product window | Broader real user business lifecycle still unproven. |
| Human decision / escalation / resume E2E | PARTIAL | P3-05 tracker row product-window decision resolve + live-resume focused slices done; `official-applet/atelier-decision-product-window-gate.json` proves `/v1/escalations:resolve`, Station durable pending interrupt consumption, resolved event, and rendered chosen decision evidence; `official-applet/atelier-live-resume-product-window-gate.json` proves official applet decision resolve wakes an in-flight `LiveResumeBroker` waiter and real `TurnService.ExecuteTurn` completes the provider loop with `station_human_decision_resume`, `resolvedInterrupts=1`, and `consumedInterrupts=1` | Complete real executor/provider recovery lifecycle beyond live human-decision resume remains unproven. |
| Artifact/Gate production + blocking recovery E2E | PARTIAL | `official-applet/atelier-artifact-gate-product-window-gate.json` proves Station-produced artifact/gate metadata rendering and Host preview-open rendered surface delivery; `official-applet/atelier-artifact-preview-open-product-window-evidence.json` proves `desktop_host` / `host_sandbox_manifest` / `rendered` with `opened=true` and `host_visual_renderer_surface`; `official-applet/atelier-artifact-gate-recovery-product-window-gate.json` proves `rerun_failed_node`; `official-applet/atelier-artifact-gate-recovery-accept-risk-product-window-gate.json`, `official-applet/atelier-artifact-gate-recovery-continue-product-window-gate.json`, and `official-applet/atelier-artifact-gate-recovery-cancel-product-window-gate.json` prove `accept_risk`, `continue`, and `cancel` decision resolve plus rendered resolved projection in product window | Real executor/provider loop completion, web iframe/image/html/diff renderer, Console Logs runtime stream, attachment Host Storage runtime, and complete E2E remain unproven. |
| Acceptance evidence report | DONE | `official-applet/atelier-acceptance-evidence-report-2026-07-06.md` | Does not replace completion audit or full readiness. |
| Completion audit | DONE | This file | Verdict is `NOT_READY`, not completion. |
| Prototype/docs sync | PARTIAL | `docs/architecture/atelier/prototype/README.md` and tracker record many synchronized slices and `UNSYNCED` rich preview boundary | Full UI/runtime parity remains dependent on unfinished E2E and Host renderer work. |

## Architecture Fit

| Layer | Status | Audit note |
|-------|--------|------------|
| Applet UI | PARTIAL | Official frontend consumes projections and emits intent/capability calls. Product-window rendered projection and rendered chosen-decision telemetry are proven for focused slices. |
| Applet SDK / bridge | PARTIAL | Controlled bridge runtime gates cover parsing, lifecycle, retry, malformed events, and cleanup. Full Host/Station failure coverage remains unproven. |
| Desktop host / gateway | PARTIAL | Product-window gates prove route, workspace, event subscription, rendered telemetry, unsubscribe, cross-restart cursor recovery, and Atelier artifact preview-open Host side-effect consumption slices. Arbitrary network failure coverage and rich sandbox visual runtime remain unproven. |
| Station official facade | PARTIAL | Real-product gate proves facade workspace and event replay against sqlite-backed Station gate server. Full real task lifecycle remains unproven. |
| Agent orchestration | PARTIAL | Service/static evidence exists for many Station-owned mechanisms. P3 task creation projection, human decision resolve, PAUSED live resume into the real `TurnService.ExecuteTurn` provider loop, focused Artifact/Gate rendering, and blocking gate `rerun_failed_node` / `accept_risk` / `continue` / `cancel` recovery decision resolve slices are covered, but complete real executor/provider recovery completion is missing. |
| Persistence / durable outbox | PARTIAL | Projection, replay, and cross-restart cursor recovery paths are proven in focused gates. Complete lifecycle needs stronger evidence. |
| Prototype | PARTIAL | Prototype sync is tracked, official preview-open now records a Host-rendered surface descriptor, and richer iframe/image/html/diff preview divergence remains marked as `UNSYNCED`. |
| Evidence / gates | PARTIAL | P3-02/P3-04 product-window slices, P3-03 cross-restart cursor recovery, P3-05 decision resolve and PAUSED live-resume provider-loop slices, P3-06 artifact/gate render slice, and P3-07 blocking gate recovery decision resolve slices for `rerun_failed_node`, `accept_risk`, `continue`, and `cancel` are covered; complete real executor/provider recovery lifecycle is still missing. |

## Security And Permission Review

The inspected manifest and contract preserve the applet boundary:

- Allowed capabilities include projection reads, Station-owned intent methods,
  safe artifact body fetch, host preview/open intent, event subscription, and
  telemetry.
- `atelier.provider.invoke`, `atelier.skills.invoke`, `atelier.memory.write`,
  `atelier.rerun`, `atelier.artifact.produce`, `atelier.gate.produce`,
  `execute`, `run`, `shell`, and `file` are listed as forbidden by
  `atelier-desktop-injection-gate.json`.
- Contract `methodIntents` mark Atelier methods as Station-owned or Host-owned
  intents and keep `executionForbidden: true`.

Security caveat: this audit does not prove live auth/ownership behavior for
every Station endpoint. Happy-path product-window evidence must not be reported
as full authorization coverage.

## Verification Evidence

| Command or artifact | Status | Coverage classification |
|---------------------|--------|-------------------------|
| `pnpm run atelier:projection-contract-gate` | PASS | Static / contract boundary evidence. |
| `pnpm run atelier:bridge-runtime-gate` | PASS | Controlled bridge runtime evidence. |
| `pnpm run atelier:official-frontend-gate` | PASS | Controlled official frontend UI/status evidence. |
| `pnpm --filter @peers-touch/atelier-official-applet run check` | PASS | TypeScript check, not runtime proof. |
| `pnpm run applet:atelier-desktop-injection-gate` | PASS | Package/injection/manifest/integrity/permission boundary evidence. |
| `pnpm run applet:atelier-real-product-gate` | PASS | Desktop Gateway to Station-bundled workspace/replay controlled evidence. |
| `pnpm run applet:atelier-product-window-gate` | PASS | Focused product-window workspace/createFromGoal/replay/render/unsubscribe evidence. |
| `pnpm run applet:atelier-product-window-cross-restart-gate` | PASS | Focused product-window cross-restart cursor recovery evidence: second packaged launch reuses the same storage root with a new applet session, subscribes with persisted `afterEventSeq=4`, and Station replay returns `replayedSeqs=[]`. |
| `pnpm run applet:atelier-decision-product-window-gate` | PASS | Focused product-window human decision resolve evidence through Station durable interrupt resolution and rendered chosen-decision telemetry. |
| `pnpm run applet:atelier-live-resume-product-window-gate` | PASS | Focused product-window PAUSED live-resume evidence: official applet resolves the human decision through `/v1/escalations:resolve`, Station wakes the in-flight `LiveResumeBroker` waiter, real `TurnService.ExecuteTurn` performs the final provider call, and the interrupt is marked consumed. |
| `pnpm run applet:atelier-artifact-gate-product-window-gate` | PASS | Focused product-window rendering evidence for Station-produced artifact metadata, failed blocking gate metadata, pending recovery decision, and Host-owned artifact preview-open rendered surface descriptor. |
| `official-applet/atelier-artifact-preview-open-product-window-evidence.json` | PASS | Focused product-window evidence for `atelier.artifact.preview.open`: `accepted=true`, `prepared=true`, `opened=true`, `rendererOwner=desktop_host`, `rendererMode=host_sandbox_manifest`, `rendererStatus=rendered`, `rendererCapabilities` includes `host_visual_renderer_surface`, canonical `atelier-sandbox://.../preview` and `artifact://.../body` refs. |
| `pnpm run applet:atelier-artifact-gate-recovery-product-window-gate` | PASS | Focused product-window evidence for blocking gate `rerun_failed_node` choice through `/v1/escalations:resolve`, durable interrupt consumption, resolved projection rendering, and no replay after the advanced cursor. |
| `pnpm run applet:atelier-artifact-gate-recovery-accept-product-window-gate` | PASS | Focused product-window evidence for blocking gate `accept_risk` choice through `/v1/escalations:resolve`, durable interrupt consumption, `gate_recovery_action=accept`, `gatePlanStatus=accepted`, `taskStatus=4`, and resolved projection rendering. |
| `pnpm run applet:atelier-artifact-gate-recovery-continue-product-window-gate` | PASS | Focused product-window evidence for blocking gate `continue` choice through `/v1/escalations:resolve`, durable interrupt consumption, `gate_recovery_action=continue`, `gatePlanStatus=continued`, `taskStatus=4`, and resolved projection rendering. |
| `pnpm run applet:atelier-artifact-gate-recovery-cancel-product-window-gate` | PASS | Focused product-window evidence for blocking gate `cancel` choice through `/v1/escalations:resolve`, durable interrupt consumption, `gate_recovery_action=cancel`, `gatePlanStatus=cancelled`, `taskStatus=6`, and resolved projection rendering. |
| `official-applet/atelier-acceptance-evidence-report-2026-07-06.md` | PASS | Evidence aggregation and explicit not-covered list. |
| Full Host + Station + applet E2E | NOT RUN | Required before global readiness claim. |

## Verdict

Atelier is not globally complete and is not ready for a final completion claim.

The current evidence supports a narrower claim: the official `peers.atelier`
package has a verified Desktop product-window slice for Station workspace load,
createFromGoal task/node/provider-plan/event replay, projection replay/reconnect,
rendered stream state telemetry, unsubscribe cleanup, Station-owned decision
resolve with rendered chosen-decision evidence, focused Artifact/Gate metadata
rendering, artifact preview-open Host side-effect consumption, cross-restart
cursor recovery, PAUSED live resume into the real provider turn loop, and
blocking gate `rerun_failed_node` / `accept_risk` / `continue` / `cancel`
recovery decision resolve, while preserving the projection-only applet
boundary. Real executor/provider recovery completion beyond live human-decision
resume, web iframe/image/html/diff renderer, Console Logs runtime stream,
attachment Host Storage runtime, and full Host + Station + applet E2E remain
open before marking the active goal complete.

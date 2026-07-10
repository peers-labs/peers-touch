# Atelier Acceptance Evidence Report

> Date: 2026-07-06
> Plan source: `docs/architecture/atelier/README.md`, `docs/architecture/atelier/execution-plans/roadmap.md`, `tmp/atelier-master-goal.md`
> Workstream: `P3-07 - Acceptance evidence report`
> Applet: `peers.atelier`
> Evidence classes used: `REAL_PRODUCT_PATH`, `CONTROLLED_LOCAL_UPSTREAM`, `STATIC_CONTRACT_GATE`, `NOT_IMPLEMENTED`

## Scope

This report summarizes the current Atelier acceptance evidence for the official
Desktop applet product path. It does not claim global Atelier completion and
does not replace the separate P3-08 completion audit.

Atelier remains a projection surface:

- Station / Agent orchestration own task execution, Provider, Gate, Artifact,
  Trace, Checkpoint, Resume, durable outbox, and persistence truth.
- The applet consumes workspace snapshots and projection events, then writes
  user intent through declared Host / service capabilities.
- Artifact/Gate production, provider execution, shell/run/file access, and
  direct memory writes are not applet capabilities.

## REAL_PRODUCT_PATH Evidence

| Area | Current evidence | Artifact |
|------|------------------|----------|
| Desktop package injection | `peers.atelier` is indexed in Desktop applet dist, service binding routes `/v1` to `/applets/atelier/v1`, bundle integrity matches, and forbidden applet capabilities are rejected. | `official-applet/atelier-desktop-injection-gate.json` |
| Station-backed workspace and replay through Desktop Gateway | Desktop Gateway reaches the Station-bundled Atelier facade for `/v1/workspace`; `atelier.events.subscribe` reaches `/sub-agent/agent/events/subscribe`; cursor-filtered replay and controlled pre/post replay SSE close recovery pass. | `official-applet/atelier-real-product-gate.json` |
| Normal Desktop product shell render | Packaged `peers.atelier` renders inside the normal Desktop product shell and reports `applet.product.rendered`. | `desktop/product-window-gate/product-shell-evidence.json` |
| Product-window workspace load | In the normal Desktop product window, the official applet loads Station workspace through `/v1/workspace` service binding. | `official-applet/atelier-product-window-gate.json` |
| Product-window createFromGoal task/node/provider-plan/event replay | In the normal Desktop product window, the official applet submits `createFromGoal` through `/v1/projects`; Station creates a collaboration task, 2 nodes, provider plan, durable events, and the applet renders the created task projection. | `official-applet/atelier-product-window-gate.json`, `official-applet/atelier-product-window-created-project-evidence.json` |
| Product-window projection replay and reconnect | In the normal Desktop product window, launch options trigger `atelier.events.subscribe`; created task replay/resume probe covers `0 -> [1]`, `1 -> [2,3]`, and `4 -> []`. | `official-applet/atelier-product-window-gate.json` |
| Product-window cross-restart cursor recovery | Two normal Desktop product-window launches reuse the same storage root with different applet sessions; the second launch subscribes with persisted `afterEventSeq=4`, and Station replay returns no old events. | `official-applet/atelier-product-window-cross-restart-gate.json` |
| Product-window rendered projection | Station `stream.append` projection event reaches applet event handler, reducer, rendered stream state, and telemetry evidence with `patchKind=stream.append`, `eventSeq=4`, `viewStatus=ready`. | `official-applet/atelier-product-window-rendered-projection-evidence.json` |
| Product-window unsubscribe / cancel | Product-window close path triggers `events.unsubscribe('atelier.projection.event')`; Desktop Gateway records `atelier.projection.unsubscribe` for the applet session. | `official-applet/atelier-product-window-unsubscribe-evidence.json` |
| Product-window human decision resolve | In the normal Desktop product window, the official applet renders a pending Station decision, submits the chosen option through `/v1/escalations:resolve`, Station consumes the durable pending interrupt and writes a resolved event, and the applet renders the chosen decision before emitting telemetry. | `official-applet/atelier-decision-product-window-gate.json`, `official-applet/atelier-decision-product-window-resolved-evidence.json` |
| Product-window PAUSED live resume | The official applet uses the same `/v1/escalations:resolve` path; Station wakes the in-flight `LiveResumeBroker` waiter, `TurnService.ExecuteTurn` performs the final provider call, and the durable interrupt is marked consumed. | `official-applet/atelier-live-resume-product-window-gate.json`, `official-applet/atelier-live-resume-product-window-resolved-evidence.json` |
| Product-window Artifact/Gate projection and Host preview surface | Station-produced artifact metadata, failed blocking gate metadata, and pending recovery decision render in the normal Desktop product window; `atelier.artifact.preview.open` returns a Desktop Host-owned rendered sandbox surface descriptor with `opened=true`, `rendererStatus=rendered`, and `host_visual_renderer_surface`. | `official-applet/atelier-artifact-gate-product-window-gate.json`, `official-applet/atelier-artifact-preview-open-product-window-evidence.json` |
| Product-window blocking-gate recovery variants | `rerun_failed_node`, `accept_risk`, `continue`, and `cancel` choices are submitted through `/v1/escalations:resolve`, consume the durable pending interrupt, update Station gate recovery state, and render the resolved decision. | `official-applet/atelier-artifact-gate-recovery-product-window-gate.json`, `official-applet/atelier-artifact-gate-recovery-accept-risk-product-window-gate.json`, `official-applet/atelier-artifact-gate-recovery-continue-product-window-gate.json`, `official-applet/atelier-artifact-gate-recovery-cancel-product-window-gate.json` |

## Controlled / Static Evidence

| Gate | Status | What it proves |
|------|--------|----------------|
| `pnpm run atelier:projection-contract-gate` | PASS | Projection contract, forbidden applet capabilities, generated artifacts, official/prototype anchors, and documented boundary text remain aligned. |
| `pnpm run atelier:bridge-runtime-gate` | PASS | Browser bridge runtime handles snapshot/event parsing, bounded subscription lifecycle, malformed ingress, dedupe, and cleanup guards in controlled runtime tests. |
| `pnpm run atelier:official-frontend-gate` | PASS | Official frontend controlled UI/status matrix, projection rendering guards, locale anchors, and forbidden capability source guards pass. |
| `pnpm --filter @peers-touch/atelier-official-applet run check` | PASS | Official Atelier frontend TypeScript check passes. |
| `pnpm run applet:atelier-desktop-injection-gate` | PASS | Desktop injection, service manifest, dist manifest, integrity, route alignment, and permission boundary pass. |
| `pnpm run applet:atelier-real-product-gate` | PASS | Desktop Gateway to Station-bundled Atelier workspace/replay path passes with controlled reconnect evidence. |
| `pnpm run applet:atelier-product-window-gate` | PASS | Packaged product-window shell, Station workspace load, createFromGoal task/node/provider-plan/event replay, controlled replay/reconnect, rendered projection, and unsubscribe evidence pass. |
| `pnpm run applet:atelier-product-window-cross-restart-gate` | PASS | Packaged product-window cross-restart cursor recovery evidence passes with persisted cursor and no old event replay. |
| `pnpm run applet:atelier-decision-product-window-gate` | PASS | Packaged product-window decision resolve slice passes through `/v1/escalations:resolve`, Station guarded interrupt resolution, rendered chosen decision telemetry, and durable resolve probe evidence. |
| `pnpm run applet:atelier-live-resume-product-window-gate` | PASS | Packaged product-window PAUSED live-resume slice passes through `/v1/escalations:resolve`, `LiveResumeBroker`, and real `TurnService.ExecuteTurn` provider loop completion. |
| `pnpm run applet:atelier-artifact-gate-product-window-gate` | PASS | Packaged product-window artifact/gate projection slice passes, including Host-owned rendered preview surface descriptor evidence. |
| `pnpm run applet:atelier-artifact-gate-recovery-product-window-gate` | PASS | Packaged product-window blocking gate `rerun_failed_node` recovery choice reaches Station guarded resolve and renders resolved projection. |
| `pnpm run applet:atelier-artifact-gate-recovery-accept-product-window-gate` | PASS | Packaged product-window blocking gate `accept_risk` recovery choice reaches Station guarded resolve and renders resolved projection. |
| `pnpm run applet:atelier-artifact-gate-recovery-continue-product-window-gate` | PASS | Packaged product-window blocking gate `continue` recovery choice reaches Station guarded resolve and renders resolved projection. |
| `pnpm run applet:atelier-artifact-gate-recovery-cancel-product-window-gate` | PASS | Packaged product-window blocking gate `cancel` recovery choice reaches Station guarded resolve and renders resolved projection. |

## Logs And Artifacts

| Artifact | Use |
|----------|-----|
| `desktop/product-window-gate-output.txt` | Product-window gate log, including required upstream URL hits for `/applets/atelier/v1/workspace` and `/sub-agent/agent/events/subscribe`. |
| `official-applet/atelier-product-window-gate.json` | Aggregated product-window gate result with `coveredPaths` and `notCovered`. |
| `official-applet/atelier-product-window-cross-restart-gate.json` | Aggregated product-window cross-restart cursor recovery result. |
| `official-applet/atelier-product-window-created-project-evidence.json` | Product-window createFromGoal rendered-task telemetry evidence. |
| `official-applet/atelier-real-product-gate.json` | Station-bundled workspace/replay gate result and controlled reconnect coverage. |
| `official-applet/atelier-desktop-injection-gate.json` | Dist package, manifest, service route, integrity, and permission evidence. |
| `official-applet/atelier-product-window-rendered-projection-evidence.json` | Rendered projection telemetry evidence. |
| `official-applet/atelier-product-window-unsubscribe-evidence.json` | Product-window close / unsubscribe evidence. |
| `official-applet/atelier-decision-product-window-gate.json` | Aggregated product-window decision resolve gate result with Station resolve probe and explicit not-covered list. |
| `official-applet/atelier-decision-product-window-resolved-evidence.json` | Rendered decision-resolved telemetry evidence after the official applet shows the chosen decision. |
| `official-applet/atelier-live-resume-product-window-gate.json` | Aggregated product-window PAUSED live-resume gate result with provider-loop probe. |
| `official-applet/atelier-live-resume-product-window-resolved-evidence.json` | Rendered decision-resolved telemetry evidence for the live-resume slice. |
| `official-applet/atelier-artifact-gate-product-window-gate.json` | Aggregated product-window Artifact/Gate projection and Host preview-open rendered surface result. |
| `official-applet/atelier-artifact-preview-open-product-window-evidence.json` | Rendered Host preview surface telemetry evidence: canonical refs, `opened=true`, `rendererStatus=rendered`, and `host_visual_renderer_surface`. |
| `official-applet/atelier-artifact-gate-recovery-product-window-gate.json` | Blocking gate `rerun_failed_node` recovery result. |
| `official-applet/atelier-artifact-gate-recovery-accept-risk-product-window-gate.json` | Blocking gate `accept_risk` recovery result. |
| `official-applet/atelier-artifact-gate-recovery-continue-product-window-gate.json` | Blocking gate `continue` recovery result. |
| `official-applet/atelier-artifact-gate-recovery-cancel-product-window-gate.json` | Blocking gate `cancel` recovery result. |
| `desktop/product-window-gate/product-shell-evidence.json` | Product shell render evidence for `peers.atelier`. |

No screenshot artifact is required for the current automated P3-07 report. The
product-window gate uses JSON evidence and log output as the acceptance record.

## Not Covered

| Gap | Current state | Required next proof |
|-----|---------------|---------------------|
| Real executor/provider recovery completion | Partial. PAUSED live human-decision resume into `TurnService.ExecuteTurn` is proven, and blocking gate recovery choices are resolved through Station, but full executor/provider recovery completion beyond that focused live-resume slice is not proven. | Drive a full Station-owned recovery lifecycle through executor/provider completion and replay the resulting accepted state to the applet. |
| Complete Host + Station + applet E2E | Not proven. Current product-window gate covers a focused workspace/replay/render/unsubscribe slice. | Run a complete scenario from task creation through execution, artifact/gate evidence, human decision if needed, and accepted project state. |
| Arbitrary network failure | Not proven. Current reconnect evidence uses controlled pre/post replay Station SSE close. | Add failure matrix for timeout, transient disconnect, auth denied, and recovery/non-retry behavior in real product window path. |
| Rich artifact body runtimes | Not implemented as full runtime proof. Official applet remains metadata-only plus safe body fetch / preview-open Host-rendered surface descriptor. | Prove web iframe/image/html/diff renderer, Console Logs runtime stream, and attachment Host Storage runtime without exposing raw body/render fields to applet. |

## Claim

P3-07 is satisfied as an evidence report: current commands, logs, JSON
artifacts, and unproven boundaries are recorded. This does not complete P3-08,
does not prove full Atelier readiness, and does not change the projection-only
Atelier boundary.

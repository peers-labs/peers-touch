# Agent LobeHub Parity - Home Runtime Contract Follow-up Revision

> **Status**: active Home artifact promotion / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-09
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Home runtime contract follow-up / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-HR-pre
> **BOM**: BOM-001, BOM-002, BOM-003, BOM-005, BOM-012, BOM-015
> **Spec**: SPEC-001, SPEC-002, SPEC-003, SPEC-006, SPEC-008, SPEC-009, SPEC-010, SPEC-011, SPEC-013, SPEC-014
> **Gate**: GATE-003, GATE-004, GATE-006, GATE-008

---

## 1. Purpose

`EVID-011-CI-pre` and `EVID-011-CJ-pre` improved Home compact dashboard
density, but the active artifact still described Home mainly as a visual
entry surface. `EVID-011-HR-pre` promotes Home to a source-backed runtime
contract review surface.

The HR artifact treats Home as the long-lived Agent entry runtime:

- alive Home layout and sidebar state,
- selected-agent resolution and agent config preheating,
- daily-brief hint and ChatInput send semantics,
- context upload/resource binding,
- recents/sidebar retry and customization states,
- Peers Touch ownership split across base-client, base-settings,
  agent-domain, base-resource and Station.

This document records a prototype-only Home follow-up revision. It does not
record an Owner decision, does not confirm Home or the prototype, does not
authorize `EVID-012`, does not edit product code and does not prove GATE-008
product parity.

## 2. LobeHub Source Anchors

| Area | Source Path | Contract Captured |
| --- | --- | --- |
| Home layout lifetime | `external/lobehub/src/routes/(main)/home/_layout/index.tsx` | `Activity` keeps Home layout alive after first activation; Home hides inactive DOM while preserving state. |
| Recent hydration | `external/lobehub/src/routes/(main)/home/_layout/RecentHydration.tsx` | Recents initialize as a Home runtime side effect, not a one-off visual list. |
| Sidebar body | `external/lobehub/src/routes/(main)/home/_layout/Body/index.tsx` | Workspace-scoped sidebar order, hidden sections, expanded keys, page size, context menu and customize sidebar. |
| Agent sidebar | `external/lobehub/src/routes/(main)/home/_layout/Body/Agent/index.tsx` | Agent list loading/revalidation and create/config group actions are sidebar runtime states. |
| Agent select | `external/lobehub/src/routes/(main)/home/features/AgentSelect/index.tsx`; `external/lobehub/src/routes/(main)/home/features/AgentSelect/useResolvedHomeAgentId.ts` | Loading skeleton, retry, selected-agent persistence, stale id fallback and agent config preheat. |
| Input area | `external/lobehub/src/routes/(main)/home/features/InputArea/index.tsx` | Home ChatInput binds active agent, server-config banners, input config loading, drag upload and model/provider selectors. |
| Send path | `external/lobehub/src/routes/(main)/home/features/InputArea/useSend.ts` | Empty-input daily hint send, agent/group/write/research branches, config hydration before send, isolated topic route push/replace, cleanup after send. |
| ChatInput runtime | `external/lobehub/src/features/ChatInput/store/initialState.ts`; `external/lobehub/src/features/ChatInput/store/action.ts` | History, completion, slash placement, draft clear, focus restore, stop/send disabled behavior and input completion recovery. |
| Recents | `external/lobehub/src/routes/(main)/home/features/Recents/index.tsx` | Login gate, SWR revalidate, error-before-skeleton retry, page size, move/hide section and all-recents drawer. |
| Agent home / topics | `external/lobehub/src/features/AgentHome/**`; `external/lobehub/src/store/session/**`; `external/lobehub/src/store/chat/slices/topic/**` | Home entry links into agent/topic runtime rather than owning durable session truth. |

## 3. Revision Scope

| CJ Gap | HR Revision |
| --- | --- |
| Home active artifact was compact dashboard density only. | Added `?surface=home&state=home-runtime-contract&check=hr` as a source-backed runtime contract surface. |
| Selected-agent and config hydration were implicit. | HR makes loading, retry, stale id fallback, selected agent and config preheat explicit review states. |
| ChatInput send semantics were hidden behind the visual composer. | HR documents daily-brief hint send, history/completion/slash/focus behavior, context clearing and route push/replace. |
| Sidebar and recents were treated as a block list. | HR captures alive layout, recent hydration, workspace-scoped sidebar order, page size, hidden sections, retry and drawer states. |
| Peers ownership was too broad. | HR labels base-client, base-settings, agent-domain, base-resource and Station boundaries. |

## 4. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source paths listed above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/home-hr-runtime-contract-scoped.png`, opened and inspected at 1244x1500. The screenshot shows the Home HR runtime-contract shell with source composition, input/send runtime, ownership boundary and fail-closed warning, without Portal chrome. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-home-hr-dom.json`: `marker="home-runtime-contract-hr"`, `evidenceId="EVID-011-HR-pre"`, `runtimeContractShell=true`, `homeLayoutState`, `homeAgentState`, `homeInputState`, `homeContextState`, `homeSendState`, `homeRecentsState`, `recoveryContract=true`, `failClosedWarning=true`, `forbiddenHits=[]`, `portalChromeHit=false`. |
| L2 Metadata | `tmp/agent-lobehub-home-hr-scoped-screenshot-meta.json`: SHA-256 `12e32e161774ecf203d298b25200b1b38515df1bb0b1629ab9c3eca58921603c`, captured with isolated Chrome DevTools Protocol. |

## 5. Remaining Risk

HR improves Home runtime-boundary fidelity, but it still does not prove real
LobeHub SWR, server routing, input-completion, daily-brief fetch, upload,
agent/group/write/research execution, topic creation, recents mutation,
workspace sidebar persistence or Station audit ingestion. Those remain
unproven until Owner confirmation and later product migration gates.

## 6. Claim Boundary

`EVID-011-HR-pre` proves a Home prototype follow-up revision with L1 source
anchors, L2 visual inspection and L3 DOM proof. It promotes the active Home
artifact from `EVID-011-CJ-pre` compact-dashboard context to source-backed
runtime-boundary context. It does not confirm Home, replace Owner judgment,
create or authorize `EVID-012`, or allow Desktop / Station / Model product
migration.

# Agent LobeHub Parity - Home Source Interaction Follow-up Revision

> **Status**: active Home source-interaction artifact / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-09
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Home source-interaction follow-up / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-HS-pre
> **BOM**: BOM-001, BOM-002, BOM-003, BOM-005, BOM-007, BOM-012, BOM-015
> **Spec**: SPEC-001, SPEC-002, SPEC-003, SPEC-006, SPEC-008, SPEC-009, SPEC-010, SPEC-011, SPEC-013, SPEC-014
> **Gate**: GATE-003, GATE-004, GATE-005, GATE-006, GATE-008

---

## 1. Purpose

`EVID-011-HR-pre` promoted Home from compact-dashboard fidelity to a
source-backed runtime-boundary review surface. `EVID-011-HS-pre` goes one level
deeper: it closes the Home entry pipeline as source interaction, separating
cache roots, mutation/recovery paths and Agent consumer boundaries.

HS treats Home as the first Agent capability handoff:

- Home store and SWR recents hydrate before visible activity is trusted.
- selected-agent resolution and config preheat are required before send.
- ChatInput owns draft, history, completion, slash placement and focus state.
- send routes through default topic creation plus Agent / Group / Write /
  Research branches.
- file, page, skill and model references are consumed by Home but owned by
  base-resource, base-settings, agent-domain and later Station audit truth.

This is prototype-only evidence. It does not record an Owner decision, does not
confirm Home or the overall prototype, does not authorize `EVID-012`, does not
edit product code and does not prove GATE-008 product parity.

## 2. LobeHub Source Anchors

| Area | Source Path | Contract Captured |
| --- | --- | --- |
| Persistent Home layout | `external/lobehub/src/routes/(main)<home>/index.tsx`; `external/lobehub/src/routes/(main)<home>/HomeAgentIdSync.tsx`; `external/lobehub/src/routes/(main)<home>/RecentHydration.tsx` | Home stays alive through Activity, syncs selected agent and hydrates recents as runtime side effects. |
| Agent resolution | `external/lobehub/src/routes/(main)<home>/AgentSelect/index.tsx`; `external/lobehub/src/routes/(main)<home>/AgentSelect/useResolvedHomeAgentId.ts` | Home agent selection handles loading, retry, stale id fallback and selected-agent persistence. |
| Input runtime | `external/lobehub/src/routes/(main)<home>/InputArea/index.tsx`; `external/lobehub/src/features/ChatInput/ChatInputProvider.tsx`; `external/lobehub/src/features/ChatInput/store/action.ts`; `external/lobehub/src/features/ChatInput/store/initialState.ts` | ChatInput owns draft, history, completion error, slash placement, focus restore and disabled send state. |
| Send path | `external/lobehub/src/routes/(main)<home>/InputArea/useSend.ts`; `external/lobehub/src/store<home>/homeInput/action.ts` | Empty input can send daily-brief hint; default send ensures agent config, pushes Agent route and replaces it when topic is created; mode branches hydrate builder agents. |
| Context binding | `external/lobehub/src/routes/(main)<home>/InputArea/InputDragUpload.tsx`; `external/lobehub/src/features/ChatInput/Desktop/ContextContainer/index.tsx`; `external/lobehub/src/features/ChatInput/utils/contextSelections.ts` | Uploads and file/page selections are message context inputs and are cleared only after send finalization. |
| Recents runtime | `external/lobehub/src/routes/(main)<home>/Recents/index.tsx`; `external/lobehub/src/routes/(main)<home>/Recents/AllRecentsDrawer.tsx`; `external/lobehub/src/store<home>/recent/action.ts`; `external/lobehub/src/libs/swr/keys.ts` | Recents list and all-recents drawer use SWR roots, retry, page-size, sidebar order, hide/move actions and optimistic title mutation. |

## 3. Revision Scope

| HR Gap | HS Revision |
| --- | --- |
| HR described runtime boundaries but still grouped cache, mutation and consumer states together. | HS adds a source-interaction closure map with Source / cache, Mutation / routing and Agent consumer columns. |
| Recents and all-recents were visible but not distinguished by cache root. | HS records `recentKeys.list` and `recentKeys.allDrawer` as distinct source roots with revalidate and mutation behavior. |
| Send routing was described as a single flow. | HS splits default isolated-topic send, push/replace route, Agent / Group / Write / Research branches and context cleanup. |
| ChatInput state was mentioned but not separated from Home visual state. | HS treats draft, history, input completion, slash placement and focus as ChatInput runtime state consumed by Home. |
| Resource/tool/model inputs could look Home-owned. | HS labels provider/model projection, resource context, tool tags, chat runtime handoff and Station audit as downstream ownership boundaries. |

## 4. Prototype Markers

The active HS review URL is:

```text
?surface=home&state=home-runtime-contract&check=hs
```

The prototype must expose:

- `data-review-marker="home-source-interaction-hs"`
- `data-evidence-id="EVID-011-HS-pre"`
- `data-source-interaction-closure="true"`
- `data-home-source-chain="home-store|recent-swr|agent-resolution|agent-config-preheat|chat-input-store"`
- `data-home-mutation-chain="daily-brief-send|mode-send-branches|topic-route-replace|context-cleanup|recents-mutate"`
- `data-home-consumer-chain="provider-model-projection|resource-context|tool-tags|chat-runtime-handoff|station-audit-pending"`

## 5. Remaining Risk

HS still does not prove real LobeHub SWR, server routing, input completion,
daily-brief fetch, file upload, Agent / Group / Write / Research execution,
topic creation, recents mutation, workspace sidebar persistence, model/provider
runtime execution or Station audit ingestion. Those remain unproven until Owner
confirmation and later product migration gates.

## 6. Claim Boundary

`EVID-011-HS-pre` proves a Home prototype follow-up revision with L1 source
anchors and a planned L2/L3 evidence path. It promotes the active Home artifact
from `EVID-011-HR-pre` runtime-boundary context to source-interaction closure.
It does not confirm Home, replace Owner judgment, create or authorize
`EVID-012`, or allow Desktop / Station / Model product migration.

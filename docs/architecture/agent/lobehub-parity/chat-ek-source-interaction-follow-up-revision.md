# Agent Chat EK Source Interaction Follow-Up Revision

> **Evidence**: EVID-011-EK-pre
> **Status**: active Chat source-interaction artifact / not confirmed
> **Plan Step**: PLAN-P2 Chat source-interaction follow-up / PLAN-P5 blocked precondition
> **BOM**: BOM-002 / BOM-003 / BOM-007 / BOM-012 / BOM-015
> **Spec**: SPEC-002 / SPEC-003 / SPEC-008 / SPEC-009 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014
> **Gates**: GATE-003 / GATE-004 / GATE-005 / GATE-006 / GATE-008

## Source Anchors

EK extends DY from execution and replay semantics into the source-interaction
chain that owns Chat correctness before product migration is allowed.

| Source | Contract represented in EK |
| --- | --- |
| `external/lobehub/src/store/chat/slices/agentRun/actions/entries/conversationLifecycle.ts` | operation creation, temporary user/assistant rows, temporary topic replacement/rollback, gateway/client send branch and context/page selection persistence |
| `external/lobehub/src/store/chat/slices/agentRun/actions/dispatch/agentDispatcher.ts` | runtime priority remains `parentRuntime > heterogeneous gateway > gateway > client` |
| `external/lobehub/src/services/chat/index.ts`; `external/lobehub/src/services/chat/helper.ts` | provider/model/deployment/API mode/runtime provider/fetch path are resolved before SSE request context is built |
| `external/lobehub/src/app/(backend)/webapi/chat/[provider]/route.ts` | authenticated provider route initializes model runtime and passes abort signal to execution |
| `external/lobehub/src/features/Conversation/store/slices/data/action.ts`; `external/lobehub/src/features/Conversation/ChatList/index.tsx` | streaming operation blocks stale SWR/focus revalidation and merges newer local rows with stable references |
| `external/lobehub/src/features/Conversation/store/slices/generation/action.ts` | regenerate and delete-regenerate order branch switching before execution |
| `external/lobehub/src/store/chat/slices/agentRun/actions/entries/conversationControl.ts` | tool approval and human tool result resume start new gateway operations and retire paused ops only after successful resume |
| `external/lobehub/src/store/chat/slices/agentRun/actions/transports/gateway/gateway.ts`; `gatewayEventHandler.ts`; `external/lobehub/src/app/(backend)/api/agent/stream/route.ts` | gateway operation id, token refresh, reconnect, `lastEventId`, `includeHistory`, terminal reconcile and terminal-missing fallback |
| `external/lobehub/src/features/Conversation/ChatList/components/VirtualizedList.tsx`; `useTopicScrollPersist.ts`; `useSelectionMessageIds.ts`; `Messages/index.tsx` | scroll snapshot migration, streaming/selection keepMounted rows and message/action anchors |
| `external/lobehub/src/store/chat/slices/message/actions/optimisticUpdate.ts`; `external/lobehub/src/store/chat/slices/plugin/actions/internals.ts` | operation-scoped optimistic mutation and builtin/MCP/Composio/LobeHub Skill tool normalization |
| `external/lobehub/src/features/Conversation/StoreUpdater.tsx`; `external/lobehub/src/features/Conversation/store/slices/message/action/sendMessage.ts`; `activeTopicDocumentContext.ts` | ConversationStore context reset/replace, display message handoff, `onTopicCreated` streaming callback and active topic document retry context |

## Prototype Delta

EK uses `?surface=chat&state=chat-execution-contract&check=ek` and promotes
Chat from DY execution-contract evidence into a source-interaction closure
artifact.

The new review state keeps DY as historical execution-contract context, DX as
historical runtime-contract context, DU as historical input-contract context and
DA/DB as historical shell context, then adds:

- provider/model execution source chain: agent config, deployment name, API mode,
  runtime provider, fetch path and backend provider route;
- explicit runtime selection priority across parent runtime, heterogeneous
  gateway, gateway and client branches;
- optimistic topic/message creation with temporary ids, replace and rollback;
- SWR/focus revalidation guard, local-newer merge, stable references and
  request-context writeback;
- tool approval / human tool result resume lineage without claiming tool
  success;
- gateway replay with operation id, last event id, history replay, token refresh
  and terminal reconcile;
- virtualized row persistence for scroll snapshot, selection and streaming
  keepMounted rows;
- input context handoff for editor recovery, context selections, page selections
  and active topic document retry context.

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css` |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/chat-ek-source-interaction-scoped.png` opened and inspected; metadata `tmp/agent-lobehub-chat-ek-scoped-screenshot-meta.json` records sha256 `a2020ff3c442f5914349c9df5025880ac56f5655b9cd516845e329bf26571393` and `740x5545` scoped capture |
| L3 DOM | `tmp/agent-lobehub-chat-ek-dom.json` records marker `chat-source-interaction-ek`, evidence `EVID-011-EK-pre`, provider/model execution chain, runtime priority, optimistic topic row, SWR guard, tool resume, gateway replay, virtual row persistence, input context handoff, `sourceInteractionClosure=true`, `forbiddenHits=[]` and `portalChromeHit=false` |
| Command | `pnpm --filter @peers-touch/prototype-portal run build` |

## Claim Boundary

`EVID-011-EK-pre` proves a Chat prototype follow-up revision with L1 source
anchors and a planned L2/L3 evidence path. It does not confirm Chat, replace
Owner judgment, create or authorize `EVID-012`, or allow Desktop / Station /
Model product migration.

It must not be used to claim real provider execution, real Station persistence,
real Gateway replay, real tool execution/resume, real virtual list persistence
or GATE-008 product parity.

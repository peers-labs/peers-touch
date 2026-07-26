# Agent Chat DY Execution Contract Follow-Up Revision

> **Evidence**: EVID-011-DY-pre
> **Status**: active Chat artifact promotion / not confirmed
> **Plan Step**: PLAN-P2 Chat execution contract follow-up / PLAN-P5 blocked precondition
> **BOM**: BOM-002 / BOM-003 / BOM-007 / BOM-012 / BOM-015
> **Spec**: SPEC-002 / SPEC-003 / SPEC-008 / SPEC-009 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014
> **Gates**: GATE-003 / GATE-004 / GATE-005 / GATE-006 / GATE-008

## Source Anchors

DY extends DX from chunk/lifecycle taxonomy into the execution and persistence
path that can corrupt Chat UX if modeled only as visual streaming.

| Source | Contract represented in DY |
| --- | --- |
| `external/lobehub/src/store/chat/slices/agentRun/actions/entries/conversationLifecycle.ts` | sendMessage creates optimistic user/assistant rows, resolves topic/thread ids, then child runtime operation owns assistant execution |
| `external/lobehub/src/store/chat/slices/agentRun/actions/dispatch/agentDispatcher.ts` | runtime selection priority: parent runtime, heterogeneous provider, gateway mode, client runtime |
| `external/lobehub/src/services/chat/index.ts` | provider/model/deployment/API mode resolve before SSE provider call |
| `external/lobehub/src/app/(backend)/webapi/chat/[provider]/route.ts` | authenticated provider route owns model runtime invocation and abort signal |
| `external/lobehub/src/features/Conversation/store/slices/generation/action.ts` | regenerate branch switching, delete-before-regenerate ordering, stop/cancel and editor temp state recovery |
| `external/lobehub/src/features/Conversation/store/slices/data/action.ts` | SWR revalidation guard while runtime is streaming, merge with local state, stable references and request-context writes |
| `external/lobehub/src/store/chat/slices/agentRun/actions/entries/conversationControl.ts` | resumeApproval and resumeToolResult start new gateway operations and retire paused ops only after successful resume |
| `external/lobehub/src/store/chat/slices/agentRun/actions/transports/gateway/gateway.ts` | gateway task connection, server operation id, token refresh and resumeOnConnect |
| `external/lobehub/src/store/chat/slices/agentRun/actions/transports/gateway/gatewayEventHandler.ts` | gateway stream/tool/step/runtime events mutate Desktop projection without treating transport close as done |
| `external/lobehub/src/app/(backend)/api/agent/stream/route.ts` | operation-scoped SSE replay using `operationId`, `lastEventId` and `includeHistory` |
| `external/lobehub/src/store/chat/slices/plugin/actions/{internals,publicApi,pluginTypes}.ts` | tool-call normalization and builtin/MCP/Composio/LobeHub Skill dispatch with operation signal and result/error persistence |

## Prototype Delta

DY adds `?surface=chat&state=chat-execution-contract&check=dy` and promotes
Chat from DX runtime-contract evidence into an execution/persistence/replay
artifact.

The new review state keeps DU as historical ChatInput context, DA/DB as
historical shell context and DX as historical streaming/lifecycle context, then
adds:

- provider/model execution identity from Settings projection and agent config,
  with no Desktop fallback model;
- optimistic topic/message flow from draft to durable user row and child
  assistant runtime operation;
- regenerate, delete-before-regenerate and branch-switch ordering;
- SWR/focus revalidation guard while streaming plus local-state merge and stable
  references;
- tool approval and human tool-result resume through gateway/client operation
  lineage;
- gateway transport replay and terminal reconcile before cleanup;
- virtualized row pinning, scroll intent and branch row persistence;
- failure-preserve behavior for draft, attachments and operation lineage.

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css` |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/chat-dy-execution-contract-scoped.png` opened and inspected; metadata `tmp/agent-lobehub-chat-dy-scoped-screenshot-meta.json` records sha256 `8bf2bfc7679e9ed4478b0270ee4d6eec762d3a8358398e5ca34324785ead8be3` and `900x2345` scoped capture |
| L3 DOM | `tmp/agent-lobehub-chat-dy-dom.json` records marker `chat-execution-contract-dy`, evidence `EVID-011-DY-pre`, provider execution, stream persistence, tool execution, gateway replay, virtualized persistence, store mutation state attributes, source-backed panels, SWR guard, delete-regenerate ordering, gateway replay, no local fallback, `forbiddenHits=[]` and `portalChromeHit=false` |
| Command | `pnpm --filter @peers-touch/prototype-portal run build` |

## Claim Boundary

DY is a prototype/evidence promotion only. It does not prove real provider calls,
real Station stream persistence, real gateway replay, real tool execution, real
virtualized-list persistence, real store mutation execution or GATE-008 product
parity.

Product migration remains blocked until Owner confirmation, `EVID-012`
authorization and PLAN-P5 entry gates pass.

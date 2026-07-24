# Agent Chat DX Runtime Contract Follow-Up Revision

> **Evidence**: EVID-011-DX-pre  
> **Status**: active Chat artifact promotion  
> **Plan Step**: PLAN-P2 prototype revision / PLAN-P5 blocked precondition  
> **BOM**: BOM-007 / BOM-012 / BOM-015  
> **Spec**: SPEC-002 / SPEC-009 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014  
> **Gates**: GATE-003 / GATE-004 / GATE-006 / GATE-008

## Source Anchors

DX is source-backed by the LobeHub runtime and conversation sources already mapped
in `chat-runtime-source-map.md`:

| Source | Runtime contract represented in DX |
| --- | --- |
| `external/lobehub/src/store/chat/agents/StreamingHandler.ts` | text, reasoning, tool_calls, grounding and stop chunk accumulation |
| `external/lobehub/src/store/chat/slices/agentRun/actions/entries/conversationControl.ts` | stop/cancel, gateway resumeApproval and paused-op cleanup |
| `external/lobehub/src/features/Conversation/store/slices/data/pendingInterventions.ts` | pending human/tool approval derivation from displayed messages |
| `external/lobehub/src/store/chat/slices/agentRun/actions/lifecycle/buildRunLifecycle.ts` | terminal vs parked lifecycle ownership |
| `docs/architecture/agent/lobehub-parity/chat-runtime-source-map.md` | Peers Station/Desktop runtime contract mapping |

## Prototype Delta

DX adds `?surface=chat&state=chat-runtime-contract&check=dx` and promotes Chat
from the DU input-contract artifact to a runtime/streaming/recovery artifact.

The new review state keeps the compact LobeHub-like Chat shell from DA/DB and the
Chat input contract history from DU, but changes the active evidence target to:

- typed streaming chunks: `text`, `reasoning`, `tool_calls`, `grounding`, `stop`
- lifecycle separation: `running`, `waiting_for_human`,
  `waiting_for_async_tool`, `transport_closed`, `done/error/abort`
- thinking stream rendered separately from final assistant text
- tool-call delta rendered as transient display state, not durable truth
- parked human approval and resume lineage
- gateway transport close rendered as degraded, not semantic success
- Station durable truth vs Desktop transient projection authority

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css` |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/chat-dx-runtime-contract-scoped.png` opened and inspected at `1280x1600`; metadata `tmp/agent-lobehub-chat-dx-scoped-screenshot-meta.json` records sha256 `47695276d7b5c025c4694a1ed0a99db78c9571b209df932d08423ef5a4f66b1d` |
| L3 DOM | `tmp/agent-lobehub-chat-dx-dom.json` records marker `chat-runtime-contract-dx`, 5 stream rows, 5 lifecycle rows, thinking stream, tool-call delta, parked approval, resume lineage, gateway transport closed, `forbiddenHits=[]`, `portalChromeHit=false` |
| Command | `pnpm --filter @peers-touch/prototype-portal run build` |

## Claim Boundary

DX is a prototype/evidence promotion only. It does not prove real `virtua`/SWR
behavior, real provider execution, Station stream persistence, tool execution,
gateway resume behavior, runtime cancellation, transport replay or GATE-008
product parity.

Product migration remains blocked until Owner confirmation, `EVID-012`
authorization and PLAN-P5 entry gates pass.

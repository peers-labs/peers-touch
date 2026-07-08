# Agent LobeHub Fullstack Parity — Capability Gap Matrix

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P1
> **Evidence**: EVID-005

---

## 1. Matrix Legend

| Status | Meaning |
| --- | --- |
| ready | Peers-Touch current source proves this capability for the audited backend/frontend scope. |
| partial | Peers-Touch has meaningful source, but parity, projection, UX, or e2e evidence is incomplete. |
| missing | Peers-Touch lacks the capability in the audited layer. |
| conflict | Current design conflicts with the target architecture and needs correction before migration. |
| deferred | Explicitly out of current implementation scope, but reserved by architecture. |

## 2. Capability Gap Matrix

| Capability | LobeHub Source | Peers-Touch Current | Status | Target | Owner | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| Home Agent entry | `src/routes/(main)/home/features/InputArea/`, `home/_layout/Body/Agent/`, `frontend-source-map.md` | `apps/desktop/src/pages/AgentChatPage.tsx`, `components/AgentSidebar.tsx` | partial | High-fidelity Home + Agent entry prototype, then product migration with runtime-owned Agent list. BOM-001 source split is mapped; product migration remains blocked until prototype confirmation. | Desktop | GATE-003/GATE-004 |
| Agent sidebar/list | `home/_layout/Body/Agent/List/AgentListContent.tsx`, `AgentItem/index.tsx`, `agent/_layout/Sidebar/Header/Agent/SwitchPanel.tsx`, `frontend-source-map.md` | `AgentChatPage.tsx` custom roster + `AgentSidebar.tsx` | conflict | Remove current double-agent-sidebar complexity in prototype; converge on one shared Agent list projection across Home and chat switcher plus one Station-owned Topic list. | Desktop | GATE-004/GATE-006 |
| Topic list/management | `group/_layout/Sidebar/Topic/`, `features/AgentTopicManager/` | `store/agentTopics.ts`, `AgentSidebar.tsx`, `chat-service` | partial | Topic sidebar plus management state matrix: create/switch/rename/delete/search/group/pin/auto-name. | Desktop/Station | GATE-002/GATE-004 |
| Chat input | `features/ChatInput/`, `features/Conversation/ChatInput/`, `routes/(main)/agent/.../MainChatInput`, `frontend-source-map.md` | `components/ChatInput.tsx`, `store/chat.ts` | partial | LobeHub-like input shell with typed action slots, context/file area, provider+model picker, loading/error states and local/device runtime controls as Desktop projection. | Desktop | GATE-004 |
| Message list and item | `features/Conversation/ChatList/`, `features/Conversation/Messages/`, `Messages/components/MessageActionBar/*`, `frontend-source-map.md` | `pages/ChatPage.tsx`, `components/MessageBubble.tsx`, `store/chat.ts` | partial | Virtualized or stable message list, streaming-safe revalidation, assistant groups, tool/intervention details, branch/continue/regenerate/delete action lineage. | Desktop | GATE-004/GATE-008 |
| Model selection | `store/aiInfra/`, `features/ModelSwitchPanel/`, `components/ModelSelect/`; `provider-model-source-map.md` | `store/provider.ts`, `store/agent.ts`, `ChatInput.tsx`, `ModelProviderSelect.tsx` | partial | Settings Provider remains source; Agent selection/display/validation uses provider+model identity everywhere. LobeHub source semantics are mapped for design; product duplicate-ID enforcement remains unverified. | Provider Runtime/Desktop | GATE-005 |
| Agent Profile/settings | `routes/(main)/agent/profile/`, `features/AgentSetting/` | `AgentSettingsModal.tsx`, `store/agent.ts`, Station `AgentConfigService` | partial | Profile/settings covers meta, prompt, opening, model, tools, knowledge, memory/workspace/runtime config. | Desktop/Station | GATE-004/GATE-006 |
| Agent config persistence | `store/agent/`, `services/agent`; `agent-config-source-map.md` | Station `AgentService`, `AgentConfigService`, Desktop `parseAgentChatConfig` | partial | Source-backed Agent config/profile/settings map is complete for design; product still must promote scattered JSON fields into documented Peers Agent config contract while preserving Station ownership. | Station/Desktop | GATE-006 |
| Memory backend | `context-engine/UserMemoryInjector.ts`, user/tool selectors | Station `MemoryService`, `MemoryHandlers`, memory persistence/tests | ready | Reuse Station Memory as source-of-truth; add Desktop projection and trace visibility. | Station/Desktop | GATE-006/GATE-008 |
| Memory UX/trace | LobeHub context injection + settings/resources surfacing | `MemorySettingsTab`, `modules/memory.ts`, `store/chat.ts` events | partial | Show memory injected/used/updated in chat trace and settings; provide recovery and rollback affordances. | Desktop/Station | GATE-004/GATE-006 |
| Knowledge/files backend | `store/file`, `store/document`, `store/library`, `KnowledgeInjector.ts`; `tool-knowledge-source-map.md` | `KnowledgeRetrievalService`, Agent knowledge bindings, workspace services | partial | Source-backed resource/RAG lifecycle is mapped for design; product still needs durable knowledge asset/index status contract and file/folder/url/notebook/workspace states. | Station | GATE-006 |
| Knowledge/files UX | `WorkingSidebar/ResourcesSection`, `AgentDocumentsGroup`, `AgentDocumentsExplorer` | `AgentSettingsModal` incomplete, `ChatPage` artifact panel | missing/partial | Prototype resources panel with folder/document/index/error states, then bind to Station contract. | Desktop | GATE-004 |
| Tool/Plugin/Skill backend | `store/tool`, builtin tools, `ToolsEngine`, `SkillEngine`; `tool-knowledge-source-map.md` | `ToolRegistryService`, `SkillService`, `LocalToolBroker`, MCP store | partial | Source-backed tool/plugin/skill/MCP semantics are mapped for design; product still needs unified manifest/policy/compatibility/approval/result/audit contract across Station and Desktop. | Station/Desktop Rust | GATE-006 |
| Tool/Plugin/Skill UX | `WorkingSidebar`, `AgentTool`, tool inspectors, skills store | `store/tool.ts`, `store/mcp.ts`, `store/skill.ts`, tool call rendering in `MessageBubble` | partial | LobeHub-like tool enablement, authorization, call progress, result, risk and recovery UI. | Desktop | GATE-004/GATE-008 |
| Runtime streaming | `context-engine`, `ChatList`, provider stream parsers; `chat-runtime-source-map.md`, `session-topic-action-map.md` | Station `TurnService`, `TurnHandlers`, Desktop `agent_turn`, `store/chat.ts` | partial | Source-backed runtime/streaming/recovery semantics are mapped for design; product still needs formal event contract for text/thinking/tool_call/tool_result/progress/error/done/abort/reconcile. | Station/Desktop Rust/Desktop | GATE-006/GATE-008 |
| Local tool bridge | LobeHub local/heterogeneous agent runtime patterns | Station `LocalToolBroker`, Desktop Rust `agent_turn`, MCP app layer | partial | End-to-end approved local tool execution with UI decision, timeout, result, and audit trace. | Desktop Rust/Station | GATE-006/GATE-008 |
| Provider fallback | LobeHub provider/model infra and error surfaces | Station ProviderService/ErrorClassifier/CredentialPool, Desktop Settings Provider | partial | Close request mapping for fallback/rotation and expose user-actionable provider errors. | Station/Desktop | GATE-005/GATE-006 |
| Workspace/files | `WorkingSidebar/Files`, `AgentDocuments`, workspace/community paths | Station `WorkspaceService`, `WorkspaceOSSService`, Desktop runtime config | partial | Workspace source-of-truth and approved local/remote file access boundary. | Station/Desktop Rust | GATE-006 |
| Runtime ownership | LobeHub store/engine split: home/session/chat/agent/tool/aiInfra/context-engine | Desktop `agentCapabilityRuntime`, `agentTopicRuntime`, page/component effects | conflict | Runtime/store owns projections; pages render. Fix runtime id mismatch and remove page-fetch ownership before product migration. | Desktop | GATE-006/GATE-008 |
| Actor#agent social reserved | LobeHub messenger/agent ecosystem patterns | Station `OwnerActorID`, visibility, DomainEvent.ActorID, ActivityPub/message docs | deferred | Reserve Actor identity, Agent identity, capability exposure, permission, event visibility; no product feature this round. | Station/Architecture | GATE-007 |
| License/attribution | LobeHub open source repo | `frontend-source-map.md`, `component-map.md` path-level references; `license-attribution.md` | implemented for design | Treat LobeHub as source-level reference by default; direct code/asset/text reuse is forbidden without explicit license review evidence and attribution. | Architecture | GATE-001/GATE-002/GATE-008 |

## 3. Current Gate Assessment

| Gate | Status | Reason |
| --- | --- | --- |
| GATE-001 LobeHub Source Coverage | implemented | Component/store/service source paths are recorded in `source-audit.md`, `frontend-source-map.md`, `component-map.md` and the dedicated backend/source maps. |
| GATE-002 Capability Matrix Complete | implemented | This matrix covers LobeHub source, Peers current, gap/status, target, owner, gate. |
| GATE-003 Prototype Runnable | pass for pending-review | `EVID-010-PROTOTYPE-REBUILD-N` records `make run-prototype`, Portal visibility and build evidence for `agent-lobehub-parity`. Owner confirmation is still missing. |
| GATE-004 Prototype Interaction Complete | pass for pending-review | `EVID-010-PROTOTYPE-REBUILD-A..N` records clickable Home/Chat/Profile/Tasks/Pages/Resources/Memory/Skills/Settings/Image/Community states. Full confirmed visual parity across every nested state remains unproven. |
| GATE-005 Provider/model Correctness | partial | Chain exists; `contract-foundation.md` defines `AgentModelRef`; `provider-model-correctness.md` defines M3 implementation rules, but product code still has paths where provider+model identity is not enforced everywhere. |
| GATE-006 Backend Architecture Complete | implemented | `design.md` defines source-of-truth, API/proto/storage/event boundaries and forbidden relationships; `decisions.md` records ownership ADRs. |
| GATE-007 Actor#agent Reserved | implemented | `design.md` reserves Actor-Agent binding, visibility, capability exposure and event scope contracts; `actor-agent-reserved-contract.md` defines M10 reserved identity/permission/event boundary without implementing social product behavior. |
| GATE-008 Product Migration Check | not-started | `migration-plan.md` defines phased product migration batches; M1-M10 pre-execution checks exist in `contract-foundation.md`, `desktop-runtime-shell.md`, `provider-model-correctness.md`, `session-topic-runtime.md`, `agent-config-profile.md`, `memory-projection-parity.md`, `knowledge-files-parity.md`, `tool-plugin-skill-parity.md`, `error-recovery-diagnostics.md`, and `actor-agent-reserved-contract.md`; `pre-implementation-readiness.md` records the PLAN-P4 claim boundary and PLAN-P5 entry criteria; `m1-implementation-kickoff.md` and `plan-p5-implementation-control-board.md` are prepared, but `agent-lobehub-parity` is only `pending-review`, not Owner-confirmed; no product implementation or product check has started. |

## 4. Architecture Implications

1. Do not rewrite Station Memory or Skill core first; they are the strongest ready backends.
2. Use `migration-plan.md` as the only PLAN-P4 entry for product migration batch order.
3. Product implementation remains blocked until the source-backed `agent-lobehub-parity` prototype is Owner-confirmed.
4. Actor#agent social remains deferred implementation but must shape identity, visibility and event contracts now.

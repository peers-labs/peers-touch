# Agent LobeHub Fullstack Parity — Source Audit

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/desktop/`, `apps/desktop/src-tauri/`, `apps/station/app/subserver/agent/`

---

## 1. Audit Scope

本轮 source audit 对齐 `tmp/agent-lobehub-fullstack-ledger.md` 的 PLAN-P0，覆盖：

- LobeHub Agent/Chat 前端与 store。
- LobeHub Provider/model 配置体系。
- LobeHub Memory、Knowledge、Tool/Plugin/Skill、File/Document、Runtime/Streaming。
- Peers-Touch 当前 Desktop Web、Desktop Rust、Station Agent 能力入口。

本文件只记录源码事实和初筛判断；差距矩阵和迁移架构后续分别落到 `integration.md` 与 `design.md`。

## 2. LobeHub Source Inventory

| BOM ID | Capability | Source Paths | First Finding |
| --- | --- | --- | --- |
| BOM-001 | Agent/Chat frontend and interaction state | `external/lobehub/src/routes/(main)/home/`, `external/lobehub/src/routes/(main)/agent/`, `external/lobehub/src/features/ChatInput/`, `external/lobehub/src/features/Conversation/` | Home、Agent rail、Topic rail、Conversation shell、ChatInput、WorkingSidebar、Profile/Settings 均为独立前端 surface；详细 source-path、交互族与 Peers ownership 已映射到 `frontend-source-map.md`。 |
| BOM-002 | Session/topic/message state | `external/lobehub/src/store/session/slices/session/`, `external/lobehub/src/store/session/slices/sessionGroup/`, `external/lobehub/src/store/chat/slices/topic/`, `external/lobehub/src/store/chat/slices/message/`, `external/lobehub/src/store/chat/slices/thread/`, `external/lobehub/src/features/Conversation/store/slices/generation/`, `external/lobehub/src/store/chat/slices/agentRun/actions/` | Session 与 Chat store 分层，Topic/message/thread 为 Chat 执行域；session 删除、切换、分组有独立 action/reducer。Detailed action semantics are mapped in `session-topic-action-map.md`. |
| BOM-003 | Provider/model config | `external/lobehub/src/store/aiInfra/`, `external/lobehub/src/store/aiInfra/slices/aiProvider/`, `external/lobehub/src/store/aiInfra/slices/aiModel/`, `external/lobehub/src/services/models.ts`, `external/lobehub/src/routes/(main)/settings/provider/` | Provider 与 model 是独立 AI Infra store；remote model fetch 会刷新 runtime provider state，模型按 provider 收集并保留能力 metadata。Detailed provider/model semantics are mapped in `provider-model-source-map.md`. |
| BOM-004 | Memory | `external/lobehub/packages/context-engine/src/providers/UserMemoryInjector.ts`, `external/lobehub/src/store/user/`, `external/lobehub/src/store/tool/selectors/tool.ts` | Memory 不是 UI 字段，而是 context-engine 注入器和工具能力的一部分；注入结果进入 message pipeline metadata。 |
| BOM-005 | Tool/Plugin/Knowledge/File | `external/lobehub/src/services/resource/`, `external/lobehub/src/services/knowledgeBase.ts`, `external/lobehub/src/services/rag.ts`, `external/lobehub/src/store/file/`, `external/lobehub/src/store/agent/slices/knowledge/`, `external/lobehub/src/store/tool/`, `external/lobehub/src/store/tool/slices/{builtin,plugin,mcpStore}/`, `external/lobehub/packages/builtin-tool-*`, `external/lobehub/packages/context-engine/src/engine/{tools,skills}/`, `external/lobehub/packages/context-engine/src/processors/ToolCall.ts` | Tool store 聚合 builtin、plugin、MCP、Composio、skills；resource/file/knowledgeBase/RAG 形成知识与文档资产平面。Detailed resource/tool semantics are mapped in `tool-knowledge-source-map.md`. |
| BOM-006 | Agent profile/config/settings | `external/lobehub/src/store/agent/`, `external/lobehub/src/store/agent/slices/agent/`, `external/lobehub/src/store/agent/slices/knowledge/`, `external/lobehub/src/store/agent/slices/plugin/`, `external/lobehub/src/features/AgentSetting/`, `external/lobehub/src/routes/(main)/agent/profile/` | Agent config 支持 optimistic update、per-agent documents、runtime env、plugin toggle、knowledge binding 和 streaming system role。Detailed config/profile/settings semantics are mapped in `agent-config-source-map.md`. |
| BOM-007 | Runtime/context/stream recovery | `external/lobehub/src/store/chat/agents/StreamingHandler.ts`, `external/lobehub/src/store/chat/agents/createAgentExecutors.ts`, `external/lobehub/src/store/chat/slices/agentRun/actions/`, `external/lobehub/src/features/Conversation/store/slices/data/pendingInterventions.ts`, `external/lobehub/packages/context-engine/src/engine/messages/MessagesEngine.ts`, `external/lobehub/packages/context-engine/src/engine/tools/ToolsEngine.ts`, `external/lobehub/packages/context-engine/src/providers/` | MessagesEngine 统一装配 system role、history、memory、knowledge、selected tools/skills、agent management、plan/todo 等上下文；ToolsEngine 做工具过滤、模型能力检查和 manifest 转换。 Streaming/runtime/recovery semantics are mapped in `chat-runtime-source-map.md`. |

## 3. LobeHub Responsibility Model

| Domain | LobeHub Responsibility Shape | Peers-Touch Migration Meaning |
| --- | --- | --- |
| Home/Agent entry | Home store owns recent, Agent list, sidebar/input UI slices. | Peers-Touch Agent 首页与侧栏不能只是 `AgentChatPage` 内部状态，应有 runtime/store projection。 |
| Session | Session store owns session CRUD, grouping, active session and sync. | Peers-Touch 需要明确 Agent session 与 Topic/message 的 durable owner。 |
| Chat | Chat store owns message, topic, thread, portal, tool, plugin, agent-run state. | Peers-Touch 当前 `chat.ts` 大 store 需要按 runtime projection 拆责任域。 |
| AI Infra | Provider/model 自成 store 和 service，runtime state 可刷新。 | Peers-Touch Settings Provider 是源，但 Agent 侧必须消费 provider+model 能力投影。 |
| Agent Config | Agent store owns config/meta/runtime env/knowledge/plugin bindings with optimistic updates. | Peers-Touch 需要把 Agent profile、model、tool、knowledge、workspace 配置整合成可验证配置闭环。 |
| Context Engine | Message pipeline 统一处理 memory、knowledge、tools、skills、history、system role。 | Peers-Touch Station 应作为 turn context 真源；Desktop 只渲染注入与 trace 结果。 |
| Tool Engine | Tool manifest、选择、模型兼容、默认工具、过滤原因有统一引擎。 | Peers-Touch Tool/MCP/Skill 需要统一 manifest、policy、approval、trace，而不是多个 UI 列表。 |

## 4. Peers-Touch Current Inventory

| BOM ID | Capability | Source Paths | First Finding |
| --- | --- | --- | --- |
| BOM-008 | Desktop Agent frontend | `apps/desktop/src/pages/AgentChatPage.tsx`, `apps/desktop/src/pages/ChatPage.tsx`, `apps/desktop/src/components/AgentSidebar.tsx`, `apps/desktop/src/components/ChatInput.tsx`, `apps/desktop/src/components/AgentSettingsModal.tsx` | 已有 Agent 页面与输入/设置组件，但信息架构和 LobeHub 的 Home/Agent/Topic/Profile 分层不一致。 |
| BOM-008 | Desktop Agent runtime/store | `apps/desktop/src/store/agent.ts`, `apps/desktop/src/store/chat.ts`, `apps/desktop/src/store/agentTopics.ts`, `apps/desktop/src/runtimes/agentCapabilityRuntime.ts`, `apps/desktop/src/runtimes/agentTopicRuntime.ts` | 当前有 Agent/model/session/message/stream 状态，但 `chat.ts` 仍承担大量运行态；runtime ownership 需要继续拆清。 |
| BOM-010 | Desktop Provider/model | `apps/desktop/src/store/provider.ts`, `apps/desktop/src/components/settings/ProviderDetail.tsx`, `apps/desktop/src-tauri/src/application/provider/`, `apps/desktop/src-tauri/src/application/models/` | Peers-Touch 已有 Settings Provider 和 model 管理，目标是把 Agent 侧消费投影做成 provider+model 唯一且同步可靠。 |
| BOM-010 | Desktop Memory | `apps/desktop/src/modules/memory.ts`, `apps/desktop/src/components/settings/MemorySettingsTab.tsx`, `apps/desktop/src-tauri/src/application/memory/` | Desktop 已有 Memory 入口，但需要和 Station MemoryService、turn context injection、UI trace 串成闭环。 |
| BOM-009 | Desktop Rust bridge | `apps/desktop/src-tauri/src/application/agent_turn/`, `apps/desktop/src-tauri/src/application/mcp/`, `apps/desktop/src-tauri/src/interface/tauri_commands/agent_turn.rs`, `apps/desktop/src-tauri/src/interface/tauri_commands/mcp.rs` | 已有 agent turn stream、MCP/local tool bridge 入口；需要纳入统一 tool/runtime/policy projection。 |
| BOM-009 | Station Agent backend | `apps/station/app/subserver/agent/agent.go`, `apps/station/app/subserver/agent/domain/`, `apps/station/app/subserver/agent/service/`, `apps/station/app/subserver/agent/handler/`, `apps/station/app/subserver/agent/infrastructure/persistence/` | Station 已有 Agent/Memory/Skill/Turn/Growth/Review/Delegation/Provider/Knowledge 服务骨架，后端不是空白，重点是闭环验证与 LobeHub parity 缺口。 |

## 5. Existing Peers-Touch Plan Sources

| Source | Current Value | Required Upgrade |
| --- | --- | --- |
| `docs/architecture/agent/agent-lobehub-blueprint.md` | 已定义 Station/Desktop Rust/Desktop Web 边界和 LobeHub 能力目标。 | 需要补 BOM/Spec/Gate/Evidence 追踪，不替代原文档。 |
| `docs/architecture/agent/execution-plans/20260616-agent-lobehub-rebuild.md` | 已列出 P0-P5 能力覆盖和架构 conformance gate。 | 需要按本 goal 重新绑定 LobeHub source path、Peers current path、Evidence 和 Traceability。 |
| `apps/station/app/subserver/agent/` | 大量后端服务已存在。 | 需要基于测试和端到端路径判断 ready/partial/missing，而不是按文件存在 claim done。 |

## 6. Initial Gap Hypotheses

| Gap ID | Related BOM | Hypothesis | Evidence Needed |
| --- | --- | --- | --- |
| GAP-001 | BOM-001/BOM-008 | Peers-Touch Agent 信息架构未达到 LobeHub Home + Agent + Topic + Profile 的清晰分层。 | `frontend-source-map.md` 已给出 source-backed target split；产品迁移仍需 Owner-confirmed prototype 与 GATE-008 product evidence。 |
| GAP-002 | BOM-003/BOM-010 | Provider/model Settings 有基础能力，但 Agent 侧模型消费投影和 provider+model 唯一性仍需 gate 验证。 | Agent dropdown/runtime config 实测与代码 trace。 |
| GAP-003 | BOM-004/BOM-009/BOM-010 | Station MemoryService 存在，但 Desktop Memory UI、turn injection、trace attribution 未形成 LobeHub 级可见闭环。 | Memory handler/service/trace/stream source audit。 |
| GAP-004 | BOM-005/BOM-009/BOM-010 | Station ToolRegistry 与 Desktop MCP 均存在，但尚未证明和 LobeHub ToolEngine 一样有统一 manifest、compatibility、approval、render、audit 闭环。 | Tool/MCP service + UI card + TurnTrace audit evidence。 |
| GAP-005 | BOM-006/BOM-008/BOM-009 | Agent config 当前字段较散，缺少 LobeHub 风格 Profile/Settings 模块化整合。 | Agent config schema、SettingsModal、Station config service 对照。 |
| GAP-006 | BOM-007/BOM-009 | Station TurnService 已有 streaming/tool loop，但需要验证 thinking/tool/error/done/abort/reconcile 全事件覆盖。 | Stream event contract 和端到端测试输出。 |

## 7. Next Audit Targets

1. 完成 LobeHub 页面/组件级 source map，定位真实 UI 组件和 layout tokens。
2. 完成 Station Agent service/handler/persistence 能力矩阵。
3. 完成 Desktop Web store/runtime/component 能力矩阵。
4. 输出 `integration.md` 差距矩阵：`ready / partial / missing / conflict / deferred`。
5. 进入 Prototype Portal 原型创建前，读取 UI Identity 并登记原型总账。

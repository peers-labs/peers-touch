# Agent LobeHub Fullstack Parity — Frontend Source Map

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P0
> **Evidence**: EVID-011-W-pre

---

## 1. Purpose

This document closes BOM-001 at the source-map level. It records the LobeHub
Home / Agent / Chat frontend surfaces that must constrain Peers-Touch prototype
fidelity and later Desktop migration.

This is source-path reference evidence only. It does not authorize direct
copying of LobeHub source, assets, product copy or brand material.

## 2. Source Coverage

| Surface | LobeHub Source | Semantics Observed | Peers-Touch Target Boundary |
| --- | --- | --- | --- |
| Home layout and hydration | `external/lobehub/src/routes/(main)/home/_layout/`, `RecentHydration.tsx`, `HomeAgentIdSync.tsx`, `Sidebar.tsx`, `SidebarContent.tsx` | Home is a persistent shell with recents, selected agent sync and sidebar state outside the composer. | `base-client` owns global shell/navigation; `agent-consumer` renders Agent entry from Station/Desktop projections. |
| Home Agent list | `external/lobehub/src/routes/(main)/home/_layout/Body/Agent/List/AgentListContent.tsx`, `AgentItem/index.tsx`, `Group/index.tsx`, `InboxItem.tsx`, `Private/List.tsx` | Agent list has inbox, pinned, custom group and private/public split; loading skeleton is list-level, not page-level. | Desktop Agent entry must not be a page-local roster; Station owns durable Agent list, Desktop owns projection and row interaction state. |
| Home recents | `external/lobehub/src/routes/(main)/home/features/Recents/`, `AllRecentsDrawer.tsx`, `Item.tsx`, `List.tsx`, `useDropdownMenu.tsx` | Recent conversations are an explicit surface with drawer, item menus and delete/rename affordances. | Session/topic recents are `agent-domain`; Desktop renders recents from Station session truth. |
| Home composer | `external/lobehub/src/routes/(main)/home/features/InputArea/index.tsx`, `InputDragUpload.tsx`, `useSend.ts`, `StarterList.tsx`, `BotIntegrationBanner.tsx`, `MessengerBanner.tsx`, `SkillInstallBanner.tsx` | Home composer reuses `ChatInputProvider` + `DesktopChatInput`, uses `agentMode`, `plus`, `modelLabel`, drag upload, starter chips and contextual banners. | Prototype and migration must keep composer as a shared input system, consuming provider/resource/tool projections instead of hardcoded page actions. |
| ChatInput action system | `external/lobehub/src/features/ChatInput/index.ts`, `ActionBar/index.tsx`, `ActionBar/config.ts`, `ActionBar/{Model,ModelLabel,Plus,Tools,Memory,Knowledge,Search,Upload,Params,Token}/`, `SendArea/`, `ControlBar/` | Actions are mapped by typed keys and can collapse/group; model, tools, memory, knowledge, upload, context-window, local/cloud/worktree and approval controls are separate action modules. | Peers Agent input should expose only actions supported by Settings Provider, resource and tool projections; local/device controls remain Desktop runtime projections. |
| Conversation provider | `external/lobehub/src/features/Conversation/ConversationProvider.tsx`, `StoreUpdater.tsx`, `store/` | Each conversation context gets an isolated store keyed by agent/topic/thread/share context; global operations are synced into local conversation state. | Desktop Page renders a conversation projection; Station remains source for persisted session/topic/message truth, Desktop runtime owns isolated UI state. |
| Agent conversation shell | `external/lobehub/src/routes/(main)/agent/features/Conversation/index.tsx`, `ConversationArea.tsx`, `ChatHydration/index.tsx`, `ThreadHydration.tsx` | Conversation shell combines drag upload/local path reference, `ConversationProvider`, `ChatList`, input, thread hydration, minimap, forwarding and URL message dispatch. | Product migration must avoid a monolithic `AgentChatPage`; shell, list, input, hydration and right rail need separate ownership. |
| Chat list | `external/lobehub/src/features/Conversation/ChatList/index.tsx`, `components/VirtualizedList`, `SkeletonList.tsx`, `AsyncError` | Message list uses SWR fetch, skips focus revalidation while streaming, has skeleton/error/welcome states and virtualized rows. | Desktop list must be streaming-safe and must not let focus refresh clobber in-memory streaming state. |
| Message rendering and actions | `external/lobehub/src/features/Conversation/Messages/`, `AssistantGroup/index.tsx`, `AssistantGroup/Tool/`, `Messages/components/MessageActionBar/useBuildActions.ts`, `User/index.tsx` | Messages support assistant groups, tool details, interventions, signal callbacks, reactions, branches, continue, regenerate, delete, edit, share, copy, TTS and selection. | Peers runtime events must support text/thinking/tool/intervention/action lineage; Desktop renders message affordances from typed event/projection state. |
| Agent input | `external/lobehub/src/routes/(main)/agent/features/Conversation/MainChatInput/index.tsx`, `AgentConfigError.tsx`, `MessageFromUrl.tsx`, `useSendMenuItems.tsx`, `features/Conversation/ChatInput/index.tsx` | Agent input selects left/right actions by current config and model capability, tracks editor instance, shows config loading/error and supports dev send-menu variants. | Provider/model correctness is required before product chat migration; values must be `provider + model`, not model ID alone. |
| Heterogeneous input | `external/lobehub/src/routes/(main)/agent/features/Conversation/HeterogeneousChatInput/` | Heterogeneous Agent input handles remote/local CLI state, quota menus, cloud/desktop branches and unavailable runtime guards. | Treat as runtime pattern only; concrete Peers implementation must go through Settings Provider, Desktop runtime and Station policy. |
| Conversation header | `external/lobehub/src/routes/(main)/agent/features/Conversation/Header/index.tsx`, `HeaderActions/`, `Tags/`, `ShareButton/`, `WorkingPanelToggle/` | Header composes tags, actions, share, open-in-app and working-panel toggle without owning conversation truth. | Header remains a renderer over Desktop/Station projections; it must not initiate hidden business-state fetches as source of truth. |
| Topic rail | `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Topic/index.tsx`, `List/Item/`, `TopicListContent/{FlatMode,ByTimeMode,ByStatusMode,ByProjectMode,ThreadList}/`, `TopicSearchBar/`, `Filter.tsx`, `ToggleGroups.tsx`, `Actions.tsx` | Topic rail supports count, revalidating indicator, context menu, search, filtering, grouping modes and thread list. | Station owns session/topic/thread state; Desktop owns filter/search/view grouping projection. |
| Agent switcher | `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Header/Agent/SwitchPanel.tsx` | Agent switcher reuses Home Agent list, splits private/public when needed and fetches list on open. | Peers should reuse one Agent list projection across Home and chat switcher; no duplicate page-local list implementation. |
| Working sidebar | `external/lobehub/src/routes/(main)/agent/features/Conversation/WorkingSidebar/index.tsx`, `ResourcesSection/`, `Files/`, `Review/`, `ParamsSection/`, `ProgressSection/` | Right panel has resources/review/files/params tabs, stable width, local/device/repo gating and collapsed-fetch gating. | `base-resource` owns resources/files; `agent-domain` owns runtime params/progress; Desktop runtime owns local/device projection. |
| Profile editor | `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx`, `AgentHeader.tsx`, `AgentTool.tsx`, `CloudHeterogeneousConfig.tsx`, `RemoteAgentConfigCard.tsx`, `EditorCanvas` | Profile editor binds avatar/name/description, provider+model `ModelSelect`, tools, heterogeneous config and prompt editor; hetero agents hide ineffective prompt editor. | Station owns Agent config; Desktop profile UI projects editable fields and must show unavailable/degraded states honestly. |
| Agent settings modal | `external/lobehub/src/routes/(main)/agent/profile/features/AgentSettings/Content.tsx`, `AgentSettings/index.tsx`, `external/lobehub/src/features/AgentSetting/AgentSettingsContent.tsx` | Settings shell separates opening/self-iteration/settings content and uses optimistic update patterns. | M5 must use Station-owned typed config patch semantics and expose profile/settings as one coherent Agent config surface. |

## 3. Interaction Taxonomy

| Interaction Family | Source Evidence | Required Prototype / Migration Semantics |
| --- | --- | --- |
| Agent switch | `SwitchPanel.tsx`, Home `AgentListContent.tsx` | One shared Agent list projection with active, grouped, pinned, private/public and loading states. |
| Topic switch/search/group | `Sidebar/Topic/index.tsx`, `TopicSearchBar`, `TopicListContent/*` | Topic rail must support search, grouped modes, active row, context menu and revalidation indicator. |
| Send and stop | Home `InputArea/useSend.ts`, Agent `MainChatInput`, Conversation `ChatInput` | Send flows through current agent/context/model; stop maps to runtime operation state, not local button-only state. |
| Retry/regenerate/continue/branch | `MessageActionBar/actions/*`, `features/Conversation/store/slices/generation/action.ts` | Message actions must preserve action lineage and map to Station-owned runtime actions during migration. |
| Tool call/intervention | `Messages/AssistantGroup/Tool/*`, `Intervention/*`, `features/Conversation/store/slices/data/pendingInterventions.ts` | Tool approval/result/error must be explicit typed runtime states; unresolved states cannot be rendered as success. |
| File/resource attachment | Home `InputDragUpload.tsx`, ChatInput `ActionBar/Upload`, WorkingSidebar `ResourcesSection` | Web UI may select/request resources; durable truth and local path authority stay in Station/Desktop Rust. |
| Model selection | `ProfileEditor/ModelSelect`, ChatInput `ActionBar/Model`, `ModelLabel` | UI identity is `provider + model`; available options come from Settings Provider projection. |
| Local/device workspace | ChatInput `ControlBar/*`, WorkingSidebar gating | Local/cloud/device/worktree controls are Desktop runtime projections and cannot become Station business truth. |

## 4. Ownership Mapping

| Capability | Peers Owner | Reason |
| --- | --- | --- |
| Global shell, nav, overlays, popovers | `base-client` | LobeHub Home/Agent surfaces reuse global navigation and modal/popover primitives. |
| Provider and model registry | `base-settings` | LobeHub aiInfra is a dedicated provider/model layer; Peers maps this to Settings Provider projection. |
| Files, pages, uploads, resources | `base-resource` | WorkingSidebar resources/files and upload actions are cross-Agent resources, not chat-local state. |
| Agent profile/config/session/topic/message/runtime | `agent-domain` | LobeHub separates Agent config, Conversation context and Chat runtime; Peers Station owns business truth. |
| Agent UI consumption of providers/resources/tools/settings | `agent-consumer` | Agent pages render projections from base modules plus Station Agent domain. |
| LobeHub marketplace/community/account/billing | `external/deferred` | Useful for fidelity and source-path reference only; product semantics are out of this Agent migration scope. |

## 5. Peers-Touch Migration Implications

1. M2 Desktop Runtime Shell must split Agent workbench into Home/Agent list, Topic rail, Conversation shell, ChatList, Input, Header and WorkingSidebar renderers.
2. M3 Provider/model correctness must land before real chat migration because both `ProfileEditor` and ChatInput actions depend on provider+model identity.
3. M4 Session/Topic/Message Runtime Closure must preserve LobeHub's streaming-safe list behavior and action lineage for regenerate/continue/branch/delete.
4. M5 Agent Config/Profile Parity must expose model, tools, prompt/opening and heterogeneous/unavailable states through a Station-owned config contract.
5. M7/M8 Knowledge/Tool migration must treat WorkingSidebar and AssistantGroup Tool detail as typed projections over Station/Desktop Rust truth.

## 6. Non-Replication Notes

- Use LobeHub paths as source-level references and attribution anchors only.
- Do not copy LobeHub brand assets, copy text, marketplace data, billing/account flows or proprietary icons.
- Direct source reuse requires separate SPEC-014 license review evidence before implementation.

## 7. BOM-001 Claim Boundary

BOM-001 is implemented for design as a source-backed frontend source map.

This does not prove product parity, visual confirmation, Owner confirmation or
GATE-008 product migration. It only satisfies the PLAN-P0 frontend source
coverage needed to keep prototype and migration work tied to LobeHub source.

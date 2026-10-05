# Modern Chat Agent V1 First Useful Answer — Source-Level Implementation Manual

> **Status**: historical baseline
> **Version**: v1.0
> **Created**: 2026-08-15 | **Updated**: 2026-10-05
> **Owner**: Peers-Touch Agent Team
> **Worktree**: `<repo-root>`
> **Branch**: `feat/p0-streaming-runtime-message-actions`
> **Current execution authority**: none; superseded by
> [`20261001-minimum-usable-agent-chat/plan.md`](./20261001-minimum-usable-agent-chat/plan.md)

---

## 1. Purpose

This manual replaces the previous module-count delivery method for the first
Modern Chat Agent product loop.

The previous method produced stores, pages, services, and handlers across many
named capability modules, but it did not prove that a user could see and
complete the corresponding product workflows. V1 therefore delivers one
vertical journey before any additional Agent capability is started:

```text
configure a Direct Model provider
  -> select provider + model on an Agent
  -> save and read back Agent readiness
  -> start a draft topic
  -> send one prompt
  -> observe real thinking/text streaming and terminal state
  -> restart Desktop
  -> reopen the same Station-backed topic and answer
```

The plan is source-level: every visible behavior is tied to concrete LobeHub
reference paths, current Peers paths, an owning runtime/state machine, a
cutover obligation, and executable evidence.

This document is the V1 execution entry. The following documents remain inputs,
not substitutes for this manual:

- `20260815-v1-visual-replica-contract.md` (deferred visual hardening; not a
  functional execution prerequisite)
- `../modern-chat-agent/product-definition.md`
- `../modern-chat-agent/experience-contract.md`
- `../modern-chat-agent/product-state-model.md`
- `../modern-chat-agent/acceptance-matrix.md`
- `../lobehub-parity/frontend-source-map.md`
- `../lobehub-parity/provider-model-source-map.md`
- `../lobehub-parity/chat-runtime-source-map.md`
- `../lobehub-parity/agent-config-source-map.md`
- `../lobehub-parity/migration-plan.md`
- `20260616-agent-lobehub-rebuild.md`

`20260616-agent-lobehub-rebuild.md` remains the broad capability inventory.
It no longer authorizes horizontal implementation of multiple modules before
the V1 journey is complete.

## 2. Claim Boundary

V1 may claim only:

> A Desktop user can configure one Direct Model provider, bind one ready model
> to an Agent, receive a genuine streamed answer in the production Agent UI,
> and reopen the same durable topic after Desktop restart.

V1 does not claim:

- full LobeHub parity;
- MCP, Skill, Memory, Knowledge, Tasks, Pages, Artifact, Marketplace, Voice,
  Connector, or external CLI runtime parity;
- Mobile product delivery;
- multi-Agent collaboration;
- provider fallback/rotation beyond visible failure and retry;
- browser equivalence;
- formal Acceptance Framework coverage, which is a later quality workstream.

Formal Acceptance automation may land after V1 functionality. Runtime
self-verification cannot be deferred: every workstream below must run its
named product scenario before it can be marked complete.

## 3. Authoritative Inputs

### 3.1 Product contracts

| Source | V1 requirement |
|---|---|
| `../modern-chat-agent/product-definition.md` | MCA-P01 setup/readiness, MCA-P02 persistence, MCA-P03 streaming, MCA-P09 capability transparency |
| `../modern-chat-agent/experience-contract.md` | MCA-J01 First Useful Answer and the Agent/Topic/Conversation/Inspector anatomy |
| `../modern-chat-agent/product-state-model.md` | readiness, draft topic, active turn, terminal, failure, recovery states |
| `../modern-chat-agent/acceptance-matrix.md` | provider readback, stream evidence, restart readback, unsupported-state rejection |

### 3.2 Architecture contracts

| Source | Constraint |
|---|---|
| `../agent-lobehub-blueprint.md` | LobeHub is the behavior blueprint; Peers preserves Client -> Model -> Station boundaries |
| `../provider-station-ownership/design.md` | Station owns provider configuration, credentials, and provider execution |
| `../../boundaries/station-desktop-scope-boundary.md` | Desktop Web renders and initiates; Rust bridges local process/network concerns; Station owns durable business truth |
| `../../../client/desktop/runtime-projections.md` | pages are pure renderers; runtimes own bootstrap, events, and reconciliation |
| `../../../client/common/ui-identity/modules/agent/README.md` | one continuous Agent workspace with one Agent rail, one Topic rail, dominant center rail, optional inspector |
| `../../../client/desktop/provider-model-target-architecture.md` | provider + model is a compound runtime identity |

### 3.3 LobeHub reference boundary

Canonical reference repository:

```text
https://github.com/lobehub/lobehub.git
```

Inspected revision:

```text
8412f49ec0
```

LobeHub is read-only reference evidence. This plan adopts behavior and state
semantics. It does not authorize copying source text, assets, brand identity,
or implementation internals without separate license evidence.

## 4. V1 User Journey Contract

### 4.1 Starting context

- Desktop is authenticated to one Station.
- No usable Agent configuration is assumed.
- The Station provider catalog may expose Ark, but the actor may not yet have a
  provider record or credential.
- The user may arrive in Agent Chat before visiting Settings.

### 4.2 Ordered journey

| Step | User action | Required visible response | Durable result |
|---|---|---|---|
| V1-J01-01 | Open Agent | Agent shell appears with Agent rail, Topic rail, center conversation rail; readiness is resolving | none |
| V1-J01-02 | Select an Agent with no ready model | Composer is blocked by one contextual readiness surface | none |
| V1-J01-03 | Open Provider recovery action | Settings opens directly on the required provider | none |
| V1-J01-04 | Enter Ark key and save/check | Saving then configured/ready state is visible; invalid key remains actionable | actor-scoped provider record + credential |
| V1-J01-05 | Return to Agent Profile and choose Ark + SeedPro 2.1 | compound provider/model selection is visible; save state is saving/saved/failed | Station Agent config |
| V1-J01-06 | Return to Chat and click New Topic | an empty draft topic is visible; no Station conversation exists yet | local draft only |
| V1-J01-07 | Send `Reply with exactly V1_OK` | draft becomes accepted conversation; user message, thinking/progress, incremental text, and terminal completion appear | Station conversation, turn, messages, events |
| V1-J01-08 | Switch topic and return | accepted message remains visible; draft/stream state is not lost | Station readback |
| V1-J01-09 | Restart Desktop | same Agent, selected model, topic, and `V1_OK` answer rehydrate | Station readback |

### 4.3 Failure and recovery

| Failure | Required behavior | Forbidden behavior |
|---|---|---|
| Provider has no actor record | first save creates the actor-scoped provider record, then stores credential | return `provider record not found` to the user |
| Missing/invalid Ark key | block send and show one Provider recovery action | show model as ready or create a failed assistant bubble first |
| Provider disabled | model disappears from ready choices; Agent readiness becomes blocked | silently fall back to another provider |
| Model disabled/missing | Agent config remains visibly unresolved | keep stale model selectable as ready |
| Network failure before Station accepts | preserve composer draft and local draft topic | create durable success-looking topic |
| Disconnect after Station accepts | show reconnecting/reconciling; recover by conversation/event cursor | ask user to resend accepted input |
| User cancels active turn | show cancelled terminal state; partial text is labeled partial | show completed or continue consuming silently |
| Provider error | preserve user message, show typed provider error and retry | generic toast-only failure |
| Desktop restart during/after turn | reconcile from Station; never reconstruct accepted truth only from local cache | drop accepted topic/messages |

## 5. Production Surface Anatomy

Pixel-level structure, fixed viewports, source metrics, DOM anchors, computed
style manifests, screenshot cells, and interaction scripts are governed by the
deferred visual hardening contract:

- `20260815-v1-visual-replica-contract.md`

The historical `agent-lobehub-parity` prototype and its generated evidence were
retired after the confirmed Modern Chat Agent prototype became authoritative.
V1 functional implementation must preserve the accepted surface anatomy and
make every user action visible and operable, while pixel-level hardening remains
deferred until the planned functional journeys are closed.

V1 replaces the current page-owned, nested Agent UI with this production tree:

```text
AgentChatPage                           # pure Page renderer
└─ AgentWorkbench
   ├─ AgentRail                        # 230px / 48px
   │  ├─ AgentRailHeader
   │  ├─ AgentSearch
   │  └─ AgentList
   ├─ TopicRail                        # 230px / 48px
   │  ├─ AgentIdentitySummary
   │  ├─ NewTopicAction
   │  ├─ OpenProfileAction
   │  ├─ TopicSearch
   │  └─ TopicList
   ├─ ConversationRail                # dominant, min-width protected
   │  ├─ ConversationHeader
   │  ├─ ReadinessSurface
   │  ├─ MessageTimeline
   │  ├─ TurnActivity
   │  ├─ RecoverySurface
   │  └─ AgentComposer
   └─ AgentInspector                   # contextual, optional
      ├─ ProfileSummary
      ├─ TurnDetails
      └─ UsageDiagnostics
```

Rules:

- Desktop Shell owns the Agent/Atelier/Orchestration module navigation.
- `AgentWorkbench` owns no durable business truth.
- Agent and Topic rails are adjacent layout rails with hairline boundaries,
  not floating cards.
- The center rail owns its scroll boundary and fixed composer.
- Narrow mode collapses secondary rails; it never overlays or clips the center
  composer.
- Profile is an Agent route/surface, not a nested copy of the entire Agent
  shell.
- Provider Settings remains a Settings surface. Agent readiness links to it
  with provider context.

## 6. Source-Level Behavior Map

### 6.1 Provider setup and readiness

| Concern | LobeHub source behavior | LobeHub source paths | Peers current state | V1 target |
|---|---|---|---|---|
| Provider projection | provider list/detail/runtime config are separate projections; mutations refresh the relevant SWR keys | `src/store/aiInfra/slices/aiProvider/action.ts`, `selectors.ts`, `src/services/aiProvider/index.ts` | `store/provider.ts` owns one active detail and page components call `loadProviders()` | `agentCapabilityRuntime` bootstraps provider/model readiness and reconciles after provider mutations |
| First activation | enable/update is a provider mutation before credential-dependent use | `toggleProviderEnabled`, `updateAiProvider`, `updateAiProviderConfig` | catalog provider may be visible without actor record; direct credential set returns provider-record-not-found | Station update/credential operation becomes one transactional application command or BFF sequence with typed rollback |
| Credential editing | form initializes only when provider identity changes; updates expose saving state | `ProviderConfig/index.tsx` | `ProviderDetail.tsx` edits key/base URL; state ownership is split across component and store | provider form has `loading/editing/saving/checking/ready/invalid/error`; no stale prior-provider values |
| Connection check | latest form values are saved before check; result is explicit | `ProviderConfig/Checker.tsx` | checker and update paths are not one readiness transaction | check returns typed provider readiness used by Agent readiness |
| Model projection | enabled provider+model list is built from runtime state; remote fetch preserves explicit enabled state | `aiModel/action.ts`, `aiModel/selectors.ts` | `listAvailableModels()` can expose catalog models even without credential | ready Agent models require enabled provider + configured credential + enabled chat model |
| Model picker | searchable grouped panel; provider+model is selected together; empty state links to Settings | `features/ModelSwitchPanel/**` | multiple basic selects and duplicated fallback rules | one `AgentModelPicker` consumes compound `AgentModelRef` and readiness reasons |

Required Peers paths:

- `apps/station/app/subserver/agent/service/provider_config_service.go`
- `apps/station/app/subserver/agent/service/credential_config_service.go`
- `apps/station/app/subserver/agent/handler/provider_handler.go`
- `apps/desktop/src-tauri/src/application/provider/`
- `apps/desktop/src/store/provider.ts`
- `apps/desktop/src/store/agent.ts`
- `apps/desktop/src/runtimes/agentCapabilityRuntime.ts`
- `apps/desktop/src/components/settings/ProviderDetail.tsx`
- `apps/desktop/src/components/ModelProviderSelect.tsx`

### 6.2 Agent Profile configuration

| Concern | LobeHub source behavior | LobeHub source paths | Peers current state | V1 target |
|---|---|---|---|---|
| Profile composition | compact header + runtime config + prompt editor; runtime-specific controls are conditionally real, not decorative | `routes/(main)/agent/profile/features/ProfileEditor/index.tsx`, `AgentHeader.tsx`, `EditorCanvas/index.tsx` | `AgentProfilePage.tsx` is ~2700 lines with many independent save callbacks | split profile renderer into identity, runtime config, prompt sections driven by one Agent config projection |
| Model save | `ModelSelect` writes provider+model through `updateAgentConfigById` | `ProfileEditor/index.tsx`, `store/agent/**` | provider and model handlers also write a second model config key | one Station Agent config mutation persists compound provider/model; delete parallel model config write |
| Save state | scoped editor store serializes saves and exposes saving/saved/failed/retry | `profile/features/store/action.ts`, `EditorCanvas/index.tsx` | independent timers, reloads, and toasts can race or hide failure | one versioned save state per Agent with retry of the exact failed patch |
| Readiness | unavailable runtime config is hidden or represented as unavailable | `ProfileEditor/index.tsx` conditional runtime branches | empty Select can look like a renderer bug; readiness is derived locally | readiness projection names provider, credential, model, and runtime blocker |

Required Peers paths:

- `model/domain/agent/agent.proto`
- `apps/station/app/subserver/agent/service/agent_service.go`
- `apps/station/app/subserver/agent/service/agent_config_service.go`
- `apps/desktop/src-tauri/src/application/agent_turn/`
- `apps/desktop/src/store/agent.ts`
- `apps/desktop/src/pages/AgentProfilePage.tsx`
- `apps/desktop/src/components/AgentSettingsModal.tsx`
- `apps/desktop/src/services/agent-runtime-config.ts`

### 6.3 Draft topic and first send

| Concern | LobeHub source behavior | LobeHub source paths | Peers current state | V1 target |
|---|---|---|---|---|
| Context | conversation context is explicit: agent/topic/thread | `features/Conversation/ConversationProvider.tsx`, `useAgentContext`, `messageMapKey` | global selected Agent/session state is read from multiple stores | `AgentConversationRef` is resolved once by runtime and passed to renderer |
| Draft | input state is local until send; send wrapper forwards context and receives `onTopicCreated` during lifecycle | `Conversation/store/slices/message/action/sendMessage.ts` | draft session keys use more than one format and are promoted inside `chat.ts` | one `draft:<agent-id>:<id>` shape; promotion happens exactly once on Station acceptance |
| Send admission | config loading/readiness blocks send before execution | `MainChatInput/index.tsx`, `AgentConfigError` | composer can derive fallback model from global defaults | send uses saved Agent provider+model only; unresolved config blocks before optimistic message |
| Topic hydration | route/topic state synchronizes without owning message truth | `ChatHydration/**` | page calls `bootstrapSession()` and `loadAgents()` on mount | runtime bootstrap/reconcile owns topic/message hydration |

Required Peers paths:

- `apps/desktop/src/store/chat.ts`
- `apps/desktop/src/store/agentTopics.ts`
- `apps/desktop/src/runtimes/agentTopicRuntime.ts`
- `apps/desktop/src/runtimes/agentCapabilityRuntime.ts`
- `apps/desktop/src/pages/AgentChatPage.tsx`
- `apps/desktop/src/components/ChatInput.tsx`
- `apps/desktop/src/components/composer/ChatComposer.tsx`

### 6.4 Streaming and terminal state

| Concern | LobeHub source behavior | LobeHub source paths | Peers current state | V1 target |
|---|---|---|---|---|
| Timeline projection | message rows and operation state are separate but share one conversation context | `ConversationArea.tsx`, `ConversationProvider.tsx`, `messageState/selectors.ts` | temporary assistant message is mutated by ad hoc stream events | typed turn projection applies sequenced events to a stable turn/message identity |
| Progress | thinking/tool/progress have distinct states | `Conversation/components/Thinking/**`, operation selectors | Station emits progress/thinking/text/done but persistence/replay is incomplete | render thinking/progress separately; persist/reconcile terminal facts |
| Terminal | one settled state closes the operation and triggers follow-up/revalidation | `AssistantTurnSettledWatcher.tsx`, operation state | `onComplete` clears buffers and separately reloads sessions | terminal event commits projection once, then runtime reconciles Station |
| Cancellation | stop is a first-class operation | `ChatInput/store/action.ts`, generation operations | cancel flag stops BFF reading; durable cancelled state is not proven | Station turn terminal status and Desktop projection both become cancelled |
| Reconnect | running operation is reattached on topic load | `useGatewayReconnect`, `useScheduledRunWatch` | periodic topic reload exists; event replay is not wired to UI closure | replay from durable cursor and reconcile snapshot before declaring recovered |

Required Peers paths:

- `model/domain/agent/turn_stream.proto`
- `apps/station/app/subserver/agent/handler/turn_handler.go`
- `apps/station/app/subserver/agent/service/turn_service.go`
- `apps/station/app/subserver/agent/service/conversation_service.go`
- `apps/desktop/src-tauri/src/application/agent_turn/mod.rs`
- `apps/desktop/src/services/eventStream.ts`
- `apps/desktop/src/store/chat.ts`

### 6.5 Restart and durable readback

| Concern | LobeHub behavior | Peers current state | V1 target |
|---|---|---|---|
| Agent config | server-backed Agent config hydrates Profile and Chat | Agent store reload exists; page triggers it | session runtime bootstraps Agent projection before page visibility |
| Topics | topic list is fetched and active route/topic is synchronized | `agentTopicRuntime` reconciles, while page also bootstraps sessions | runtime is sole bootstrap/reconcile owner |
| Messages | server message snapshot is read into conversation context | local Rust cache can mask Station readback | Station conversation/messages are authoritative; cache is acceleration only |
| In-flight turn | operation reconnects or reconciles terminal state | no proven restart recovery | runtime asks Station for turn/conversation events and terminal message |

## 7. State Ownership

| State | Owner | Desktop projection | Page responsibility |
|---|---|---|---|
| provider record, credential status, model enabled state | Station | `provider` store via `agentCapabilityRuntime` | render/configure |
| Agent identity and provider+model config | Station | `agent` store via `agentCapabilityRuntime` | render/edit |
| topic/conversation metadata | Station after acceptance | `agentTopics` store via `agentTopicRuntime` | select/search |
| unsent composer draft | Desktop Web local interaction state | scoped composer store | edit/cancel |
| accepted messages and terminal turn | Station | `chat` projection via stream + reconcile | render/actions |
| current stream connection and local cancellation transport | Desktop Rust | typed stream adapter | none |
| panel open/closed, focus, scroll | Desktop Web local UI state | workbench local store | render/interact |

No page may call `loadAgents`, `loadModels`, `bootstrapSession`, or equivalent
mount-time business fetch as the primary initialization path.

## 8. Workstreams

### V1-WS1: Provider readiness closure

Responsibility:

- make catalog provider activation, credential save, connection check, model
  projection, and Agent readiness one coherent state machine.

Deliverables:

1. First credential save creates/updates the actor provider record before
   credential registration.
2. Provider mutation returns typed readiness:
   `unconfigured | saving | checking | ready | invalid | unavailable`.
3. Available Agent models exclude unconfigured/disabled providers.
4. Provider mutation triggers `agentCapabilityRuntime.reconcile`.
5. Provider UI exposes inline save/check/retry feedback.

Failure behavior:

- invalid credential remains editable and does not mark Agent ready;
- network/check failure preserves unsaved form values;
- provider disable invalidates dependent Agent readiness without silent
  fallback.

Evidence:

- Station provider unit/integration test;
- Rust provider bridge test;
- provider save/readback through Desktop gateway;
- native Settings screenshot and state readback.

Dependencies: none.

Current progress (2026-08-15):

- Station credential registration now materializes a catalog provider and
  writes provider key material + credential-pool metadata in one transaction.
- Agent available-model projection now requires provider readiness and exposes
  chat models only.
- CLI models require an installed CLI binary; Ollama is explicitly API-keyless.
- Desktop `agentCapabilityRuntime` now owns actor-scoped Provider/Model/Agent
  bootstrap; Provider readiness is a typed projection.
- Real Station evidence passed:
  unconfigured Ark models `0` -> credential set -> Ark chat models visible ->
  Ark stream returned `WS1_OK`.
- Desktop Rust gateway readback passed:
  Ark `version=0/not_configured/0 models` -> update ->
  `version=1/configured/2 chat models`.
- Remaining before WS1 completion: native Settings save/check/readiness
  interaction. The current dev binary has no attachable bundle ID, so
  accessibility-driven inspection could not be performed without falling back
  to forbidden coordinate automation.

### V1-WS2: Compound Agent config and readiness projection

Responsibility:

- persist one authoritative Agent runtime configuration and expose one
  readiness result to Profile and Chat.

Deliverables:

1. `provider_id + model_id` is the only model identity.
2. Profile save uses one Station mutation with version/conflict semantics.
3. Parallel `setModelConfig("agent:<name>")` storage is deleted.
4. Save state is `idle | dirty | saving | saved | failed | conflict`.
5. Chat reads the saved Agent config; it does not choose a global fallback
   model.

Failure behavior:

- duplicate model IDs remain disambiguated by provider;
- failed save retains draft and provides Retry;
- stale version surfaces conflict instead of overwriting.

Evidence:

- save/readback/restart test;
- duplicate-model selector test;
- tree search proves parallel Agent model-config writes are removed.

Dependencies: V1-WS1.

Current progress (2026-08-15):

- Station Agent v1 contract and persistence now carry an optimistic-concurrency
  `version`; stale updates return typed HTTP 409 conflict.
- Desktop Agent core CRUD reads and mutates Station Agent records; Rust
  `agents.json` is now a local projection for selected/default UI preferences,
  not the Agent configuration authority.
- Profile provider/model changes use one Station Agent update and expose
  `saving | saved | failed | conflict`.
- Chat send/regenerate/retry resolve the selected Station Agent's exact
  provider+model pair and block before optimistic messages when it is missing
  or unavailable.
- The parallel `agent:<name>` model-config write and all Chat
  `defaultModel/availableModels[0]` fallbacks are removed.
- Runtime evidence passed:
  create `version=1` -> update provider/model `version=2` -> stale
  `version=1` update returns 409 -> Desktop process restart reads back
  `ark + doubao-pro-256k + version=2`.
- Duplicate model IDs are covered by a compound provider+model selector test.
- Verification found and removed the remaining local-authority package paths:
  duplicate/import now create through authenticated Station mutations, and
  export reads the current Station Agent.
- Station Proto JSON boundary values are normalized before entering Desktop:
  visibility is `private | workspace` and optimistic-concurrency version is a
  number, including after restart/readback.
- Real Desktop gateway evidence passed:
  create -> export -> duplicate -> import -> list/readback preserved
  `ark + doubao-pro-256k + medium + private + version=1`; all temporary records
  were deleted after verification.
- Focused gates passed: Rust Agent mapping/package tests `2/2` with no ignored
  obsolete local-authority tests, TS readiness/compound-model tests `6/6`,
  Desktop check, and Station handler/service tests.

### V1-WS3: Agent runtime shell atomic replacement

Responsibility:

- replace the current page-owned shell with the Agent UI Identity workbench.

Deliverables:

1. `AgentChatPage` becomes a pure renderer.
2. Agent rail, Topic rail, Conversation rail, and optional Inspector are
   separate focused components.
3. `agentCapabilityRuntime` owns Agent/provider/model bootstrap and reconcile.
4. `agentTopicRuntime` owns topic/message bootstrap and reconcile.
5. Profile renders within the Agent route without duplicating global shell.
6. Wide and narrow layouts preserve center composer usability.

Failure behavior:

- runtime loading renders stable skeletons;
- empty Agent/topic states provide a valid next action;
- hidden keep-alive surfaces ignore zero-width resize samples.

Evidence:

- component tests for rail state and narrow transitions;
- no mount-time business fetch search;
- functional component tests and native interaction evidence for every V1
  action; pixel/computed-style cells remain deferred.

Dependencies: V1-WS2 contract shape may proceed in parallel with component
extraction, but cutover waits for V1-WS2.

Current progress (2026-08-15):

- `AgentChatPage.tsx` is a pure 9-line renderer over `AgentWorkbench`.
- The previous monolithic page shell was deleted and replaced by focused
  `AgentRail`, `TopicRail`, `ConversationRail`, `AgentInspector`, and shared
  `PanelToggleDock` boundaries under Agent component ownership.
- `agent-topic` is session-scoped, bootstraps after Agent capability
  projection, listens for selected-Agent changes, reconciles every 60 seconds,
  and resets actor-scoped topic projection on teardown.
- `AgentSidebar` no longer loads Agent, topic, or session-group business state
  from mount effects; user-triggered mutation refreshes remain.
- Wide/narrow/zero-width layout tests and page/runtime ownership contract tests
  pass `6/6`; Desktop check and production build pass.
- Native interaction and hidden-render sampling remain deferred to V1-09 per
  the user-confirmed functional-first sequencing.

### V1-WS4: Draft topic admission and promotion

Responsibility:

- preserve user intent before acceptance and promote a draft exactly once.

Deliverables:

1. One draft key format keyed by Agent identity.
2. New Topic creates no Station conversation.
3. Send admission resolves saved Agent readiness before optimistic messages.
4. `conversation_created` atomically replaces draft identity in topic,
   operation, buffer, and route projections.
5. Network failure before acceptance preserves draft and input.

Failure behavior:

- double click/Enter cannot create duplicate conversations;
- a rejected send does not leave a success-looking topic;
- topic switch during send keeps accepted operation visible.

Evidence:

- reducer/store tests for promotion and duplicate delivery;
- Station conversation count before/after accepted first send;
- native workflow readback.

Dependencies: V1-WS2, V1-WS3.

Current progress (2026-08-15):

- All Agent drafts use `draft:<encoded-agent-id>:<nonce>` through one helper;
  legacy `agent:<name>:<timestamp>` and synthetic `session-<timestamp>` paths
  were removed.
- New Topic mutates only Desktop Chat/Topic projections. Real Station evidence
  kept active conversation count at `0 -> 0` before send.
- Send admission resolves the saved compound Agent model before optimistic
  messages; missing readiness keeps the composer draft.
- The first accepted send emitted `conversation_created` and moved active
  Station conversation count `0 -> 1`.
- Chat session, operation, stream buffer, and Topic projection promote through
  one idempotent draft-to-conversation mapping; replayed promotion is covered
  by tests.
- Obsolete unused `AgentList`, `SessionList`, and `saveCurrentTopic` local
  authority paths were deleted.
- Draft/admission/promotion tests pass `10/10`; combined focused Agent tests
  pass `19/19`; Desktop check and production Vite build pass.
- The initial Station stream emitted no text/done because the test Agent had
  been changed to the catalog model `doubao-pro-256k`, which was visible but
  not executable by the actor's Ark credential. The Agent was restored to the
  user-provided endpoint `ep-20260623145021-n4xdm` before WS5 runtime proof.

### V1-WS5: Typed stream, terminal, cancel, and reconcile

Responsibility:

- turn Station stream facts into a durable, recoverable Desktop projection.

Deliverables:

1. Typed events cover conversation-created, progress, thinking, text, error,
   cancelled, and done.
2. Every event has stable turn/conversation identity and monotonic sequence.
3. user and assistant messages persist provider+model identity.
4. terminal status is persisted once and drives UI completion.
5. cancellation reaches Station and persists cancelled terminal state.
6. reconnect/restart replays by cursor then reconciles conversation snapshot.

Failure behavior:

- duplicate events are idempotent;
- partial output remains labeled partial;
- transport closure without terminal event becomes reconciling, not complete;
- retry starts a new attempt linked to the failed source.

Evidence:

- Station stream/persistence tests;
- Rust bridge stream/cancel tests;
- Desktop reducer replay/idempotency tests;
- real Ark run showing multiple event frames and durable terminal readback.

Dependencies: V1-WS4.

Current progress (2026-08-15):

- The test Agent is restored to the real Ark endpoint
  `ep-20260623145021-n4xdm`; a live run returned exactly `WS5_OK`.
- Station preallocates one turn identity before `conversation_created`.
  Every live event carries `turnId + conversationId + agentId + seq`.
- Turn events are persisted before delivery. A real Ark run produced monotonic
  live and durable events from `conversation_created` through `done`, with
  exactly one terminal event.
- `/agent/conversation/events` now returns cursor catch-up instead of blocking
  forever after writing buffered data; replay from `after_seq=12` returned
  text/progress/done plus `catchup_done`.
- `server.Response.Flush()` is implemented by Hertz and native adapters.
  Event-stream responses switch to chunked output before first write, so turn
  identity is available while the provider call is still running.
- Desktop projects turn/conversation identity and last event sequence into the
  operation, rejecting duplicate/out-of-order events.
- Explicit Desktop cancellation now carries the resolved turn ID to Station.
  Real evidence persisted turn status `cancelled` and one durable
  `cancelled` terminal (`conversation_created, progress, progress, cancelled`).
- Transport EOF without terminal emits `reconciling`; Desktop keeps the
  operation non-terminal instead of declaring success.
- Proto `TurnStatus` now includes `CANCELLED`; generated Go/TS contracts were
  refreshed, and unrelated generated ecosystem files were removed.
- Desktop cursor replay while reconciling is implemented: Rust `replay_conversation_events_stream`
  reads Station SSE catchup from `/sub-agent/agent/conversation/events` and emits events on a
  replay stream ID; Desktop Web `streamAgentTurn` listens for `reconciling`, starts replay with
  `after_seq = lastEventSeq`, forwards events through seq-idempotent `forwardEvent`, and settles
  on `catchup_done`/`done`/`cancelled`/`error` via a `settled` flag that prevents double callback.
- User, assistant, tool, and CLI messages all persist `model_name` via an extended
  `persistMessage` signature; `messagesToJSON` exposes it in list responses;
  `cachedMessageToChatMessage` maps it to `ChatMessage.model` for UI readback.
- Remaining before WS5 runtime evidence: native Tauri verification under V1-AS05/AS06.

### V1-WS6: Restart hydration and old-path deletion

Responsibility:

- prove Station truth survives Desktop restart and remove split-brain paths.

Deliverables:

1. restart bootstraps Agent readiness, topics, and selected conversation from
   runtime owners;
2. messages are read back from Station;
3. local cache remains acceleration only and cannot invent accepted truth;
4. old nested shell, duplicate model config, page mount fetches, and dead
   components are deleted.

Evidence:

- before/after Desktop restart scenario;
- Station API readback;
- tree-wide old-path searches return no live references.

Dependencies: V1-WS1 through V1-WS5.

Current progress (2026-08-15):

- Session-scoped runtimes (`agentCapabilityRuntime`, `agentTopicRuntime`) were incorrectly
  listed in `DEFERRED_APP_RUNTIME_IDS`, causing them to bootstrap with `null` actorId before
  the authenticated actor was known. They have been removed from that list and are now
  exclusively bootstrapped by `installIdleRuntimes(actorId)` via `useDeferredProjections`.
- `AgentChatPage` is a pure 9-line renderer over `AgentWorkbench` with no mount-time fetches.
- `AgentProfilePage` 12 `loadAgents()` calls are all post-mutation (after save/update/import/
  delete), not mount-time bootstrap.
- Required deletion searches completed: no `setModelConfig('agent:')`, no `selectedModel`/
  `defaultModel`/`availableModels[0]` in chat.ts, no legacy `session-{timestamp}` IDs.
- Message hydration is cache-first with Station background sync via `loadSessionMessages` and
  `syncMessages`; `selectSession`/`bootstrapSession` own the read path.
- Remaining before WS6 runtime evidence: native Tauri restart verification under V1-AS07.

## 9. Dependency DAG

```text
V1-WS1 Provider readiness
  -> V1-WS2 Agent config/readiness
       -> V1-WS4 Draft admission/promotion
            -> V1-WS5 Stream/terminal/reconcile
                 -> V1-WS6 Restart + deletion

V1-WS3 Shell extraction
  can begin after V1-WS1 state vocabulary is stable
  but cutover requires V1-WS2 and closes with V1-WS6
```

Parallel work:

- WS3 component extraction may run alongside WS2 backend/config work.
- Station stream tests, Rust bridge tests, and Desktop projection tests inside
  WS5 may run in parallel after event contracts are stable.

No other Agent capability starts before WS6 passes.

## 10. Atomic Cutover Matrix

| Concern | New path | Old path to delete | Cutover proof |
|---|---|---|---|
| Agent page bootstrap | `agentCapabilityRuntime` + `agentTopicRuntime` | page `useEffect(loadAgents/loadModels/bootstrapSession)` | tree search + boot/restart evidence |
| Agent shell | focused workbench components under Agent component ownership | monolithic inline shell in `AgentChatPage.tsx` | page size/responsibility review + UI evidence |
| Agent model identity | Station Agent config compound ref | global selected model fallback and per-name model config | duplicate model test + search |
| Provider readiness | Station provider/credential readiness projection | catalog-enabled implies usable | missing-key and invalid-key scenarios |
| Topic truth | Station conversation after acceptance | synthetic session IDs as durable truth | conversation count/readback |
| Message truth | Station message/event snapshot | cache-only accepted message reconstruction | restart with cleared local cache |
| Stream terminal | persisted Station terminal + replay cursor | BFF connection close implies completion | disconnect/cancel tests |

Rollback is version-control rollback of the complete V1 cutover. A permanent
old/new dual UI or dual source of truth is forbidden.

## 11. Required Deletion Search

The exact symbols may change during implementation; the final workstream must
record the resolved searches. Minimum searches:

```bash
rg -n "loadAgents\\(\\)|loadModels\\(\\)|bootstrapSession\\(\\)" \
  apps/desktop/src/pages/AgentChatPage.tsx \
  apps/desktop/src/pages/AgentProfilePage.tsx

rg -n "setModelConfig\\(`agent:|deleteModelConfig\\(`agent:" \
  apps/desktop/src

rg -n "selectedModel|defaultModel|availableModels\\[0\\]" \
  apps/desktop/src/store/chat.ts

rg -n "session-[0-9]|agent:.*Date\\.now|draft:" \
  apps/desktop/src/store apps/desktop/src/runtimes
```

Any retained match must have a documented V1 responsibility. Compatibility
code without a deletion owner keeps V1 incomplete.

## 12. Implementation Order

| Step | Workstream | Status | Exit evidence |
|---|---|---|---|
| V1-01 | Freeze source-level map and current inventory | done by this manual | this document |
| V1-01A | Pixel-level visual hardening | deferred | `20260815-v1-visual-replica-contract.md`, after functional parity batches |
| V1-02 | Provider readiness closure | code-complete | Station CRUD + Rust/TS/Go gates pass; native Settings interaction pending environment |
| V1-03 | Agent config/readiness projection | completed | Station CRUD/package readback + numeric version + Rust/TS/Go gates |
| V1-04 | Extract new workbench shell components | completed | layout/ownership tests `6/6` + Desktop check/build |
| V1-05 | Atomically switch Agent page to workbench | completed | old 921-line page shell removed; native evidence deferred to V1-09 |
| V1-06 | Draft admission and promotion | completed | tests + Station `0 -> 0 -> 1` admission evidence |
| V1-07 | Typed stream/cancel/reconcile closure | code-complete | Rust/Go/TS replay + model_name persistence gates pass; CLI turn Model field bug fixed (turn_service.go:2301); native AS05/AS06 evidence blocked by environment |
| V1-08 | Restart hydration and old-path deletion | code-complete | session runtime bootstrap bug fixed; deletion searches clean; native AS07 restart evidence blocked by environment |
| V1-09 | Completion audit | in-progress | static gates all green; native runtime verification requires Station with auth-capable environment |

## 13. Runtime Self-Verification Scenarios

Formal Acceptance Framework registration is out of V1 implementation scope.
These scenarios are mandatory implementation evidence.

### V1-AS01: Missing provider credential

- **Precondition**: Ark is catalog-visible, actor has no Ark credential.
- **Action**: User selects the Agent and attempts to send.
- **Expected**: composer is blocked; readiness surface identifies Ark
  credential and opens its Provider settings.
- **Failure variant**: provider list/check fails; Retry remains available.
- **Evidence**: native screenshot + gateway provider/readiness readback.
- **Status**: pending.

### V1-AS02: First provider activation

- **Precondition**: catalog Ark exists without actor provider record.
- **Action**: User saves a valid key.
- **Expected**: provider record is created, credential is configured, check is
  ready, and SeedPro 2.1 becomes selectable.
- **Failure variant**: invalid key produces `invalid`, not `ready`.
- **Evidence**: native UI state + Station provider/credential readback.
- **Status**: pending.

### V1-AS03: Agent model save/readback

- **Precondition**: Ark is ready.
- **Action**: User selects Ark + SeedPro 2.1 in Agent Profile.
- **Expected**: saving then saved; leaving and reopening Profile shows the same
  compound selection.
- **Failure variant**: version conflict preserves local draft and offers reload
  or retry.
- **Evidence**: Station Agent config readback + native UI.
- **Status**: pending.

### V1-AS04: First accepted topic

- **Precondition**: ready Agent, empty draft.
- **Action**: User sends `Reply with exactly V1_OK`.
- **Expected**: one Station conversation is created; user message appears once;
  thinking/progress and multiple text frames are visible; terminal response is
  `V1_OK`.
- **Failure variant**: network failure before acceptance preserves input and
  creates no Station conversation.
- **Evidence**: raw event timestamps, Station rows, native UI.
- **Status**: pending.

### V1-AS05: Cancellation

- **Precondition**: delayed streaming response.
- **Action**: User presses Stop.
- **Expected**: upstream turn stops, partial output is marked partial, terminal
  status is cancelled, retry is available.
- **Failure variant**: disconnect during cancellation reconciles to the same
  Station status.
- **Evidence**: Station turn status + Rust event log + native UI.
- **Status**: pending.

### V1-AS06: Topic switch during streaming

- **Precondition**: active turn in Topic A, Topic B exists.
- **Action**: User switches to B and back to A.
- **Expected**: A continues/reconciles without leaking its text into B.
- **Failure variant**: dropped event is recovered by replay/reconcile.
- **Evidence**: per-conversation event/message readback + native UI.
- **Status**: pending.

### V1-AS07: Desktop restart

- **Precondition**: completed V1_OK topic.
- **Action**: close and restart Desktop.
- **Expected**: same Agent readiness, selected topic, user message, assistant
  response, model identity, and terminal state reappear from Station.
- **Failure variant**: local cache is absent/stale; Station readback still wins.
- **Evidence**: before/after native screenshots + Station readback.
- **Status**: pending.

## 14. Verification Commands

Focused checks run as each workstream lands:

```bash
# Station Agent
cd apps/station/app
go test ./subserver/agent/...
go vet ./subserver/agent/...

# Desktop Rust bridge
cd apps/desktop/src-tauri
cargo test application::provider
cargo test application::agent_turn
cargo check

# Desktop Web
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
```

Runtime:

```bash
make station
make desktop
```

Native UI evidence must use the project-approved official Tauri WebDriver path
when available. Browser rendering and coordinate-based Computer Use are not
substitutes for native functional evidence.

## 15. Risks And Stop Conditions

Stop and escalate if:

1. V1 requires Desktop Web to own durable Agent/provider/topic/message truth.
2. provider+model identity cannot remain compound across save, send, message,
   and readback.
3. stream replay/cancellation semantics require an undefined cross-layer
   contract.
4. the new shell needs a second live source of truth to preserve old UI.
5. UI implementation would show a control whose backend effect is absent.
6. the direct Ark runtime cannot pass after provider/config closure.
7. a workstream cannot delete its replaced path.

## 16. Final Readiness Gate

V1 is complete only when:

- V1-AS01 through V1-AS07 have runtime evidence;
- the production Agent UI shows the new workbench, not the old monolith;
- provider configuration and Agent model selection round-trip through Station;
- real Ark streaming is visible and cancellable;
- accepted topic/messages/model identity survive Desktop restart;
- page mount is not the primary business bootstrap;
- old model fallback, duplicate config, and old shell paths are deleted;
- all focused and platform checks pass.

Until then the strongest allowed claim is:

> V1 implementation is partial; specific workstreams may be implemented or
> runtime-proven, but First Useful Answer product readiness is unproven.

Pixel-level visual parity is a separate later claim governed by
`20260815-v1-visual-replica-contract.md`; it does not block the V1 functional
readiness claim.

## 17. Review Prompt

Use the following prompt for independent plan review:

```text
You are reviewing the Peers-Touch Modern Chat Agent V1 execution plan.

Plan:
docs/architecture/agent/execution-plans/20260815-v1-first-useful-answer.md

Product sources:
- docs/architecture/agent/modern-chat-agent/product-definition.md
- docs/architecture/agent/modern-chat-agent/experience-contract.md
- docs/architecture/agent/modern-chat-agent/product-state-model.md
- docs/architecture/agent/modern-chat-agent/acceptance-matrix.md

Architecture/platform sources:
- docs/architecture/agent/agent-lobehub-blueprint.md
- docs/architecture/agent/provider-station-ownership/design.md
- docs/architecture/boundaries/station-desktop-scope-boundary.md
- docs/client/desktop/runtime-projections.md
- docs/client/common/ui-identity/modules/agent/README.md
- docs/client/desktop/provider-model-target-architecture.md

LobeHub reference:
https://github.com/lobehub/lobehub.git @ 8412f49ec0

Review:
1. Does the plan reproduce a complete First Useful Answer journey rather than
   a module/file checklist?
2. Are LobeHub source behaviors mapped precisely enough to guide production
   implementation without copying source text?
3. Are Station, Desktop Rust, runtime/store, and page responsibilities correct?
4. Does every replaced concern have an atomic deletion closure?
5. Are provider activation, compound model identity, draft promotion,
   streaming, cancellation, replay, and restart semantics complete?
6. Are failure/recovery scenarios binary and executable?
7. Does any step silently preserve the old monolith or dual source of truth?
8. Are dependency order and parallel units correct?

Return:
- Overall: passed / conditionally passed / changes required
- Blocking findings with section references
- Dependency/order corrections
- Missing deletion obligations
- Missing runtime scenarios
- Strongest claim the plan can support
```

# Agent LobeHub Parity - Session / Topic / Message Action Map

> **Status**: implemented-for-design
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Peers-Touch Agent Architecture
> **BOM**: BOM-002, BOM-007, BOM-015
> **Spec**: SPEC-002, SPEC-008, SPEC-009, SPEC-011, SPEC-013
> **Plan Step**: PLAN-P0 / PLAN-P4
> **Gates**: GATE-001, GATE-002, GATE-006, GATE-008
> **Evidence**: EVID-011-R-pre

---

## 1. Purpose

This document closes the BOM-002 design gap by mapping LobeHub's session, topic, thread, message and generation actions to Peers-Touch target ownership.

It is source audit and migration design evidence only. It does not authorize product implementation and does not satisfy GATE-008.

## 2. LobeHub Source Map

| Domain | LobeHub source | Responsibility observed |
| --- | --- | --- |
| Legacy session / agent session list | `external/lobehub/src/store/session/slices/session/action.ts` | Create, duplicate, pin, search, switch and remove agent sessions; legacy delete evicts message cache and switches inbox when active session is removed. |
| Topic lifecycle | `external/lobehub/src/store/chat/slices/topic/action.ts` | Create/save/import/duplicate topic, summary title streaming, status/favorite/metadata/title updates, fetch/list reconciliation, switch/remove topics. |
| Topic UI | `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Topic/**` | Agent topic sidebar, search/filter/group modes, item actions, all-topics drawer, thread list. |
| Thread lifecycle | `external/lobehub/src/store/chat/slices/thread/action.ts` | Open thread creator, initialize optimistic thread messages, create thread with source message, fetch/remove/switch/rename/summarize thread. |
| Message public actions | `external/lobehub/src/store/chat/slices/message/actions/publicApi.ts` | Add user/assistant messages, delete assistant/tool/group messages, clear messages, copy, edit, collapse. |
| Message internals | `external/lobehub/src/store/chat/slices/message/actions/internals.ts` | Dispatch reducer by `messageMapKey`, reconcile assistant-tool links, trace message events. |
| Message key isolation | `external/lobehub/src/store/chat/utils/messageMapKey.ts` and tests | Scope-isolated message maps for main, group, group-agent, thread, task and page contexts. |
| Generation controls | `external/lobehub/src/features/Conversation/store/slices/generation/action.ts` | Cancel, continue, delete-and-regenerate, resend thread message, regenerate user message, heterogeneous auto-retry. |
| Agent run lifecycle | `external/lobehub/src/store/chat/slices/agentRun/actions/**` | Conversation lifecycle, operation state, client/gateway/hetero transports, streaming states, memory and tool execution. |
| Unified run hooks | `external/lobehub/src/store/chat/slices/agentRun/actions/lifecycle/buildRunLifecycle.ts` | Transport-agnostic terminal handling, topic title generation, queue/notification/completion side effects. |

## 3. LobeHub Action Taxonomy

| Action family | Representative actions | LobeHub behavior | Peers-Touch target semantics |
| --- | --- | --- | --- |
| Session list | `createSession`, `duplicateSession`, `pinSession`, `removeSession`, `switchSession`, `updateSearchKeywords` | Session store owns agent session list and active agent pointer; deletion evicts cached messages. | Station owns durable Agent/session truth; Desktop owns selected Agent projection and local search/filter UI. |
| Topic create/save | `createTopic`, `saveToTopic`, `openNewTopicOrSaveTopic` | New-topic view can hold optimistic temp messages; saving binds message IDs to a server topic and triggers title summary. | Station must create topic/conversation and action lineage; Desktop may render optimistic new-topic shell but must reconcile from Station truth. |
| Topic import/duplicate/delete | `importTopic`, `duplicateTopic`, `removeTopic`, `removeSessionTopics` | Uses topic service, refreshes topic list, switches to new topic or default topic, shows success/error messages. | Station owns import/clone/delete/archive decisions; Desktop renders pending/success/error and refreshes projection by event/cursor. |
| Topic status and grouping | `markTopicCompleted`, `unmarkTopicCompleted`, `favoriteTopic`, `updateTopicStatus`, `useFetchTopics` | Topic rows support active/completed/favorite/status, grouped query, TTL-bounded pending status write reconciliation. | Peers must model topic status as durable Station field plus Desktop projection reconciliation, not component-only state. |
| Topic title | `summaryTopicTitle`, `autoRenameTopicTitle`, `updateTopicTitle` | Title summary streams partial output, uses loading markers and falls back on error. | Station should persist title mutation/summary attempts; Desktop renders `generating-title`, failure and retry states. |
| Topic switch | `switchTopic` | Has options for clearing `_new` key and skipping refresh; uses epoch to drop stale async continuations. | Peers Desktop runtime must own switch epoch/reconciliation, while active topic truth remains Station-owned. |
| Thread create/fork | `openThreadCreator`, `createThread`, `syncThreadInPortal` | Forks from source message, initializes optimistic thread message scope and portal view, persists thread with source message ID. | Station must persist branch/thread source lineage; Desktop may initialize optimistic portal projection. |
| Thread list/title | `useFetchThreads`, `removeThread`, `switchThread`, `summaryThreadTitle` | Thread list is topic-scoped; thread title can be summarized by a system agent. | Peers must map branch/thread title to Station-owned topic/thread metadata with Desktop projection states. |
| Message CRUD | `addUserMessage`, `addAIMessage`, `deleteMessage`, `deleteAssistantMessage`, `deleteToolMessage`, `modifyMessageContent`, `clearMessage` | Message public API does optimistic create/delete/update and handles assistantGroup/tool child cleanup. | Station owns durable message mutation; Desktop reducer may optimistically show edits but needs rollback/reconcile metadata. |
| Message reducer/trace | `internal_dispatchMessage`, `internal_traceMessage` | Message updates are keyed by conversation context and then parsed into display messages; assistant-tool links are reconciled; trace events emit copy/modify. | Peers must separate raw durable message projection from display model, and preserve trace IDs across runtime events. |
| Generation cancel | `cancelOperation`, operation state tests | Cancels operations locally and across client/gateway/hetero paths; stop must not leave input stuck. | Peers must type `STOP` as an action with local abort and Station cancellation/reconcile outcome; do not claim provider stopped unless Station confirms. |
| Continue | `continueGeneration`, `continueGenerationMessage` | Continues assistantGroup/block output; hetero CLI branch short-circuits when no continue primitive exists. | Peers must model `CONTINUE` as capability-gated; unsupported providers return explicit unavailable state. |
| Regenerate / resend | `delAndRegenerateMessage`, `regenerateUserMessage`, thread resend tests | Delete-first behavior avoids branch race; regenerate creates tracking operation and may route client/gateway/hetero differently. | Peers must persist regenerate lineage instead of silent destructive rewrite; Desktop must show replacement/branch markers. |
| Run lifecycle | `buildRunLifecycle` | Terminal completion is normalized across client/gateway/hetero; parked states are non-terminal; topic title generation is centralized. | Peers should centralize terminal/parked lifecycle in Station/contract event model, with Desktop as projection owner. |

## 4. State Containers And Ownership

| LobeHub container | Observed role | Peers target owner | Migration note |
| --- | --- | --- | --- |
| `sessions` / `activeAgentId` | Agent/session list and active selection. | Station for durable list; Desktop for selected local projection. | Do not let components delete sessions directly. |
| `topicDataMap` keyed by `topicMapKey` | Paginated topic buckets, loading, expanding, status reconciliation. | Station for topic records; Desktop runtime/store for bucket projection and local query state. | Preserve query bucket identity to avoid cross-agent list overwrite. |
| `dbMessagesMap` keyed by `messageMapKey` | Raw message arrays per conversation context. | Station for durable messages; Desktop for cached raw projection. | Must keep raw projection separate from display parsing. |
| `messagesMap` keyed by `messageMapKey` | Parsed display message tree/list. | Desktop Web projection. | Must be derivable from raw messages plus runtime transient state. |
| `threadMaps` | Topic-scoped thread lists. | Station for threads; Desktop for portal/sidebar projection. | Branch/thread source message lineage must be durable. |
| `operations` / operation maps | Runtime loading/cancel/parent-child operation state. | Desktop runtime for local operation UI; Station for durable run/task state. | Product migration must define event correlation IDs across both. |

## 5. Required Peers-Touch Contract Implications

| Requirement | Contract implication |
| --- | --- |
| Topic switch must be race-safe | Desktop runtime needs a monotonic switch token or equivalent stale-continuation guard. |
| Message scope must be isolated | `AgentConversationContext` must include `agent_id`, `topic_id`, optional `thread_id`, optional `group_id`, optional `document_id/task_id/page_id`, and scope. |
| Retry/regenerate must be auditable | Station must persist `source_message_id`, `source_turn_id`, `replacement_of_message_id` and `action_type`. |
| Branch/thread must be auditable | Station must persist `branch_parent_conversation_id` or `source_topic_id`, `branch_cut_message_id` and thread/source message metadata. |
| Topic title summary must not flicker | Desktop may show streaming title, but Station event/order must prevent stale fetched rows from overwriting pending title/status. |
| Tool message cleanup must preserve lineage | Tool result messages and assistant tool links must reconcile together; deletion cannot orphan tool results. |
| Terminal vs parked states must be distinct | `waiting_for_human` and `waiting_for_async_tool` are parked, not done. UI must not emit terminal side effects for parked runs. |
| Heterogeneous provider gaps must be explicit | Continue/regenerate/CLI resume paths must be capability-gated and render unavailable/manual retry when unsupported. |

## 6. Mapping To Existing Peers-Touch Migration Docs

| Peers document | This map contributes |
| --- | --- |
| `session-topic-runtime.md` | Adds source-backed LobeHub action taxonomy for M4 typed runtime/action-lineage design. |
| `contract-foundation.md` | Requires action lineage and conversation context fields to be represented in proto/model contracts. |
| `desktop-runtime-shell.md` | Requires Desktop runtime/store projection ownership for buckets, raw/display messages and operation UI. |
| `error-recovery-diagnostics.md` | Provides cancel/continue/regenerate/parked-state failure semantics for diagnostics. |
| `migration-plan.md` | Converts BOM-002 from path inventory to implementation batch input. |

## 7. Non-Goals

- Does not copy LobeHub implementation.
- Does not implement Peers product code.
- Does not mark the prototype `confirmed`.
- Does not run GATE-008 checks.

## 8. Current Claim

BOM-002 is implemented for design as a source-backed action map.

Product implementation remains blocked until Owner confirmation and PLAN-P5 entry checks.

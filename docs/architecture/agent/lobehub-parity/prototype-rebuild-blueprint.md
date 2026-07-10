# Agent LobeHub Parity — Prototype Rebuild Blueprint

> Status: implemented-for-pending-review
> Plan: PLAN-P2 reset after `EVID-010-PROTOTYPE-RESET`; pending-review reached by `EVID-010-PROTOTYPE-REBUILD-N`
> Scope: new high-fidelity prototype blueprint only; no product code

## 1. Reset Decision

The previous `Agent LobeHub` prototype was deleted and removed from Prototype Portal after Owner rejection.

Historical evidence `EVID-008`, `EVID-009`, `EVID-010-R1`, and `EVID-010-R2-V/W` must not be used as proof of prototype readiness. They remain useful only as failure evidence and live-audit context.

## 2. New Prototype Entry Conditions

A new Agent parity prototype may be registered only after these conditions are satisfied:

| Condition | Evidence required |
| --- | --- |
| Source-backed shell map | LobeHub source paths mapped to prototype regions |
| Live-backed interaction states | `LIVE-001..LIVE-160` states classified into success/partial/error/unresolved/tool-limited/blocked |
| UI Identity read | `docs/client/common/ui-identity/*` referenced before CSS decisions |
| New path selected | Must not reuse the deleted implementation; path/name must make reset explicit |
| L1/L2/L3 plan | Static, visual and dynamic evidence required before `pending-review` |

## 3. Source-Backed Shell Requirements

### Home

Primary LobeHub sources:

- `external/lobehub/src/routes/(main)/home/_layout/index.tsx`
- `external/lobehub/src/routes/(main)/home/_layout/Sidebar.tsx`
- `external/lobehub/src/routes/(main)/home/features/index.tsx`
- `external/lobehub/src/routes/(main)/home/features/AgentSelect/index.tsx`
- `external/lobehub/src/routes/(main)/home/features/WelcomeText/index.tsx`
- `external/lobehub/src/routes/(main)/home/features/InputArea/index.tsx`
- `external/lobehub/src/features/ChatInput/Desktop/index.tsx`

Required prototype structure:

```text
Home Layout
├── Sidebar
├── Content surface
│   ├── HomeFreeCreditBadge / quota surface
│   ├── AgentSelect
│   ├── WelcomeText
│   ├── InputArea
│   │   ├── optional banner slot
│   │   ├── drag/upload wrapper
│   │   ├── ChatInput editor
│   │   ├── left actions: agentMode, plus
│   │   └── right action: modelLabel
│   └── DailyBrief
├── HomeAgentIdSync boundary
└── RecentHydration boundary
```

Non-negotiable differences from the rejected prototype:

- Home is not a generic dashboard card grid.
- Composer is the central product object, not a small debug textarea.
- Agent select, welcome text and input area must visually read as one LobeHub-like stack.
- Recents/sidebar must be structurally present without becoming a second unrelated app shell.

### Agent Chat

Primary LobeHub sources:

- `external/lobehub/src/routes/(main)/agent/_layout/index.tsx`
- `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/index.tsx`
- `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Header/index.tsx`
- `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Topic/index.tsx`
- `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Topic/List/index.tsx`
- `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Topic/TopicSearchBar/index.tsx`
- `external/lobehub/src/routes/(main)/agent/(chat)/_layout/index.tsx`
- `external/lobehub/src/routes/(main)/agent/features/Conversation/index.tsx`
- `external/lobehub/src/routes/(main)/agent/features/Conversation/ConversationArea.tsx`
- `external/lobehub/src/routes/(main)/agent/features/Conversation/Header/index.tsx`
- `external/lobehub/src/routes/(main)/agent/features/Conversation/Header/HeaderActions/useMenu.tsx`
- `external/lobehub/src/routes/(main)/agent/features/Conversation/MainChatInput/index.tsx`
- `external/lobehub/src/routes/(main)/agent/features/Conversation/HeterogeneousChatInput/index.tsx`
- `external/lobehub/src/features/Conversation/store/slices/generation/action.ts`
- `external/lobehub/src/features/Conversation/store/slices/tool/action.ts`

Required prototype structure:

```text
Agent Chat
├── Agent layout sidebar
│   ├── header agent switcher / nav
│   ├── task status group
│   ├── topic search/filter/group toggle
│   └── topic list / all-topics drawer
├── Conversation header
│   ├── topic tags and thread switcher
│   ├── header actions menu
│   ├── share button
│   └── working panel toggle
├── Conversation area
│   ├── ConversationProvider
│   ├── ChatList with AgentHome welcome
│   ├── user/assistant/tool/task/thinking messages
│   ├── operation state and follow-up hooks
│   ├── ThreadHydration
│   ├── ChatMiniMap
│   └── MessageForward footer/dispatcher
├── MainChatInput
│   ├── AgentConfigError
│   ├── left actions: model, plus
│   ├── right actions: contextWindow or promptTransform + contextWindow
│   └── dev send menu / round send button
├── HeterogeneousChatInput
│   ├── cloud credential guard
│   ├── device guard
│   ├── typo action
│   └── optional hetero model/thinking-effort selector
└── WorkingSidebar
    ├── resources
    ├── review
    ├── files
    └── params
```

WorkingSidebar source map:

| Prototype region | LobeHub source | Required behavior |
| --- | --- | --- |
| Sidebar shell/tabs | `WorkingSidebar/index.tsx` | RightPanel, 360px default width, tabs resolved by availability, close action |
| Resources | `WorkingSidebar/ResourcesSection/index.tsx` | Non-hetero shows AgentDocumentsGroup; hetero with working directory shows SkillsGroup |
| Params | `WorkingSidebar/ParamsSection/index.tsx` | Uses ChatInput Params Controls in sidebar variant |
| Progress | `WorkingSidebar/ProgressSection/index.tsx` | Reads current turn todos and shows collapsible task progress |
| Review | `WorkingSidebar/Review/index.tsx` | Git patch review surface with file list/tree, view mode and refresh controls |
| Files | `WorkingSidebar/Files/index.tsx` | Working-directory file explorer; gated by local/device mode |

Non-negotiable differences from the rejected prototype:

- Chat is not a static three-column mock. It must expose route sidebar, conversation header, live-like message stream, input, and right working panel as separate regions.
- The right panel is not a generic “settings/memory/tools” drawer; it is LobeHub's working panel with resources/review/files/params availability.
- Normal Agent input and heterogeneous Agent input are different states, not just a model selector variant.
- Tool approval, task progress, thinking, file/resource chips and error recovery must appear as message/runtime states inside the conversation model.

### Agent Profile

Primary LobeHub sources:

- `external/lobehub/src/routes/(main)/agent/profile/index.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/Header/index.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/AgentHeader.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/AgentSettings/index.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/AgentSettings/Content.tsx`
- `external/lobehub/src/features/AgentSetting/AgentSettings.tsx`
- `external/lobehub/src/features/AgentSetting/store/action.ts`

Required prototype structure:

```text
Agent Profile
├── Profile header
│   ├── avatar/title/description
│   ├── version/fork/status tags
│   └── settings/share/copy actions
├── Profile editor
├── Agent settings modal
│   ├── model/provider
│   ├── prompts/instructions
│   ├── opening message/questions
│   ├── tool/skill references
│   └── advanced/runtime parameters
└── ownership notes for base-settings vs agent-domain
```

## 4. Ownership Rules

| Surface | Peers owner |
| --- | --- |
| Shell/sidebar/search/recents/global overlays | base-client |
| Provider/model/skills/connectors/billing/credentials | base-settings |
| Files/pages/resources/uploads/generated assets | base-resource |
| Agent profile/chat/topic/task/runtime/tool approval | agent-domain |
| Agent consumption of settings/resources/skills | agent-consumer |

## 5. New Prototype Deliverables

The replacement prototype implementation has been created and registered after source-backed structure was locked.

Candidate path:

```text
packages/prototypes/desktop/features/agent-lobehub-parity/
docs/architecture/agent/prototype-lobehub-parity/README.md
```

This path is the current review target. It must not be confused with the deleted failed implementation at `packages/prototypes/desktop/features/agent-lobehub/`.

## 6. Gates

| Gate | Status | Requirement |
| --- | --- | --- |
| GATE-003 Prototype Runnable | pass for pending-review | `EVID-010-PROTOTYPE-REBUILD-N` proves build, `make run-prototype` and Portal visibility. |
| GATE-004 Prototype Interaction Complete | pass for pending-review | `EVID-010-PROTOTYPE-REBUILD-A..N` proves major surface clicks, L2 screenshots and L3 focus/tab evidence. |
| GATE-005 Provider/model Correctness | pass for pending-review | Model selector expresses provider+model identity and Settings Provider projection semantics. |
| GATE-006 Backend Architecture Complete | implemented for design | No product code migration until prototype confirmed. |

## 7. Next Work

1. Run Owner review through `docs/architecture/agent/prototype/owner-review-checklist.md`.
2. If Owner confirms, update prototype status to `confirmed` and append Owner decision evidence.
3. Only after confirmation, start EVID-012 / PLAN-P5 M1 Contract Foundation entry checks.

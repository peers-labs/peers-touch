# Agent LobeHub Parity - Chat Compact New Topic Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Agent Chat compact New Topic revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CC-pre, EVID-011-CK-pre

---

## 1. Purpose

`EVID-011-BT-pre` proved deep Chat inspection states, but the default Owner-facing
Chat surface still looked heavier than LobeHub live Chat's compact New Topic
entry state. This revision changes default Chat to the compact New Topic
baseline while preserving `state=deep-chat` for deeper inspection.

This document records prototype evidence only. It does not record an Owner
decision, does not confirm the prototype, does not authorize `EVID-012`, does
not edit product code and does not prove GATE-008 product parity.

## 2. Revision Scope

| Live / Prototype Delta | CC Revision |
| --- | --- |
| Default Chat entered a heavy message-stream review state | Default `?surface=chat&check=cc` now opens a compact New Topic state. |
| Left side lacked LobeHub-like compact agent actions | Added compact topic action stack: Start New Topic, Search, Agent Profile, Topics and Channels. |
| Header carried deep review tags/actions | Compact header now shows `New Topic` with only the more action visible. |
| Default body lacked the live-style assistant greeting | Added centered `Lobe AI` greeting and short prompt hint. |
| Composer was too low/large for Owner visual comparison | Added compact composer with model, Context, Prompt, Allow List and Send controls fully visible in L2 screenshot. |
| Deep Chat evidence still needed for runtime inspection | Preserved `?surface=chat&state=deep-chat&working=review&check=bt` for BT deep review. |
| Scoped evidence gate still used a broad CC screenshot | CK adds a clean scoped `.pt-chat-shell.is-compact-chat` screenshot and tightens compact composer footer layout so `Allow List` and `Send` are visible in L2, not only in DOM text. |

## 3. Source Anchors

The older `external/lobehub/src/features/Conversation/index.tsx` anchor is not
a current component path. Current LobeHub anchors for this Chat default state are:

| LobeHub source | Responsibility |
| --- | --- |
| `external/lobehub/src/routes/(main)/agent/features/Conversation/ConversationArea.tsx` | Agent conversation shell, `ConversationProvider`, `ChatList`, `AgentHome` welcome and main chat input composition. |
| `external/lobehub/src/features/Conversation/ChatList/index.tsx` | Message list, skeleton/error/refreshing states, welcome rendering for empty conversation and virtualized messages. |
| `external/lobehub/src/features/Conversation/ChatInput/index.tsx` | Conversation input orchestration, intervention/progress/error notices and `DesktopChatInput` mounting. |
| `external/lobehub/src/routes/(main)/agent/features/Conversation/MainChatInput/index.tsx` | Agent main chat input action configuration, model/plus/context/prompt actions and send controls. |
| `external/lobehub/src/features/ChatInput/Desktop/index.tsx` | Desktop ChatInput visual shell, footer action bar, context container, drag/drop and input height handling. |
| `external/lobehub/src/features/ChatInput/SendArea/index.tsx` | Footer send area and right-side actions. |
| `external/lobehub/src/features/ChatInput/SendArea/SendButton.tsx` | Send/stop button behavior and permission-gated disabled/tooltip state. |
| `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Header/Nav.tsx` | New Topic action and duplicate-send guard. |
| `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Topic/List/index.tsx` | Agent topic rail list shell, fetch, empty state and grouping. |
| `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Topic/TopicListContent/index.tsx` | Reusable topic list content, search, skeleton and grouped render. |

## 4. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors listed above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/chat-cc-compact-chat-full-root.png`, opened and inspected at 1900x1213. The screenshot shows the left rail, compact action stack, `New Topic` header, `Lobe AI` greeting, compact composer footer, `OpenAI / gpt-4.1`, `Context`, `Prompt`, `Allow List` and `Send`. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-chat-cc-dom.json`: `compactChat=true`, `topicActionStack=true`, `newTopicHeader=true`, `lobeGreeting=true`, `compactPrompt=true`, `allowList=true`, `sendButton=true`, `messageStreamAbsent=true`, `workingSidebarAbsent=true`, `deepControlsAbsent=true`, `forbiddenHits=[]`. |
| L2 Visual / Gate Baseline | `tmp/agent-lobehub-l2-screenshots/chat-ck-compact-new-topic-scoped.png`, opened and inspected at 1320x1100. CDP clipped `.pt-chat-shell.is-compact-chat`; metadata `tmp/agent-lobehub-chat-ck-scoped-screenshot-meta.json` reports `portalChromeHit=false`, `composerVisible=true`, and visible text covering topic rail, `New Topic`, `Lobe AI`, compact composer, model/context/prompt, `Allow List` and `Send`. `EVID-011-CK-pre` promotes this clean scoped screenshot plus `tmp/agent-lobehub-chat-ck-dom.json` into the active compact artifact gate for Agent Chat. |
| L3 Dynamic / Gate DOM | `tmp/agent-lobehub-chat-ck-dom.json`: `compactChat=true`, `topicActionStack=true`, `newTopicHeader=true`, `lobeAiGreeting=true`, `compactPrompt=true`, `compactComposer=true`, `modelButton=true`, `contextButton=true`, `promptButton=true`, `allowList=true`, `allowListVisible=true`, `sendButton=true`, `sendButtonVisible=true`, `messageStreamAbsent=true`, `workingSidebarAbsent=true`, `deepControlsAbsent=true`, `forbiddenHits=[]`. |

## 5. Remaining Risk

Chat default visual density is closer to LobeHub's New Topic state, but this is
still prototype-only. Real topic creation, conversation persistence, model
selection, allow-list semantics, streaming, tool calls and runtime recovery
remain unproven and stay behind post-confirmation product migration gates.

## 6. Claim Boundary

`EVID-011-CC-pre` proves an Agent Chat compact New Topic prototype revision with
L2/L3 evidence. `EVID-011-CK-pre` proves the clean scoped Agent Chat artifact is
strong enough for the active compact artifact gate. Neither evidence row
confirms Chat, creates or authorizes `EVID-012`, or allows Desktop / Station /
Model product migration.

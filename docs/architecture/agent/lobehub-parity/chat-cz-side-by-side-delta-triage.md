# Agent LobeHub Parity - Chat Side-by-side Delta Triage

> **Status**: revision-required / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Agent Chat side-by-side visual delta triage / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CZ-pre

---

## 1. Purpose

This document records a fresh side-by-side Agent Chat triage after
`EVID-011-CC-pre` and `EVID-011-CK-pre`.
It compares LobeHub live Chat New Topic against the Peers
`agent-lobehub-parity` compact Chat artifact and decides whether Agent Chat can
move toward Owner confirmation.

Verdict: **Agent Chat remains `revision-required`**.

This document does not record an Owner decision, does not confirm the prototype,
does not authorize `EVID-012`, does not edit product code and does not prove
GATE-008 product parity.

## 2. Evidence Inputs

| Layer | LobeHub Live | Peers Prototype |
| --- | --- | --- |
| L1 Source | `external/lobehub/src/routes/(main)/agent/features/Conversation/ConversationArea.tsx`; `external/lobehub/src/routes/(main)/agent/features/Conversation/MainChatInput/index.tsx`; `external/lobehub/src/features/ChatInput/Desktop/index.tsx`; `external/lobehub/src/features/ChatInput/SendArea/index.tsx`; `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Header/Nav.tsx`; `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/Topic/List/index.tsx`; `external/lobehub/src/routes/(main)/agent/_layout/Sidebar/AgentListContent.tsx` | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; `docs/architecture/agent/lobehub-parity/chat-cc-compact-new-topic-revision.md` |
| L2 Visual | Integrated-browser screenshot output for `https://app.lobehub.com/agent/agt_e78tsQpHIgjF`, captured in-session. The screenshot shows icon rail, open agent switcher popover, topic rail, `New Topic` header, centered `Lobe AI` greeting, compact composer, footer `Agent`, `No device`, `Allow List`, and top `Space` / `Params` panel tabs. | `tmp/agent-lobehub-l2-screenshots/chat-ck-compact-new-topic-scoped.png`, inspected as the active clean scoped Agent Chat artifact. |
| L3 Dynamic / DOM | Integrated-browser snapshot/evaluate on `https://app.lobehub.com/agent/agt_e78tsQpHIgjF`: title `Lobe AI · LobeHub`; text hits include `New Topic`, `Lobe AI`, `Ask, create, or start a task`, `Agent`, `No device`, `Allow List`, `Tasks`, `Topics`, `Yesterday`, `Home 新会话测试`, `[Draft] Greetings`, `Upgrade your plan`; interactive controls include `DeepSeek`, `Add files, skills, and more context...`, `Agent`, `No device`, `Allow List`, `Space`, `Params`, `Model Config`. | `tmp/agent-lobehub-chat-ck-dom.json`: `compactChat=true`, `topicActionStack=true`, `newTopicHeader=true`, `lobeAiGreeting=true`, `compactPrompt=true`, `compactComposer=true`, `modelButton=true`, `contextButton=true`, `promptButton=true`, `allowListVisible=true`, `sendButtonVisible=true`, `messageStreamAbsent=true`, `workingSidebarAbsent=true`, `deepControlsAbsent=true`, `forbiddenHits=[]`. |

## 3. Side-by-side Findings

| Area | LobeHub Live Finding | Peers Prototype Finding | Delta |
| --- | --- | --- | --- |
| Left navigation anatomy | Live Chat has a narrow icon rail, an agent switcher button that opens an agent list popover, and a topic rail with task/topic group headings. | CK compresses the left side into an action stack with Start New Topic, Search, Agent Profile, Topics and Channels. | CK is functionally reviewable but not visually close enough to the live rail/popover/topic anatomy. A follow-up revision should introduce the agent switcher popover and topic grouping while keeping Peers ownership labels out of the default view. |
| Header density | Live New Topic header is sparse: `New Topic`, more action, and a narrow right-panel toggle affordance. | CK has a compact header, but the surrounding conversation shell still reads as a Peers custom split rather than the live LobeHub panel rhythm. | Keep CK's clean header baseline, but align the shell spacing and right-panel toggle rhythm to live LobeHub before asking Owner to confirm Chat. |
| Greeting and empty state | Live centers a large avatar, `Lobe AI`, and `Hi, I'm Lobe AI. One sentence is enough-you're in control.` above the composer. | CK includes `Lobe AI` greeting and compact prompt; this part is close enough for pending-review comparison. | No immediate revision required for greeting copy/placement beyond matching the surrounding composer and rail density. |
| Composer footer actions | Live footer separates the message box from the footer row and exposes `Agent`, `No device`, and `Allow List` as bottom controls. The model picker is visible as `DeepSeek` in the composer action area. | CK exposes `OpenAI / gpt-4.1`, `Context`, `Prompt`, `Allow List` and `Send` in two footer rows. | CK preserves provider/model and context semantics, but the footer is not visually aligned with live LobeHub. Next revision should replace the default footer with live-like `Agent`, `No device`, `Allow List`, send icon and a model button while retaining Settings Provider projection semantics. |
| Right working panel | Live shows `Space` and `Params` tabs in the right panel area even in New Topic, with model config controls visible when Params is active. | CK intentionally hides `WorkingSidebar` in compact mode; BT deep-chat retains working-sidebar inspection. | Compact Chat should show a collapsed or lightweight right-panel tab affordance so Owner can compare the New Topic layout without switching to deep inspection. |
| Product boundary | Live controls are connected to LobeHub runtime. | CK is mock/prototype only, with `forbiddenHits=[]` and no product path migration. | Keep this boundary. Do not fake runtime success; represent right-panel/device/provider details as prototype-only until Owner confirmation and EVID-012 authorization. |

## 4. Required Chat Revision Before Owner Confirmation

1. Add a Chat compact follow-up state aligned to live LobeHub's icon rail,
   agent switcher popover, topic grouping and bottom upgrade card.
2. Rework the compact composer footer to show live-like `Agent`, `No device`,
   `Allow List`, model selector and send affordance while preserving Peers
   Settings Provider projection semantics.
3. Add a lightweight compact right-panel affordance for `Space` / `Params`;
   keep full working-sidebar runtime details in `state=deep-chat`.
4. Re-run scoped L2/L3 evidence after the Chat follow-up revision and append a
   new Chat-specific evidence row before any Owner confirmation or `EVID-012`
   work.

## 5. Claim Boundary

`EVID-011-CZ-pre` proves that Agent Chat received a fresh side-by-side visual
delta triage with live LobeHub and rendered Peers prototype evidence. It does
not make Agent Chat ready for Owner confirmation. Product migration remains
blocked until the Owner records `confirmed`, `EVID-012` is authorized and
PLAN-P5 entry gates pass.

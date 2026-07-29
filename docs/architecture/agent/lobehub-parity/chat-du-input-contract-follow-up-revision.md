# Agent LobeHub Parity - Chat Input Contract Follow-up Revision

> **Status**: implemented / pending Owner review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Agent Chat input contract follow-up / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-DU-pre

---

## 1. Purpose

`EVID-011-DA-pre` / `EVID-011-DB-pre` promoted the compact Agent Chat shell:
LobeHub-like rail, agent switcher, topic grouping, composer footer and
Space/Params affordance. DU follows the LobeHub source one layer deeper and
promotes the ChatInput contract as the then-active Chat artifact gate. After
`EVID-011-DX-pre`, DU is retained as historical input-contract context and DX is
the active Chat runtime/streaming/recovery artifact.

This is still prototype-only work. It does not record an Owner decision, does
not confirm Agent Chat, does not authorize `EVID-012`, does not edit product
code and does not prove GATE-008 product migration parity.

## 2. Source Anchors

| Source | Contract used for DU |
| --- | --- |
| `external/lobehub/src/routes/(main)/agent/features/Conversation/ConversationArea.tsx` | Chat mounts `ChatList` with `AgentHome`, wraps input in `MessageForwardFooter`, and keeps `ChatMiniMap` / dispatcher sidecars. |
| `external/lobehub/src/routes/(main)/agent/features/Conversation/MainChatInput/index.tsx` | Main agent input owns `AgentConfigError`, `ChatInput`, left `model` / `plus` actions, right `contextWindow` / `promptTransform`, and dev send menu. |
| `external/lobehub/src/routes/(main)/agent/features/Conversation/MainChatInput/useSendMenuItems.tsx` | Send menu exposes Enter / Cmd+Enter choice plus Add AI Message and Add User Message. |
| `external/lobehub/src/features/ChatInput/Desktop/index.tsx` | Desktop ChatInput owns notice, context/files header, drag/drop handlers, action bar, send area and optional control bar. |
| `external/lobehub/src/routes/(main)/agent/features/Conversation/HeterogeneousChatInput/index.tsx` | Heterogeneous agents show cloud/device guard banners and can disable send until configuration or device state is valid. |
| `external/lobehub/src/routes/(main)/agent/features/Conversation/HeterogeneousChatInput/HeteroControlBar.tsx` | Heterogeneous control bar owns workspace controls, quota badges and full-access badge. |

## 3. DU Prototype Response

| LobeHub input contract | DU prototype response |
| --- | --- |
| Notice / config errors stay above the editor without replacing the composer. | `state=chat-input-contract` renders `.pt-chat-contract-strip` above the compact input. |
| Context/file/skill selections appear as removable header chips. | DU renders `.pt-chat-context-container` with page, resource and skill chips plus clear action. |
| Action bar keeps model/plus left and context/prompt transform right before send. | DU renders `.pt-chat-action-contract` and extends the compact input footer with Typo and Prompt transform. |
| Send menu owns Enter / Cmd+Enter and Add AI/User message choices. | DU renders `.pt-chat-send-menu` with all four choices. |
| Heterogeneous agents fail closed on missing device/cloud configuration. | DU renders `.pt-chat-hetero-guard` with Refresh and Configure actions. |
| Workspace/full-access/quota controls belong to the input runtime bar. | DU renders `.pt-chat-workspace-control` with workspace, full-access and quota chips. |
| Drag/drop path and skill cards are accepted by the input shell. | DU renders `.pt-chat-input-header` with drag/drop copy and history affordance. |

## 4. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Source | Prototype changes in `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx` and `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub anchors listed above. |
| Static build | `pnpm --filter @peers-touch/prototype-portal run build` passed after DU implementation. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/chat-du-input-contract-scoped.png`; metadata `tmp/agent-lobehub-chat-du-scoped-screenshot-meta.json` records `portalChromeHit=false`, capture URL `http://localhost:3200/?surface=chat&state=chat-input-contract&check=du`, marker selector `[data-review-marker="chat-input-contract-du"]` and SHA-256 `ee72a0c3dcf9e2d8d7a1dbe162bff870206ac33cd3bb3fe800ba417559f3c216`. |
| L3 DOM | `tmp/agent-lobehub-chat-du-dom.json` reports `root=true`, `marker=chat-input-contract-du`, `compactChat=true`, `inputContractShell=true`, `chatInputNotice=true`, `contextContainer=true`, `actionContract=true`, `sendMenu=true`, `heteroGuard=true`, `workspaceControl=true`, `inputHeader=true`, `composerTypo=true`, `promptTransform=true`, `modelButton=true`, `sideTabs=["Space","Params"]`, `forbiddenHits=[]`, `portalChromeHit=false`. |
| Gate wiring | DU was previously wired as the active compact artifact after DA/DB. After `EVID-011-DX-pre`, Owner readiness and evidence-chain gates validate Agent Chat against DX screenshot/DOM and `chat-dx-runtime-contract-follow-up-revision.md`; DU remains historical ChatInput contract evidence. |

## 5. Remaining Gaps

- DU does not implement real `ChatInput` editor plugins, slash menu, mention menu,
  context selection mutation, file upload, device polling, cloud auth or send
  preference persistence.
- DU does not complete AgentHome parity. Avatar/title/opening Markdown,
  opening-question chips and tool-auth alert remain candidates for a later
  Chat follow-up.
- DU does not complete Topic row micro-states. Draft, unread, running elapsed,
  waiting, failed, completed, PR icon, hover metadata and thread list states
  remain candidates for a later Chat follow-up.

## 6. Claim Boundary

`EVID-011-DU-pre` proves the prototype contains a source-backed Agent Chat input
contract review state and clean scoped L2/L3 evidence for that state. After
`EVID-011-DX-pre`, this document is historical context for the active DX runtime
contract review. It does not prove final visual parity, does not record Owner
acceptance and does not permit product migration.

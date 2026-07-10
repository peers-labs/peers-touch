# Agent LobeHub Parity - Chat Compact Follow-up Revision

> **Status**: implemented / pending clean artifact refresh / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Agent Chat compact follow-up revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-DA-pre

---

## 1. Purpose

`EVID-011-CZ-pre` kept Agent Chat `revision-required` after comparing the
Peers compact New Topic state with LobeHub live Chat. This follow-up implements
the first compact Chat revision for those CZ deltas.

This is still prototype-only work. It does not record an Owner decision, does
not confirm Chat, does not authorize `EVID-012`, does not edit product code and
does not prove GATE-008 product migration parity.

## 2. Implemented Changes

| CZ Delta | DA Prototype Response |
| --- | --- |
| Live Chat has a narrow icon rail and agent switcher popover. | `AgentTopicRail(compact)` now renders `.pt-chat-icon-rail`, `.pt-agent-popover` and `.pt-agent-option-list` instead of the older Peers-only action stack. |
| Live Chat groups task/topic history in the rail. | Compact Chat now renders `.pt-compact-topic-groups`, `Tasks`, `Topics`, `Yesterday`, `Home 新会话测试` and `[Draft] Greetings`. |
| Live composer footer exposes `Agent`, `No device`, `Allow List` and a compact send affordance. | `ChatInputSurface(compact)` now renders `.pt-live-footer-row` with `Agent`, `No device`, `Allow List` and icon send while keeping the model selector visible as `DeepSeek`. |
| Live New Topic still exposes `Space` / `Params` affordance. | Compact Chat now renders `.pt-compact-chat-side-affordance` with `.pt-compact-side-tabs` for `Space` and `Params`. Full runtime controls remain in `state=deep-chat`. |
| Peers ownership and review metadata must not leak into default UI. | The scoped `.pt-chat-shell` browser check reports `forbiddenHits=[]` for `EVID-011`, `Owner confirmation` and `BOM-012`. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Source | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; source references already listed in `chat-cz-side-by-side-delta-triage.md`. |
| Static build | `pnpm --filter @peers-touch/prototype-portal run build` passed after the DA implementation. |
| Browser / DOM | Prototype Portal `http://localhost:3200/?surface=chat&check=da` opened `agent-lobehub-parity`; scoped DOM evaluate found `compactChat=true`, `lobehubLikeRail=true`, `iconRail=true`, `agentPopover=true`, `compactTopicGroups=true`, `upgradeCard=true`, `liveFooterRow=true`, `sideAffordance=true`, `sideTabs=["Space","Params"]`, `footerButtons=["Agent","No device","Allow List","Send message"]`, `defaultReviewCopyHidden=true`, `forbiddenHits=[]`. |
| Clean artifact refresh | `EVID-011-DB-pre` promotes DA screenshot/DOM artifacts into the active compact artifact gate. |

## 4. Artifact Refresh Handoff

DA originally stopped at implementation/build/browser verification. The clean
scoped L2/L3 artifact refresh is tracked separately by `EVID-011-DB-pre`:

- `tmp/agent-lobehub-l2-screenshots/chat-da-compact-new-topic-scoped.png`
- `tmp/agent-lobehub-chat-da-dom.json`
- `tmp/agent-lobehub-chat-da-scoped-screenshot-meta.json`

DA plus DB still do not record Owner acceptance.

## 5. Claim Boundary

`EVID-011-DA-pre` proves that the Chat compact follow-up implementation exists,
builds and renders the CZ-required live-like controls in the prototype. With
`EVID-011-DB-pre`, the DA render also has clean scoped active artifacts. Neither
evidence row proves final visual parity, records Owner acceptance or permits
product migration.

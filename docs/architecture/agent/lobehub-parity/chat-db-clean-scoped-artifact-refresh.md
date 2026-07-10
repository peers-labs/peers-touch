# Agent LobeHub Parity - Chat DA Clean Scoped Artifact Refresh

> **Status**: implemented / pending Owner review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Agent Chat clean scoped artifact refresh / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-DB-pre

---

## 1. Purpose

`EVID-011-DA-pre` implemented the Chat compact follow-up revision required by
`EVID-011-CZ-pre`. This document records the clean scoped L2/L3 artifact refresh
that promotes the DA render into the active compact artifact gate.

This is still prototype-only evidence. It does not record an Owner decision,
does not confirm Chat, does not authorize `EVID-012`, does not edit product code
and does not prove GATE-008 product migration parity.

## 2. Active Artifact Replacement

| Artifact | Previous Active Baseline | New Active Baseline |
| --- | --- | --- |
| L2 PNG | `tmp/agent-lobehub-l2-screenshots/chat-ck-compact-new-topic-scoped.png` | `tmp/agent-lobehub-l2-screenshots/chat-da-compact-new-topic-scoped.png` |
| L3 DOM JSON | `tmp/agent-lobehub-chat-ck-dom.json` | `tmp/agent-lobehub-chat-da-dom.json` |
| Screenshot metadata | `tmp/agent-lobehub-chat-ck-scoped-screenshot-meta.json` | `tmp/agent-lobehub-chat-da-scoped-screenshot-meta.json` |
| Review URL | `?surface=chat&check=ck` | `?surface=chat&check=da` |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| Capture path | Temporary headless Chrome + CDP opened `http://localhost:3200/?surface=chat&check=da`, selected `Agent LobeHub Parity` in Prototype Portal, waited for `.pt-chat-shell.is-compact-chat .pt-agent-popover .pt-agent-option-list`, then clipped `.pt-chat-shell.is-compact-chat`. |
| L2 visual | `tmp/agent-lobehub-l2-screenshots/chat-da-compact-new-topic-scoped.png`, PNG header verified, `71820` bytes, clip `{ "x": 365, "y": 470, "width": 1135, "height": 630, "scale": 1 }`. |
| L3 DOM | `tmp/agent-lobehub-chat-da-dom.json` reports `compactChat=true`, `lobehubLikeRail=true`, `iconRail=true`, `agentPopover=true`, `compactTopicGroups=true`, `upgradeCard=true`, `newTopicHeader=true`, `lobeAiGreeting=true`, `compactPrompt=true`, `compactComposer=true`, `modelButton=true`, `agentFooterButton=true`, `noDeviceButton=true`, `allowListVisible=true`, `sendButtonVisible=true`, `sideAffordance=true`, `sideTabs=["Space","Params"]`, `messageStreamAbsent=true`, `workingSidebarAbsent=true`, `deepControlsAbsent=true`, `forbiddenHits=[]`. |
| Metadata | `tmp/agent-lobehub-chat-da-scoped-screenshot-meta.json` reports `portalChromeHit=false`, `composerVisible=true`, `sideAffordanceVisible=true`, and the same scoped DA markers. |
| Gate wiring | Owner readiness and evidence-chain gates now validate Agent Chat against DA screenshot/DOM and `chat-da-compact-follow-up-revision.md` instead of CK artifacts. |

## 4. Claim Boundary

`EVID-011-DB-pre` proves the DA Chat compact render has clean scoped L2/L3
artifacts and is wired into the active compact artifact gate. It does not prove
final visual parity, does not record Owner acceptance and does not permit product
migration.

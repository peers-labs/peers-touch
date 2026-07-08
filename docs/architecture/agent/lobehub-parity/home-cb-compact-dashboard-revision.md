# Agent LobeHub Parity - Home Compact Dashboard Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Home compact dashboard revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CB-pre

---

## 1. Purpose

`EVID-011-CA-pre` found that Home still looked like an expanded chat input
showcase rather than LobeHub's compact Home dashboard. This revision updates the
Peers prototype Home surface while keeping `deep-home` as the inspection state.

This document records the revision evidence. It does not record an Owner
decision, does not confirm the prototype, does not authorize `EVID-012`, does
not edit product code and does not prove GATE-008 product parity.

## 2. Revision Scope

| CA Delta | CB Revision |
| --- | --- |
| Missing connector strip | Added `Home app connector strip` with Gmail, Google Drive, Calendar, Slack and Notion connector buttons. |
| Hero/composer too large | Added compact Home default state via `state=compact-home`, with lower title density and narrower floating composer. |
| Missing model recommendation chips | Added four Home recommendation chips: Claude Fable 5, Claude Sonnet 5, Nano Banana 2 Lite and Seedance 2.0. |
| Missing Brief/task card | Added Brief card with `Awaiting Your ArXiv Research Area`, `View all tasks` and `Confirm` actions. |
| Missing recommendation templates | Added three setup recommendation cards with `Add task` actions. |
| Deep inspection menus overloaded Owner visual | Preserved `state=deep-home`; compact Home omits deep inspection popovers and upload artifacts. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css` |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/home-cb-compact-dashboard-region.png`, opened and inspected at 1235x543. The screenshot shows the connector strip, compact agent selector/title/composer, model chips and Brief card. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-home-cb-dom.json`: `compactHome=true`, `connectorStrip=true`, `connectorButtons=5`, `recommendedModelChips=4`, `dashboardCards=2`, `briefCard=true`, `recommendationCards=3`, `viewAllTasks=true`, `addTaskActions=3`, `legacyHeroAbsent=true`, `deepInspectionMenusAbsent=true`, `forbiddenHits=[]`. |

## 4. Remaining Risk

Home is materially closer to LobeHub's live dashboard composition, but this is
still prototype-only. Real connector authorization, model recommendation source,
task creation, Brief execution, recents persistence and Home runtime data remain
mocked and require post-confirmation product migration work.

## 5. Claim Boundary

`EVID-011-CB-pre` proves a Home compact-dashboard prototype revision with L2/L3
evidence. It does not confirm Home, does not create or authorize `EVID-012`, and
does not allow Desktop / Station / Model product migration.

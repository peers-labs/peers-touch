# Agent LobeHub Parity - Home Visual Delta Triage

> **Status**: revision-required / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Home side-by-side visual delta triage / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CA-pre

---

## 1. Purpose

This document records a fresh side-by-side Home triage after `EVID-011-BZ-pre`.
It compares LobeHub live Home against the Peers `agent-lobehub-parity` Home
deep-review state and decides whether Home can move toward Owner confirmation.

Verdict: **Home remains `revision-required`**.

This document does not record an Owner decision, does not confirm the prototype,
does not authorize `EVID-012`, does not edit product code and does not prove
GATE-008 product parity.

## 2. Evidence Inputs

| Layer | LobeHub Live | Peers Prototype |
| --- | --- | --- |
| L1 Source | `external/lobehub/src/routes/(main)/home/**`; `external/lobehub/src/features/AgentHome/**`; `external/lobehub/src/features/ChatInput/**`; `external/lobehub/src/features/AgentSelect/**`; `external/lobehub/src/features/Conversation/StarterList/**` | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css` |
| L2 Visual | Integrated browser screenshot of `https://app.lobehub.com/` captured in-session, current account Home route. Tool output showed the live sidebar, connector strip, floating composer, model chips, Brief/task card and recommendation cards. | `tmp/agent-lobehub-l2-screenshots/home-ca-side-by-side-prototype.png`, opened and inspected at 1600x1013. |
| L3 Dynamic / DOM | Integrated browser snapshot and DOM evaluate on `https://app.lobehub.com/`: title `Home · LobeHub`; links include `Home`, `Tasks`, `Pages`, recents, agents, `Generation`, `Community`, `Resources`, `Memory`; buttons include `DeepSeek V4 Pro`, model chips, `View all tasks`, `Show more`, `Confirm`, `Refresh`, `Add task`; text sample includes `Connect your favorite apps to Lobe AI`, `Ask, create, or start a task. @ to assign tasks to other agents.` | `tmp/agent-lobehub-home-ca-prototype-dom.json`: `deepHome=true`, `agentPopover=true`, `retryButton=true`, `dailyHint=true`, `inputNotice=true`, `typoControls=6`, `toolMenu=true`, `modelMenu=true`, `historyPopup=true`, `starterStates=true`, `recentsDrawer=true`, `forbiddenHits=[]`. |

## 3. Side-by-side Findings

| Area | LobeHub Live Finding | Peers Prototype Finding | Delta |
| --- | --- | --- | --- |
| Home information architecture | Live Home is a task-oriented dashboard: left rail + recents/agents/resources/memory nav, central floating composer, connector strip, model recommendations, Brief/task card and setup recommendations. | Prototype Home still centers a large headline and expanded chat-composer review state, with many menus intentionally opened for inspection. | Prototype covers controls, but the default Home composition still feels more like a chat input showcase than LobeHub's compact Home dashboard. |
| Composer placement and density | Live composer is compact, floating and vertically centered in a narrow column. It says `Ask, create, or start a task. @ to assign tasks to other agents.` | Prototype composer is wider, lower, and visually heavier. It emphasizes context attachments, file chips, typo controls and open popovers. | Need a separate compact Home dashboard state before Owner confirmation; current deep state is good for inspection but too overloaded as a visual match. |
| Connector strip | Live Home prominently shows connected app icons above the composer and links Home to app/task workflows. | Prototype has `Install skills or drop files...` and tool menus, but does not visually match the app connector strip rhythm. | Add a LobeHub-like connector row or make the existing skill/resource affordance visually comparable. |
| Model suggestions | Live Home shows model chips under the composer (`Claude Fable 5`, `Claude Sonnet 5`, `Nano Banana 2 Lite`, `Seedance 2.0`) separate from the active model selector. | Prototype has a model switch popover plus Settings Provider projection rows. | Keep provider projection semantics, but add Home-level recommended model chips so the layout matches LobeHub's discovery pattern. |
| Task / recommendation cards | Live Home has `Brief`, `View all tasks`, an awaiting task card and recommendation templates with `Add task`. | Prototype has StarterList buttons and Recents/Featured plugins blocks. | Replace or supplement starter cards with LobeHub-like Brief/task/recommendation cards for Home review. |
| Left rail / recents | Live rail is denser and includes account, search, Home/Tasks/Pages, Recents, Agents, Generation, Community, Resources and Memory. | Prototype rail maps surfaces, but inside the Portal wrapper it is visually narrower and icon-only, with Home recents in the right-side block. | For Home review, recents/agents density should move closer to LobeHub's rail behavior while keeping Peers module boundaries documented. |
| Evidence leakage | Live has no audit terminology. | Scoped Home region has `forbiddenHits=[]`; Portal wrapper still contains card text about product migration, so leakage checks must remain scoped to the prototype region. | Keep scoped DOM checks; do not use whole-body checks from Portal. |

## 4. Required Home Revision Before Owner Confirmation

1. Add a compact Home dashboard review state that visually mirrors LobeHub's
   floating composer, connector strip, model chips, Brief/task card and
   recommendation templates.
2. Keep the existing `deep-home` inspection state, but do not use it as the
   default Owner confirmation visual because it intentionally opens too many
   menus.
3. Preserve Peers ownership boundaries:
   - provider/model data remains a Settings Provider projection.
   - connector/skill affordances remain base-settings / agent-consumer.
   - resources and files remain base-resource / agent-consumer.
   - Home task cards remain agent-domain mock UI until product migration is
     authorized.
4. Re-run L2/L3 evidence after the compact Home dashboard revision and append a
   new Home-specific `EVID-011-*` row before any `EVID-012` work.

## 5. Claim Boundary

`EVID-011-CA-pre` proves that Home received a fresh side-by-side visual delta
triage with live LobeHub and rendered Peers prototype evidence. It does not make
Home ready for Owner confirmation. Product migration remains blocked until the
Owner records `confirmed`, `EVID-012` is authorized and PLAN-P5 entry gates pass.

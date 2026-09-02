# Agent LobeHub Parity - Home Compact Dashboard Density Revision

> **Status**: revision-added / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Home compact dashboard density revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CI-pre, EVID-011-CJ-pre

---

## 1. Purpose

`EVID-011-CB-pre` moved Home from an expanded inspection surface toward
LobeHub's compact Home dashboard. `EVID-011-CI-pre` tightens that default Home
review surface using the LobeHub source structure:

- `external/lobehub/src/routes/(main)<home>`
- `external/lobehub/src/routes/(main)<home>/index.tsx`
- `external/lobehub/src/features/DailyBrief/BriefCard.tsx`
- `external/lobehub/src/features/RecommendTaskTemplates/TaskTemplateCard.tsx`
- `external/lobehub/src/features/RecommendTaskTemplates/ConnectorAuthRow.tsx`

This document records a prototype-only Home follow-up revision. It does not
record an Owner decision, does not confirm Home or the prototype, does not
authorize `EVID-012`, does not edit product code and does not prove GATE-008
product parity.

## 2. Revision Scope

| CB Gap | CI Revision |
| --- | --- |
| Home compact screenshot still clipped the lower dashboard structure. | Reduced compact Home vertical density and widened the Home rail from 560px to 600px so the composer, model chips, Brief and first recommendation card are visible in one Owner-review viewport. |
| Connector strip only showed app initials, not auth distinction. | Added connected vs auth-required connector states for Gmail, Google Drive, Calendar, Slack and Notion. |
| Brief card was too shallow versus LobeHub `BriefCard`. | Added divider, artifact chips, `View run` and primary `Confirm` actions while keeping task execution mocked. |
| Recommendation cards lacked `TaskTemplateCard` schedule/auth semantics. | Added schedule text, connector/auth labels and explicit `Add task` action per recommendation. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source paths listed above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/home-ci-compact-dashboard-density.png`, opened and inspected at 1272x946. The screenshot shows the compact Home surface inside the Portal preview with connector auth states, compact composer, model chips, Brief actions and the first recommendation card. It is retained as density evidence only. |
| L2 Visual / Gate Baseline | `tmp/agent-lobehub-l2-screenshots/home-ci-compact-dashboard-scoped.png`, opened and inspected at 1320x900. CDP clipped `.pt-home-shell.is-compact-home`; metadata `tmp/agent-lobehub-home-ci-scoped-screenshot-meta.json` reports `portalChromeHit=false`, `className="pt-home-shell  is-compact-home"`, and visible text covering connector strip, Lobe AI selector, compact composer, model chips, Brief actions and recommendation card. `EVID-011-CJ-pre` promotes this clean scoped CI screenshot plus `tmp/agent-lobehub-home-ci-dom.json` into the active compact artifact gate for Home. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-home-ci-dom.json`: `compactHome=true`, `connectorButtons=5`, `connectedConnectors=3`, `authRequiredConnectors=2`, `recommendedModelChips=4`, `briefDivider=true`, `briefArtifacts=2`, `briefActions=["View run","Confirm"]`, `recommendationCards=3`, `recommendationMetaRows=3`, `recommendationAuthLabels=["Calendar required","Web + Drive","No connector"]`, `legacyHeroAbsent=true`, `deepInspectionMenusAbsent=true`, `forbiddenHits=[]`. |

## 4. Remaining Risk

CI improves the Home compact dashboard density and DailyBrief/TaskTemplate
structure, but it still does not implement real LobeHub `AgentSelect` loading
states, typewriter timing, random input banner dismissal, `ModelSwitchPanel`
group/search behavior, connector OAuth popup flow, task creation side effects or
store-backed Brief resolution. Those remain post-confirmation migration or
future prototype-deepening work.

## 5. Claim Boundary

`EVID-011-CI-pre` proves a Home prototype follow-up revision with L1 source
anchors, L2 visual inspection and L3 DOM proof. `EVID-011-CJ-pre` proves the
clean scoped Home CI artifact is strong enough for the active compact artifact
gate. Neither evidence row confirms Home, replaces Owner judgment, creates or
authorizes `EVID-012`, or allows Desktop / Station / Model product migration.

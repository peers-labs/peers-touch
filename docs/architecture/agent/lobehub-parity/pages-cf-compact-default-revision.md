# Agent LobeHub Parity - Pages Compact Default Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Pages compact default revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CF-pre, EVID-011-CN-pre

---

## 1. Purpose

`EVID-011-BW-pre` proved deep Pages interaction states, but the default
Owner-facing Pages view still opened directly into a selected page editor. LobeHub
`/page` defaults to a Pages landing surface: a left Pages sidebar and a central
`PageExplorerPlaceholder` with create, upload and Notion import actions.

This revision changes default Pages to that compact placeholder baseline while
preserving `state=deep-pages` for BW deep inspection.

`EVID-011-CN-pre` promotes the default Pages view from the earlier CF wide
screenshot into a clean scoped `.pt-pages-layout.is-compact-pages` L2/L3
artifact for the active compact-baseline gate.

## 2. Revision Scope

| Live / Prototype Delta | CF Revision |
| --- | --- |
| Default Pages opened with a selected editor, page meta and Page Agent panel | Default `?surface=pages&check=cf` now renders a compact `/page` placeholder baseline. |
| LobeHub `/page` keeps the Pages sidebar visible before a page is selected | Kept Private / Workspace buckets, search and page rows in the left sidebar. |
| LobeHub placeholder centers three start actions | Added `New document`, `Upload files` and `Import Notion` cards. |
| Editor/history/Copilot states should not be visible by default | DOM evidence proves drawer, history, compare, editor canvas and Page Agent are absent by default. |
| BW deep interaction evidence still needed | Preserved `?surface=pages&state=deep-pages&check=bw` for drawer, item menu, editor actions, history, compare and Copilot review. |
| Active compact artifact gate still used the CF wide screenshot | CN adds a clean scoped `.pt-pages-layout.is-compact-pages` screenshot and DOM artifact so Owner/gate evidence validates the Pages surface itself, not a broad capture. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; source anchors `external/lobehub/src/routes/(main)/page/index.tsx`, `external/lobehub/src/routes/(main)/page/_layout/index.tsx`, `external/lobehub/src/features/Pages/PageLayout/index.tsx`, `external/lobehub/src/features/Pages/PageLayout/Header/index.tsx`, `external/lobehub/src/features/Pages/PageLayout/Body/index.tsx`, `external/lobehub/src/features/PageExplorer/PageExplorerPlaceholder.tsx`, `external/lobehub/src/features/PageEditor/PageEditor.tsx`, `external/lobehub/src/features/PageEditor/RightPanel/index.tsx`. |
| L2 Visual | CF prototype screenshot `tmp/agent-lobehub-l2-screenshots/pages-cf-compact-pages-placeholder-wide.png`, opened and inspected at 1320x414. CN clean scoped screenshot `tmp/agent-lobehub-l2-screenshots/pages-cn-compact-pages-scoped.png`, clipped to `.pt-pages-layout.is-compact-pages` and opened/inspected at 1320x415. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-pages-cf-dom.json`: `compactPages=true`, `compactLayout=true`, `sidebar=true`, `privateBucket=true`, `workspaceBucket=true`, `pageRows=4`, `placeholder=true`, `actionCards=3`, `createNewDocument=true`, `uploadFiles=true`, `importNotion=true`, `drawerAbsentByDefault=true`, `historyAbsentByDefault=true`, `compareAbsentByDefault=true`, `editorCanvasAbsentByDefault=true`, `pageAgentAbsentByDefault=true`, `forbiddenHits=[]`. `tmp/agent-lobehub-pages-cn-dom.json`: `root=true`, `compactPages=true`, `compactShell=true`, `scopedSelector=".pt-pages-layout.is-compact-pages"`, `pageRows=4`, `placeholder=true`, `actionCards=3`, `actionCardsVisible=true`, `stateBoxVisible=true`, `forbiddenHits=[]`, `portalChromeHit=false`. Metadata `tmp/agent-lobehub-pages-cn-scoped-screenshot-meta.json` records the scoped clip. |

## 4. Remaining Risk

This revision improves default Pages visual parity only. It does not prove real
document creation, upload/import pipelines, store-backed search, command-menu
search, virtualized drawer rows, editor lock heartbeat, history restore/compare
side effects, Copilot streaming/tool execution or product GATE-008 checks.

## 5. Claim Boundary

`EVID-011-CF-pre` proves a Pages compact default prototype revision with L2/L3
evidence. `EVID-011-CN-pre` proves the clean scoped Pages artifact is strong
enough for the active compact artifact gate. Neither confirms Pages, creates or
authorizes `EVID-012`, or allows Desktop / Station / Model product migration.

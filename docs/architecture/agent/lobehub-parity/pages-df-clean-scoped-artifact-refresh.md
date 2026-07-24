# Agent LobeHub Parity - Pages Clean Scoped Artifact Refresh

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Pages compact artifact refresh / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-DF-pre

---

## 1. Purpose

`EVID-011-CF-pre` moved Pages to the LobeHub `/page` default structure and
`EVID-011-CN-pre` attempted to promote a clean scoped artifact. Visual inspection
of `pages-cn-compact-pages-scoped.png` found polluted content outside the Pages
surface, so CN is retained as historical evidence only.

`EVID-011-DF-pre` refreshes the active Pages compact artifact with a scoped
isolated capture and tightens the default Pages first screen to better match
LobeHub Workspace mode: the global Pages header does not own the new-page action,
Private / Workspace buckets own their compact add actions, and the central
`PageExplorerPlaceholder` shows only the default three entry cards until the
user clicks an action.

## 2. Source Anchors

| LobeHub Source | Relevance |
| --- | --- |
| `external/lobehub/src/routes/(main)/page/index.tsx` | Default `/page` renders `PageExplorerPlaceholder`, not the editor. |
| `external/lobehub/src/features/Pages/PageLayout/index.tsx` | Wraps Pages sidebar, main `Outlet`, and data sync. |
| `external/lobehub/src/features/Pages/PageLayout/Header/index.tsx` | Workspace mode does not place the create button in the global Pages header. |
| `external/lobehub/src/features/Pages/PageLayout/Body/index.tsx` | Workspace mode owns `Private` and `Workspace` accordion buckets plus compact add actions. |
| `external/lobehub/src/features/PageExplorer/PageExplorerPlaceholder.tsx` | Defines the default centered `New document`, `Upload files`, and `Import Notion` cards. |
| `external/lobehub/src/features/PageEditor/PageEditor.tsx` | Editor is a detail route boundary and must stay out of the compact default artifact. |
| `external/lobehub/src/features/PageEditor/RightPanel/index.tsx` | Copilot right panel is a detail/deep state and must not be faked as default success. |

## 3. Revision Scope

| Delta | DF Handling |
| --- | --- |
| CN screenshot was not visually clean enough for Owner L2 review | Generated `pages-df-compact-pages-scoped.png` from a scoped-isolated `.pt-pages-layout.is-compact-pages` body. |
| Compact Pages header still exposed a global new-page button | Removed the global header button in compact Workspace mode. |
| Private / Workspace buckets lacked source-like local add affordances | Added compact `New private page` and `New workspace page` icon buttons in the bucket headers. |
| Default placeholder displayed a local action feedback pill before any click | State feedback is now absent by default and appears only after a prototype action click. |
| Editor / history / compare / Copilot could be mistaken for default success | DF DOM keeps drawer, history, compare, editor canvas and Page Agent absent by default. |

## 4. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors listed above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/pages-df-compact-pages-scoped.png`, captured via CDP from `http://localhost:3200/?surface=pages&check=df`, scoped-isolated to `.pt-pages-layout.is-compact-pages`, opened and inspected at `1720x920`. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-pages-df-dom.json`: `compactPages=true`, `compactShell=true`, `headerGlobalNewButtonAbsent=true`, `privateBucket=true`, `workspaceBucket=true`, `bucketAddButtons=[\"New private page\",\"New workspace page\"]`, `actionCards=3`, `stateBoxAbsentByDefault=true`, `drawerAbsentByDefault=true`, `historyAbsentByDefault=true`, `compareAbsentByDefault=true`, `editorCanvasAbsentByDefault=true`, `pageAgentAbsentByDefault=true`, `forbiddenHits=[]`, `portalChromeHit=false`. Metadata lives at `tmp/agent-lobehub-pages-df-scoped-screenshot-meta.json`. |

## 5. Remaining Risk

This artifact refresh proves the default Pages review surface and a clean L2/L3
capture only. It does not prove real document creation, upload parsing, Notion
ZIP import, list mutations, drawer virtualization, editor autosave/lock,
history restore/compare, Copilot streaming/tool execution, or product GATE-008
checks.

## 6. Claim Boundary

`EVID-011-DF-pre` promotes Pages from CN history to a clean DF active compact
artifact. It does not confirm Pages, does not authorize `EVID-012`, and does not
allow Desktop / Station / Model product migration.

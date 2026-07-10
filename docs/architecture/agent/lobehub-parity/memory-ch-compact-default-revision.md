# Agent LobeHub Parity - Memory Compact Default Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Memory compact default revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CH-pre, EVID-011-CP-pre

---

## 1. Purpose

`EVID-011-BQ-pre` proved Memory deep interaction states such as category list,
detail panel, analysis modal, edit modal, loading and not-found. LobeHub
`/memory` defaults to the Memory Home route: sidebar navigation, `NavHeader`,
Home scroll container, `RoleTagCloud`, `PersonaHeader` and `Persona`.

This revision changes default Memory to that compact Home baseline while
preserving BQ review states such as `state=deep-memory`, `state=detail-missing`,
`state=detail-loading`, `state=analysis-open`, `state=edit-memory`,
`state=memory-loading` and `state=memory-error`.

`EVID-011-CP-pre` promotes that default Memory baseline from the earlier CH wide
screenshot into a clean scoped `.pt-memory-layout.is-compact-memory` L2/L3
artifact for the active compact-baseline gate.

## 2. Revision Scope

| Live / Prototype Delta | CH Revision |
| --- | --- |
| Default Memory opened like a Preferences/detail review surface | Default `?surface=memory&check=ch` now renders compact `/memory` Home. |
| LobeHub sidebar starts with Search command item and then memory categories | Added Search, Home, Identities, Contexts, Preferences, Experiences and Activities in order. |
| LobeHub Home centers RoleTagCloud and Persona content inside a scroll container | Added compact Home shell with role tags, Persona summary/detail and recovery note. |
| Category list/detail states should not be visible by default | DOM evidence proves filter bar, list, detail panel, analysis status/modal and edit modal are absent by default. |
| Existing BQ deep evidence remains needed | Preserved old review states for category list, timeline/grid, detail panel, analysis modal, edit modal, loading and missing-detail inspection. |
| Active compact artifact gate still used the CH wide screenshot | CP adds a clean scoped `.pt-memory-layout.is-compact-memory` screenshot and DOM artifact so Owner/gate evidence validates the Memory surface itself, not a broad capture. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; source anchors `external/lobehub/src/routes/(main)/memory/_layout/index.tsx`, `external/lobehub/src/routes/(main)/memory/_layout/Sidebar/Header/Nav.tsx`, `external/lobehub/src/routes/(main)/memory/(home)/index.tsx`, `external/lobehub/src/routes/(main)/memory/(home)/features/Persona/index.tsx`, `external/lobehub/src/routes/(main)/memory/(home)/features/Persona/PersonaHeader.tsx`, `external/lobehub/src/routes/(main)/memory/(home)/features/Persona/PersonaSummary.tsx`, `external/lobehub/src/routes/(main)/memory/(home)/features/RoleTagCloud/index.tsx`, `external/lobehub/src/routes/(main)/memory/features/ActionBar/index.tsx`, `external/lobehub/src/routes/(main)/memory/features/MemoryAnalysis/index.tsx`. |
| L2 Visual | Final CH prototype screenshot `tmp/agent-lobehub-l2-screenshots/memory-ch-compact-home-wide.png`, opened and inspected at 1320x496. CP clean scoped screenshot `tmp/agent-lobehub-l2-screenshots/memory-cp-compact-home-scoped.png`, captured from `http://localhost:3200/?surface=memory&state=compact-memory&check=cp` after selecting `Agent LobeHub Parity` in Prototype Portal, clipped to `.pt-memory-layout.is-compact-memory`, opened and inspected at 1320x747. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-memory-ch-dom.json`: `compactMemory=true`, `compactLayout=true`, `memoryNav=true`, `navButtons=7`, `searchItem=true`, `homeActive=true`, `memoryHomeShell=true`, `scrollContainer=true`, `asyncBoundary=true`, `toolbarButtons=3`, `roleCloud=true`, `roleTags=8`, `personaPanel=true`, `personaDetail=true`, `memoryListAbsentByDefault=true`, `filterBarAbsentByDefault=true`, `detailPanelAbsentByDefault=true`, `analysisModalAbsentByDefault=true`, `analysisStatusAbsentByDefault=true`, `editModalAbsentByDefault=true`, `layoutWidth=1320`, `forbiddenHits=[]`. CP DOM `tmp/agent-lobehub-memory-cp-dom.json`: `root=true`, `compactMemory=true`, `compactShell=true`, `scopedSelector=".pt-memory-layout.is-compact-memory"`, `memoryNav=true`, `navButtons=7`, `searchItem=true`, `homeActive=true`, `memoryHomeShell=true`, `scrollContainer=true`, `asyncBoundary=true`, `toolbarButtons=3`, `roleCloud=true`, `roleTags=8`, `personaPanel=true`, `personaDetail=true`, `homeRecovery=true`, `memoryListAbsentByDefault=true`, `filterBarAbsentByDefault=true`, `detailPanelAbsentByDefault=true`, `analysisModalAbsentByDefault=true`, `analysisStatusAbsentByDefault=true`, `editModalAbsentByDefault=true`, `forbiddenHits=[]`, `portalChromeHit=false`; metadata `tmp/agent-lobehub-memory-cp-scoped-screenshot-meta.json` records the scoped clip. |

## 4. Remaining Risk

This revision improves default Memory visual parity only. It does not prove real
SWR/AsyncBoundary fetching, BrandTextLoading timing, page error retry, empty
state analysis flow, tag-cloud canvas rendering, DateRange analysis modal,
store-backed purge/analyze/edit/delete mutations, category-specific right panels,
virtualized timeline/grid lists or product GATE-008 checks.

## 5. Claim Boundary

`EVID-011-CH-pre` proves a Memory compact default prototype revision with L2/L3
evidence. `EVID-011-CP-pre` proves the clean scoped Memory artifact is strong
enough for active compact artifact validation. Neither evidence confirms Memory,
creates or authorizes `EVID-012`, or allows Desktop / Station / Model product
migration.

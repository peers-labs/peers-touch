# Agent LobeHub Parity - Resources Compact Default Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Resources compact default revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CG-pre, EVID-011-CO-pre

---

## 1. Purpose

`EVID-011-BN-pre..EVID-011-BP-pre` proved ResourceManager review states such as
search overlay, file drawer, action menu, drag overlay, upload dock and chunk
drawer. The default Owner-facing Resources view still needed a compact baseline
that starts from the LobeHub `/resource` explorer rather than from a combined
deep-review state.

This revision changes default Resources to a compact ResourceManager explorer
baseline while preserving existing review states such as `state=search-open`,
`state=deep-resource`, `drawer=1`, `actions=1`, `chunk=1`, `uploadDock=1` and
`drag=1`.

`EVID-011-CO-pre` promotes that default Resources baseline from the earlier CG
wide screenshot into a clean scoped `.pt-resource-layout.is-compact-resources`
L2/L3 artifact for the active compact-baseline gate.

## 2. Revision Scope

| Live / Prototype Delta | CG Revision |
| --- | --- |
| Default Resources review material emphasized overlay/drawer/deep states | Default `?surface=resources&check=cg` now renders a compact explorer baseline. |
| LobeHub `/resource` keeps a resource sidebar with visibility, categories and knowledge-base list | Added compact sidebar with Private / Workspace, All / Documents / Images / Audios / Videos and Knowledge bases. |
| LobeHub ResourceManager explorer keeps NavHeader actions and a list/masonry content rail | Added compact header with Search, Sort, Batch, List, Masonry and Add controls plus 48px resource rows. |
| Deep ResourceManager states should not be visible by default | DOM evidence proves search overlay, file drawer, chunk drawer, upload dock, drag overlay and detail preview are absent by default. |
| Existing BP deep evidence remains needed | Preserved `state=deep-resource` and old review-state URLs for overlay, drawer, action menu, upload dock and chunk drawer inspection. |
| Active compact artifact gate still used the CG wide screenshot | CO adds a clean scoped `.pt-resource-layout.is-compact-resources` screenshot and DOM artifact so Owner/gate evidence validates the Resources surface itself, not a broad capture. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; source anchors `external/lobehub/src/routes/(main)/resource/(home)/index.tsx`, `external/lobehub/src/routes/(main)/resource/(home)/_layout/index.tsx`, `external/lobehub/src/routes/(main)/resource/(home)/_layout/Header/index.tsx`, `external/lobehub/src/routes/(main)/resource/(home)/_layout/Header/CategoryMenu.tsx`, `external/lobehub/src/routes/(main)/resource/(home)/_layout/Body/LibraryList/index.tsx`, `external/lobehub/src/features/ResourceManager/index.tsx`, `external/lobehub/src/features/ResourceManager/components/Explorer/index.tsx`, `external/lobehub/src/features/ResourceManager/components/Explorer/Header/index.tsx`, `external/lobehub/src/features/ResourceManager/components/Explorer/ListView/index.tsx`, `external/lobehub/src/features/ResourceManager/components/Explorer/SearchResultsOverlay.tsx`, `external/lobehub/src/features/ResourceManager/components/UploadDock/index.tsx`, `external/lobehub/src/features/ResourceManager/components/ChunkDrawer/index.tsx`. |
| L2 Visual | Final CG prototype screenshot `tmp/agent-lobehub-l2-screenshots/resources-cg-compact-explorer-wide.png`, opened and inspected at 1320x496. CO clean scoped screenshot `tmp/agent-lobehub-l2-screenshots/resources-co-compact-explorer-scoped.png`, captured from `http://localhost:3200/?surface=resources&state=compact-resources&check=co` after selecting `Agent LobeHub Parity` in Prototype Portal, clipped to `.pt-resource-layout.is-compact-resources`, opened and inspected at 1320x554. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-resources-cg-dom.json`: `compactResources=true`, `compactLayout=true`, `sidebar=true`, `visibilityTabs=2`, `categories=5`, `hasAudios=true`, `hasVideos=true`, `knowledgeBaseList=true`, `explorer=true`, `navHeader=true`, `toolbarButtons=6`, `resourceList=true`, `tableHead=true`, `resourceRows=4`, `searchOverlayAbsentByDefault=true`, `drawerAbsentByDefault=true`, `chunkDrawerAbsentByDefault=true`, `uploadDockAbsentByDefault=true`, `dragOverlayAbsentByDefault=true`, `previewPanelAbsentByDefault=true`, `layoutWidth=1320`, `forbiddenHits=[]`. CO DOM `tmp/agent-lobehub-resources-co-dom.json`: `root=true`, `compactResources=true`, `compactShell=true`, `scopedSelector=".pt-resource-layout.is-compact-resources"`, `sidebar=true`, `visibilityTabs=2`, `categories=5`, `toolbarButtons=6`, `resourceRows=4`, `stateBoxVisible=true`, `forbiddenHits=[]`, `portalChromeHit=false`; metadata `tmp/agent-lobehub-resources-co-scoped-screenshot-meta.json` records the scoped clip. |

## 4. Remaining Risk

This revision improves default Resources visual parity only. It does not prove
real SWR loading/error/empty precedence, virtualized list rendering, column
resize, selection/batch semantics, knowledge-base creation, folder navigation,
row context-menu side effects, native drag/drop movement, upload pipeline,
file preview modal, chunk editor behavior or product GATE-008 checks.

## 5. Claim Boundary

`EVID-011-CG-pre` proves a Resources compact default prototype revision with
L2/L3 evidence. `EVID-011-CO-pre` proves the clean scoped Resources artifact is
strong enough for active compact artifact validation. Neither evidence confirms
Resources, creates or authorizes `EVID-012`, or allows Desktop / Station / Model
product migration.

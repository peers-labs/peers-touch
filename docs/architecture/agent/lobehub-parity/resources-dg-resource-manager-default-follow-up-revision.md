# Agent LobeHub Parity - Resources ResourceManager Default Follow-up Revision

> **Status**: pending-review / not confirmed
> **Plan Step**: PLAN-P2 Resources ResourceManager default follow-up / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-DG-pre
> **BOM / Spec / Gate**: BOM-005, BOM-012, BOM-015 / SPEC-006, SPEC-010, SPEC-013, SPEC-014 / GATE-003, GATE-004, GATE-006, GATE-008

---

## Purpose

`EVID-011-CO-pre` promoted Resources into the clean scoped active compact
artifact gate, but the first screen still carried non-default noise: sidebar
add/search affordances and a persistent selection state box. LobeHub's default
`/resource` route is a ResourceManager explorer: sidebar navigation plus a
single explorer header action rail, with editor, page editor, upload dock,
chunk drawer, search overlay and file detail deferred to explicit states.

`EVID-011-DG-pre` refreshes the active Resources compact artifact around that
default ResourceManager boundary while preserving Peers ownership language.

## Source Anchors

- `external/lobehub/src/routes/(main)/resource/(home)/index.tsx`
- `external/lobehub/src/routes/(main)/resource/(home)/_layout/index.tsx`
- `external/lobehub/src/routes/(main)/resource/(home)/_layout/Header/index.tsx`
- `external/lobehub/src/routes/(main)/resource/(home)/_layout/Header/CategoryMenu.tsx`
- `external/lobehub/src/routes/(main)/resource/(home)/_layout/Body/LibraryList/index.tsx`
- `external/lobehub/src/features/ResourceManager/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/Header/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Header/AddButton.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/ListView/index.tsx`

## Delta Closed

| CO gap | DG revision |
| --- | --- |
| Sidebar had an extra add icon not present in the default root sidebar boundary. | Removed the sidebar add action; Add is owned by the explorer header action rail. |
| Sidebar exposed a second search entry, duplicating the explorer header search. | Removed sidebar search; search remains in the ResourceManager header. |
| Default screenshot showed a persistent selection state box, implying a detail/preview state by default. | Default compact state now hides the selection state box until a row action changes state. |
| Add menu was too flat and missed the LobeHub action ordering. | Add menu now presents New page, Upload file, Upload folder, Import URL and Import Notion. |

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; source anchors above; explorer audit result from `resources_surface_l1_audit`. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/resources-dg-compact-explorer-scoped.png`, captured through Prototype Portal from `http://localhost:3200/?surface=resources&state=compact-resources&check=dg`, clipped to `.pt-resource-layout.is-compact-resources`, opened and inspected at `1320x495`. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-resources-dg-dom.json`: `compactResources=true`, `compactShell=true`, `sidebarHeaderAddAbsent=true`, `sidebarSearchAbsent=true`, `visibilityTabs=2`, `categories=5`, `knowledgeBaseList=true`, `navHeader=true`, `toolbarButtons=6`, `addMenuAbsentByDefault=true`, `searchOverlayAbsentByDefault=true`, `drawerAbsentByDefault=true`, `chunkDrawerAbsentByDefault=true`, `uploadDockAbsentByDefault=true`, `dragOverlayAbsentByDefault=true`, `previewPanelAbsentByDefault=true`, `stateBoxAbsentByDefault=true`, `resourceRows=4`, `forbiddenHits=[]`, `portalChromeHit=false`. Metadata lives at `tmp/agent-lobehub-resources-dg-scoped-screenshot-meta.json`. |

## Remaining Risk

DG is still prototype evidence only. It does not prove SWR loading/error/empty
states, virtualization, true folder movement, rename/delete/publish mutations,
native drag/drop upload, file preview rendering, chunk editing or Station-backed
resource ownership.

## Claim Boundary

`EVID-011-DG-pre` promotes Resources from CO history to the active compact
artifact gate for the default ResourceManager first screen. It does not confirm
Resources, does not authorize `EVID-012`, and does not allow Desktop / Station /
Model product migration.

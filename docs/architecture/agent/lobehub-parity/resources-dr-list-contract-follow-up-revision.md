# Resources DR List Contract Follow-up Revision

> Evidence: `EVID-011-DR-pre`
> Surface: Resources
> Prototype URL: `?surface=resources&state=resource-list-contract&check=dr`
> Status: prototype evidence only; pending Owner review.

## Source Anchors

- `external/lobehub/src/features/ResourceManager/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/Header/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/Header/SearchInput.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/ToolBar/BatchActionsDropdown.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/ToolBar/SortDropdown.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/ToolBar/ViewSwitcher.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/ListView/ListViewHeader.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/ListView/ListViewSelectAllHint.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/SearchResultsOverlay.tsx`

## DG Gap

`EVID-011-DG-pre` made the compact ResourceManager default cleaner than CO, but still under-expressed LobeHub's list contract:

- Header left content switches from breadcrumb/category to batch action icons when resources are selected.
- Search is an expanding input owned by the Explorer header, not a detached overlay-only button.
- ListView has a checkbox column, list header columns, select-all hint and virtualized row geometry.
- Fetch errors are handled before empty state via the Explorer `AsyncBoundary`; no-data and failed-query states must not be visually conflated.

## DR Revision

`EVID-011-DR-pre` adds a dedicated `resource-list-contract` compact state:

- `data-review-marker="resources-list-contract-dr"` on the scoped Resources artifact.
- selected-actions strip with Move / Chunk / Delete states and permission-disabled Move.
- expanded header search input with clear affordance.
- fail-closed async error precedence row with retry action.
- list header checkbox plus `Name / Created at / Uploader / Size` columns.
- select-all hint for loaded rows vs all resources.
- virtualized-list boundary note, without rendering hidden rows or product data stores.

## L2 / L3 Evidence

- L2 screenshot: `tmp/agent-lobehub-l2-screenshots/resources-dr-list-contract-scoped.png`
- L3 DOM: `tmp/agent-lobehub-resources-dr-dom.json`
- Screenshot metadata: `tmp/agent-lobehub-resources-dr-scoped-screenshot-meta.json`

DOM evidence proves:

- `marker=resources-list-contract-dr`
- `compactResources=true`
- `selectedActions=true`
- `asyncErrorPrecedence=true`
- `searchInputExpanded=true`
- `listHeaderHasCheckbox=true`
- `selectAllHint=true`
- `virtualizedBoundary=true`
- `createdAtColumn=true`
- `uploaderColumn=true`
- `forbiddenHits=[]`
- `portalChromeHit=false`

## Claim Boundary

`EVID-011-DR-pre` promotes Resources from DG ResourceManager default history to the active compact artifact gate for list header, select-all, batch action, async error-first and virtualized-list contract review. It does not confirm Resources, does not authorize `EVID-012`, and does not allow Desktop / Station / Model product migration.

## Remaining Gaps

- Real Resource store, SWR query, retry and mutation behavior remain unproven.
- Real file upload, folder upload, Notion import and chunk drawer behavior remain deep-inspection only.
- Real virtualized list performance, selection across paginated resources and permission-denied flows require product-side GATE-008 evidence after Owner confirmation.

# Settings DS Provider Detail Follow-Up Revision

> Evidence: EVID-011-DS-pre
> Scope: BOM-003 / BOM-012, SPEC-003 / SPEC-010 / SPEC-013 / SPEC-014, PLAN-P2, GATE-003 / GATE-004 / GATE-006 / GATE-008
> Status: pending Owner judgment; product migration blocked

## Source Anchors

- `external/lobehub/src/routes/(main)/settings/provider/detail/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/detail/default/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ProviderConfig/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ModelList/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/ProviderMenu/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/ProviderMenu/List.tsx`
- `docs/client/common/ui-identity/frontend-component-tree-registry.md` Settings provider rows

## CR Gap

`EVID-011-CR-pre` promoted a clean scoped Settings default Provider grid artifact. That is still useful historical evidence, but it only proves the `all` provider overview. It does not prove the LobeHub source-backed selected provider detail shape where Settings renders one selected provider schema with `ProviderConfig`, permission-aware controls and a `ModelList`.

## DS Revision

`EVID-011-DS-pre` adds a compact selected-provider detail state at:

`?surface=settings&state=provider-detail&check=ds`

The DS state keeps the LobeHub-like Settings shell and ProviderMenu, then switches the right pane from the all-provider grid to a selected OpenAI provider detail:

- selected provider header and enable switch
- `manage_provider_key` permission status
- ProviderConfig-like API key, base URL, client fetch and Responses API controls
- explicit permission-disabled row with blocked action reason
- ModelList-like title actions, model type tabs and enabled/disabled rows
- selected-only mounting marker: `data-review-marker="settings-provider-detail-ds"`

The implementation intentionally stays in the prototype layer and keeps Peers Touch UI Identity constraints: quiet surfaces, selected-only section boundary, no product runtime/store mutations.

## Evidence

### L1 Static

- Prototype: `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`
- Styles: `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`
- Source anchors listed above.

### L2 Visual

- Screenshot: `tmp/agent-lobehub-l2-screenshots/settings-ds-provider-detail-scoped.png`
- Metadata: `tmp/agent-lobehub-settings-ds-scoped-screenshot-meta.json`
- Captured through Chrome CDP with a 1900x1100 viewport and scoped to `.pt-settings-compact-layout`.
- Opened and visually inspected: the screenshot shows Settings nav, ProviderMenu, selected OpenAI detail, permission strip, ProviderConfig, permission-disabled row and ModelList.

### L3 Dynamic / DOM

- DOM artifact: `tmp/agent-lobehub-settings-ds-dom.json`
- Key proof:
  - `compactSettings=true`
  - `providerDetail=true`
  - `allProvidersActive=false`
  - `selectedProviderLabel="OpenAI"`
  - `providerConfigPanel=true`
  - `permissionDisabledRow=true`
  - `modelListPanel=true`
  - `modelRows=4`
  - `disabledModelRows=1`
  - `mountedProviderDetailMarkers=1`
  - `providerGridAbsentInDetail=true`
  - `fetchErrorAfterClick=true`
  - `retryButtonAfterFetch=true`
  - `forbiddenHits=[]`
  - `portalChromeHit=false`

## Claim Boundary

`EVID-011-DS-pre` promoted Settings from CR history to the selected ProviderConfig and ModelList detail state. After `EVID-011-DT-pre` and `EVID-011-DV-pre`, DS is retained as historical Provider detail evidence, DT is retained as historical category-gates / credentials / OAuth evidence, and DV is the active Settings compact artifact gate. DS does not confirm Settings, does not authorize `EVID-012`, and does not allow Desktop / Station / Model product migration.

Remaining Settings gaps include real store-backed provider/model mutations, OAuth device flow, remote model fetch service behavior, full provider-specific schemas, API key management table, dynamic Settings category gates and non-provider Settings pages.

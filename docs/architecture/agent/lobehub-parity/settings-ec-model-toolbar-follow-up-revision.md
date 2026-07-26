# Settings EC Model Toolbar Follow-Up Revision

> Evidence: EVID-011-EC-pre
> Scope: BOM-003 / BOM-012 / BOM-015, SPEC-003 / SPEC-010 / SPEC-013 / SPEC-014, PLAN-P2, GATE-003 / GATE-004 / GATE-005 / GATE-006 / GATE-008
> Status: pending Owner judgment; product migration blocked

## Source Anchors

- `external/lobehub/src/routes/(main)/settings/provider/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/_layout/Desktop/Container.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/detail/default/ProviderDetialPage.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/detail/default/CustomProviderDetail.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ModelList/EnabledModelList/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ModelList/ModelTitle/index.tsx`
- `external/lobehub/src/store/aiInfra/slices/aiProvider/action.ts`
- `external/lobehub/src/store/aiInfra/slices/aiModel/action.ts`
- `docs/client/desktop/provider-model-target-architecture.md`
- `docs/client/desktop/runtime-projections.md`

## DV Gap

`EVID-011-DV-pre` promoted Settings provider/model runtime-contract review:
ProviderConfig draft/save/checker, model rows, row loading/rollback and OAuth
device-flow ownership. It did not yet expose enough of LobeHub's `ModelTitle`
and `EnabledModelList` behavior:

- sticky model toolbar with model search, remote fetch, clear remote models, add
  custom model and reset confirmation;
- `manage_provider_key` permission-disabled controls that stay visible with a
  reason instead of disappearing;
- per-tab empty state that does not clear the whole provider list;
- batch disable and sort actions owned by `EnabledModelList`;
- explicit mapping to Peers Touch base-settings Provider Registry / Desktop
  projection / future Station sync ownership.

## EC Revision

`EVID-011-EC-pre` adds a Settings provider runtime contract state at:

`?surface=settings&state=provider-runtime-contract&check=ec`

The EC state keeps the DV ProviderConfig / checker / OAuth contract and adds:

- `data-review-marker="settings-provider-runtime-ec"`
- `data-evidence-id="EVID-011-EC-pre"`
- `data-model-title-toolbar-state="sticky-search|fetch-remote|clear-remote|add-model|reset-confirm"`
- `data-enabled-model-list-state="all-tab|chat-tab-empty|batch-disable|sort-modal|permission-disabled"`
- a LobeHub-like `ModelTitle` toolbar with search, remote fetch, clear remote,
  add custom and reset actions;
- disabled batch actions with explicit `Missing manage_provider_key permission`
  reasons;
- an empty image-tab branch that preserves the selected provider list and keeps
  recovery local to `ModelList`.

This remains a prototype expression. It does not create real provider/model
mutations and does not bypass the Peers Touch Provider Registry architecture.

## Evidence

### L1 Static

- Prototype: `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`
- Styles: `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`
- Source anchors listed above.

### L2 Visual

- Screenshot: `tmp/agent-lobehub-l2-screenshots/settings-ec-provider-runtime-scoped.png`
- Metadata: `tmp/agent-lobehub-settings-ec-scoped-screenshot-meta.json`
- SHA-256: `8d53b574dac3381b48e5ac83ae148fd1672896053ba18b92ab6b19c79a9a647c`
- Captured with isolated Google Chrome headless from the EC URL and opened with
  `view_image`.
- Visual inspection confirmed: Settings shell, provider/model contract header,
  ProviderConfig draft/save/checker panel, ModelTitle toolbar, remote model
  actions, permission-disabled batch actions, empty tab state, model rows,
  toggle rollback and OAuth device-flow are visible and readable.

### L3 Dynamic / DOM

- DOM artifact: `tmp/agent-lobehub-settings-ec-dom.json`
- Key proof:
  - `marker="settings-provider-runtime-ec"`
  - `evidenceId="EVID-011-EC-pre"`
  - `runtimeContractShell=true`
  - `providerModelIdentity="openai/gpt-4.1"`
  - `providerConfigState="draft-secret|save-error|checker-json|fetch-policy"`
  - `modelTitleToolbarState="sticky-search|fetch-remote|clear-remote|add-model|reset-confirm"`
  - `enabledModelListState="all-tab|chat-tab-empty|batch-disable|sort-modal|permission-disabled"`
  - `contractRowCount=6`
  - `modelTitleToolbar=true`
  - `toolbarButtons=["Fetch models","Clear remote","Add custom","Reset all"]`
  - `disabledActionReasons=["Missing manage_provider_key permission","Missing manage_provider_key permission"]`
  - `emptyTabStateVisible=true`
  - `checkerJsonHasStructuredError=true`
  - `oauthDeviceFlow=true`
  - `forbiddenHits=[]`
  - `portalChromeHit=false`

## Claim Boundary

`EVID-011-EC-pre` promotes Settings from DV provider runtime-contract history to
the active Settings compact artifact gate for ModelTitle / EnabledModelList
runtime review. It does not confirm Settings, does not authorize `EVID-012`, and
does not allow Desktop / Station / Model product migration.

Remaining Settings gaps include real store-backed provider/model/credential
mutations, complete device-flow backend behavior, full Profile/Common/
Appearance/Advanced/Stats/Billing parity, mobile Settings/provider routes and
product GATE-008 implementation checks.

# Settings DV Provider Runtime Contract Follow-Up Revision

> Evidence: EVID-011-DV-pre
> Scope: BOM-003 / BOM-012 / BOM-015, SPEC-003 / SPEC-010 / SPEC-013 / SPEC-014, PLAN-P2, GATE-003 / GATE-004 / GATE-005 / GATE-006 / GATE-008
> Status: pending Owner judgment; product migration blocked

## Source Anchors

- `external/lobehub/src/routes/(main)/settings/provider/features/ProviderConfig/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ProviderConfig/Checker.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ProviderConfig/OAuthDeviceFlowAuth/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ModelList/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ModelList/ModelItem.tsx`
- `external/lobehub/src/store/aiInfra/slices/aiProvider/action.ts`
- `external/lobehub/src/store/aiInfra/slices/aiModel/action.ts`

## DT Gap

`EVID-011-DT-pre` promoted Settings category gates, credentials/OAuth and
non-provider page honesty. That remains useful historical Settings evidence, but
it does not directly prove the ProviderConfig / ModelList runtime contract that
feeds `GATE-005 Provider/model Correctness`: provider + model identity, config
mutation ownership, checker JSON, selected-provider refresh, row-level model
loading, rollback-visible states and OAuth device-flow ownership.

## DV Revision

`EVID-011-DV-pre` adds a Settings provider runtime contract state at:

`?surface=settings&state=provider-runtime-contract&check=dv`

The DV state keeps the LobeHub-like Settings shell, then makes the selected
provider detail runtime contract visible:

- provider + model are shown as one selected identity
- ProviderConfig owns draft API key/base URL, save failure and retry without
  clearing input
- Checker renders structured runtime JSON before any success badge
- ModelList owns tabs, selected-provider refresh, row-level loading and rollback
- model rows distinguish chat, embedding and image capabilities
- OAuthDeviceFlowAuth owns the local device-code state machine
- product Desktop / Station mutations remain explicitly unclaimed

The implementation intentionally stays in the prototype layer and keeps Peers
Touch UI Identity constraints: quiet surface, explicit fail-closed states, no
product runtime/store mutations.

## Evidence

### L1 Static

- Prototype: `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`
- Styles: `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`
- Source anchors listed above.

### L2 Visual

- Screenshot: `tmp/agent-lobehub-l2-screenshots/settings-dv-provider-runtime-scoped.png`
- Metadata: `tmp/agent-lobehub-settings-dv-scoped-screenshot-meta.json`
- Captured through headed Chrome CDP after selecting `Agent LobeHub Parity` in
  Prototype Portal, scoped to `[data-review-marker="settings-provider-runtime-dv"]`.
- Opened and visually inspected: the screenshot shows the Provider + model
  contract header, source contract cards, ProviderConfig draft/save/checker
  panel, ModelList tabs and row-level enabled/disabled model states without
  Portal chrome.
- L2 limitation: the OAuth device-flow card is below the visible scoped first
  screen; its presence and states are covered by the L3 DOM artifact below.

### L3 Dynamic / DOM

- DOM artifact: `tmp/agent-lobehub-settings-dv-dom.json`
- Key proof:
  - `compactSettings=true`
  - `marker="settings-provider-runtime-dv"`
  - `runtimeContractShell=true`
  - `providerModelIdentity=true`
  - `providerIdentityRow=true`
  - `configMutationOwnerRow=true`
  - `checkerTraceRow=true`
  - `modelListRefreshRow=true`
  - `contractRowCount=4`
  - `providerConfigPanel=true`
  - `apiKeyDraftInput=true`
  - `baseUrlDraftInput=true`
  - `checkModelSelect=true`
  - `fetchOnClientPolicy=true`
  - `saveFailurePreservesInput=true`
  - `retrySaveButton=true`
  - `checkerJson=true`
  - `checkerJsonHasProviderModel=true`
  - `checkerJsonHasStructuredError=true`
  - `modelListPanel=true`
  - `modelTabs=["all","chat","embedding","image"]`
  - `models=["gpt-4.1","gpt-4o","text-embedding-3-large","pt-local-vision"]`
  - `enabledModelCount=3`
  - `disabledModelCount=1`
  - `togglePendingVisible=true`
  - `rollbackVisible=true`
  - `oauthDeviceFlow=true`
  - `oauthDeviceCode=true`
  - `oauthStates=["idle","pending_user_auth","polling","error","success"]`
  - `forbiddenHits=[]`
  - `portalChromeHit=false`

## Claim Boundary

`EVID-011-DV-pre` promotes Settings from DT category-gate history to the active
compact artifact gate for provider/model runtime-contract review. It does not
confirm Settings, does not authorize `EVID-012`, and does not allow Desktop /
Station / Model product migration.

Remaining Settings gaps include real store-backed provider/model/credential
mutations, complete device-flow backend behavior, full Profile/Common/
Appearance/Advanced/Stats/Billing parity, mobile Settings/provider routes and
product GATE-008 implementation checks.

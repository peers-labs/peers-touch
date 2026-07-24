# Settings DT Category Gates Follow-Up Revision

> Evidence: EVID-011-DT-pre
> Scope: BOM-003 / BOM-012, SPEC-003 / SPEC-010 / SPEC-013 / SPEC-014, PLAN-P2, GATE-003 / GATE-004 / GATE-006 / GATE-008
> Status: pending Owner judgment; product migration blocked

## Source Anchors

- `external/lobehub/src/routes/(main)/settings/hooks/useCategory.tsx`
- `external/lobehub/src/routes/(main)/settings/_layout/Body/index.tsx`
- `external/lobehub/src/routes/(main)/settings/creds/index.tsx`
- `external/lobehub/src/routes/(main)/settings/creds/features/CredsList.tsx`
- `external/lobehub/src/routes/(main)/settings/creds/features/CreateCredModal/Content.tsx`
- `external/lobehub/src/routes/(main)/settings/creds/features/CreateCredModal/OAuthCredForm.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ProviderConfig/OAuthDeviceFlowAuth/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ProviderConfig/OAuthDeviceFlowAuth/useOAuthDeviceFlow.ts`
- `external/lobehub/src/routes/(main)/settings/service-model/index.tsx`
- `external/lobehub/src/routes/(main)/settings/storage/index.tsx`
- `external/lobehub/src/routes/(main)/settings/about/index.tsx`

## DS Gap

`EVID-011-DS-pre` promoted the selected ProviderConfig and ModelList detail state. That is still useful historical provider-detail evidence, but it does not prove LobeHub's dynamic Settings category gates, credentials/OAuth permission and auth states, OAuth device-code flow honesty, or non-provider Settings pages such as Service Model, Storage and About.

## DT Revision

`EVID-011-DT-pre` adds a compact Settings category-gate state at:

`?surface=settings&state=category-gates&check=dt`

The DT state keeps the LobeHub-like Settings shell, then switches the main content away from Provider detail into a source-backed gate honesty view:

- dynamic category cards for `showProvider`, `showApiKeyManage`, `enableBusinessFeatures`, `isDesktop`, `isDevMode` and `hideDocs`
- permission-disabled credential creation with a visible blocked action
- market-auth and credential-list async boundary states
- OAuth credential empty state with Back action
- OAuth device-code state machine labels: `idle`, `pending_user_auth`, `polling`, `error`, `success`
- non-provider Settings rows for Service Model feature gates, Storage skeleton-before-Advanced and About version/analytics
- provider menu/detail/grid absence markers so DT cannot be mistaken for DS

The implementation intentionally stays in the prototype layer and keeps Peers Touch UI Identity constraints: quiet surface, explicit fail-closed states, no product runtime/store mutations.

## Evidence

### L1 Static

- Prototype: `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`
- Styles: `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`
- Source anchors listed above.

### L2 Visual

- Screenshot: `tmp/agent-lobehub-l2-screenshots/settings-dt-category-gates-scoped.png`
- Metadata: `tmp/agent-lobehub-settings-dt-scoped-screenshot-meta.json`
- Captured through Chrome CDP with a 1900x1700 viewport and scoped to `.pt-settings-compact-layout`.
- Opened and visually inspected: the screenshot shows Settings nav, dynamic gate cards, fail-closed status, Credentials/OAuth panel, OAuth device flow code/state pills, non-provider pages and Storage loading skeleton.

### L3 Dynamic / DOM

- DOM artifact: `tmp/agent-lobehub-settings-dt-dom.json`
- Key proof:
  - `compactSettings=true`
  - `marker="settings-category-gates-dt"`
  - `gateCards=7`
  - `blockedGateCards=4`
  - `hasProviderGate=true`
  - `hasApiKeyGate=true`
  - `hasBusinessGate=true`
  - `hasDesktopGate=true`
  - `hasDevModeGate=true`
  - `credentialRows=4`
  - `createBlockedDisabled=true`
  - `oauthEmptyState=true`
  - `oauthDeviceCode=true`
  - `oauthDeviceStates=["idle","pending_user_auth","polling","error","success"]`
  - `oauthDeviceVisibleInLayout=true`
  - `nonProviderRows=3`
  - `storageSkeleton=true`
  - `aboutAnalytics=true`
  - `serviceModelFeatureFlags=true`
  - `providerMenuAbsent=true`
  - `providerDetailAbsent=true`
  - `providerGridAbsent=true`
  - `forbiddenHits=[]`
  - `portalChromeHit=false`

## Claim Boundary

`EVID-011-DT-pre` promotes Settings from DS provider-detail history to the active compact artifact gate for dynamic category gates, credentials/OAuth and non-provider Settings page honesty. It does not confirm Settings, does not authorize `EVID-012`, and does not allow Desktop / Station / Model product migration.

Remaining Settings gaps include real store-backed provider/model/credential mutations, complete device-flow backend behavior, full Profile/Common/Appearance/Advanced/Stats/Billing parity, mobile Settings/provider routes and product GATE-008 implementation checks.

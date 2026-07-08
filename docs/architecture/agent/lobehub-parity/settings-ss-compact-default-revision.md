# Agent LobeHub Parity - Settings Compact Default Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Settings compact default revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-SS-pre, EVID-011-CR-pre

---

## 1. Purpose

`EVID-011-BS-pre` proved deeper Settings states such as provider menu/search/add,
sort modal, provider config, model-list retry, model config/delete confirmation,
Service Model assignment recovery and Storage retry states. LobeHub Settings
defaults are quieter: `/settings` redirects to Profile, and Provider defaults to
`/settings/provider/all`, rendering the Settings nav shell, a 280px Provider
menu and an `All Providers` grouped card grid.

This revision changes the prototype Settings default Owner view to that compact
Provider baseline while preserving BS review states such as
`state=deep-settings`, `state=service-picker`, `state=model-error`,
`state=model-config`, `state=create-provider`, `state=sort-provider` and
`state=delete-model`.

`EVID-011-CR-pre` promotes that default Settings baseline from the earlier SS
wide screenshot into a clean scoped `.pt-settings-compact-layout` L2/L3 artifact
for the active compact-baseline gate.

## 2. Revision Scope

| Live / Prototype Delta | SS Revision |
| --- | --- |
| Default Settings read like a deep provider-detail workbench | Default `?surface=settings&check=ss` now renders a compact Settings > Provider grid baseline. |
| LobeHub Settings uses grouped sidebar navigation | Added General / Subscription / Agent / System grouped settings nav with Provider active. |
| LobeHub Provider defaults to `all`, not a concrete OpenAI detail | Added `All Providers` active row and grouped provider cards for enabled, custom and disabled providers. |
| LobeHub Provider menu is a 280px rail with SearchBar and Add action | Added compact provider menu with search input, Add custom provider action and provider sections. |
| Deep provider config/modals are not default render | DOM evidence proves provider detail, create provider, sort, model config and delete confirmation are absent by default. |
| Active compact artifact gate still used the SS wide screenshot | CR adds a clean scoped `.pt-settings-compact-layout` screenshot and DOM artifact so Owner/gate evidence validates the Settings surface itself, not a broad capture. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; source anchors `external/lobehub/src/routes/(main)/settings/_layout/index.tsx`, `external/lobehub/src/routes/(main)/settings/_layout/Body/index.tsx`, `external/lobehub/src/routes/(main)/settings/hooks/useCategory.tsx`, `external/lobehub/src/routes/(main)/settings/provider/index.tsx`, `external/lobehub/src/routes/(main)/settings/provider/_layout/Desktop/index.tsx`, `external/lobehub/src/routes/(main)/settings/provider/_layout/Desktop/Container.tsx`, `external/lobehub/src/routes/(main)/settings/provider/ProviderMenu/index.tsx`, `external/lobehub/src/routes/(main)/settings/provider/ProviderMenu/List.tsx`, `external/lobehub/src/routes/(main)/settings/provider/(list)/ProviderGrid/index.tsx`, `external/lobehub/src/routes/(main)/settings/provider/(list)/ProviderGrid/Card.tsx`. |
| L2 Visual | SS history screenshot `tmp/agent-lobehub-l2-screenshots/settings-ss-compact-provider-grid-wide.png`, opened and inspected at 1604x714; active clean scoped CR screenshot `tmp/agent-lobehub-l2-screenshots/settings-cr-compact-provider-grid-scoped.png`, opened and inspected at 1320x900. |
| L3 Dynamic / DOM | SS DOM `tmp/agent-lobehub-settings-ss-dom.json`: `compactSettings=true`, `settingsLayout=true`, `navPanel=true`, `providerLayout=true`, `providerMenu=true`, `providerGrid=true`, `providerMenuWidth=280`, `forbiddenHits=[]`. CR DOM `tmp/agent-lobehub-settings-cr-dom.json`: `root=true`, `compactSettings=true`, `compactShell=true`, `scopedSelector=".pt-settings-compact-layout"`, `navPanel=true`, `providerLayout=true`, `providerMenu=true`, `providerGrid=true`, `navGroups=["General","Subscription","Agent","System"]`, `navItemCount=22`, `activeSettingsTab=Provider`, `searchInput=true`, `addProviderAction=true`, `providerSections=["Enabled Providers","Custom Providers","Disabled Providers"]`, `gridSections=["Enabled Providers","Custom Providers","Disabled Providers"]`, `providerCardCount=4`, `duplicateProviderCards=[]`, `allProvidersActive=true`, default provider detail/create/sort/model config/delete overlays absent, `providerMenuWidth=280`, `forbiddenHits=[]`, `portalChromeHit=false`. Metadata: `tmp/agent-lobehub-settings-cr-scoped-screenshot-meta.json`. |

## 4. Remaining Risk

This revision improves default Settings visual parity only. It does not prove
real provider fetch/SWR behavior, permission-disabled switches, OAuth device
flow, debounced provider saves, encrypted checker JSON, actual provider/model
mutations, full Profile/Common/Appearance/Advanced/Stats/Billing parity or
product GATE-008 checks.

## 5. Claim Boundary

`EVID-011-SS-pre` proves a Settings compact default prototype revision, and
`EVID-011-CR-pre` proves the clean scoped artifact now used by the active
compact-baseline gate. Neither confirms Settings, creates or authorizes
`EVID-012`, or allows Desktop / Station / Model product migration.

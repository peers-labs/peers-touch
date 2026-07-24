# Settings EE Source Interaction Follow-Up Revision

> Evidence: EVID-011-EE-pre
> Scope: BOM-003 / BOM-012 / BOM-015, SPEC-003 / SPEC-005 / SPEC-009 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014, PLAN-P2, GATE-003 / GATE-004 / GATE-005 / GATE-006 / GATE-008
> Status: pending Owner judgment; product migration blocked

## Source Anchors

- `external/lobehub/src/store/aiInfra/store.ts`
- `external/lobehub/src/store/aiInfra/slices/aiProvider/action.ts`
- `external/lobehub/src/store/aiInfra/slices/aiModel/action.ts`
- `external/lobehub/src/libs/swr/keys.ts`
- `external/lobehub/src/services/aiProvider/index.ts`
- `external/lobehub/src/services/aiModel/index.ts`
- `external/lobehub/src/services/models.ts`
- `external/lobehub/src/routes/(main)/settings/provider/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/detail/default/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ProviderConfig/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ProviderConfig/Checker.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ProviderConfig/OAuthDeviceFlowAuth/useOAuthDeviceFlow.ts`
- `external/lobehub/src/routes/(main)/settings/provider/features/ModelList/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ModelList/ModelTitle/index.tsx`
- `external/lobehub/src/routes/(main)/settings/provider/features/ModelList/EnabledModelList/index.tsx`
- `external/lobehub/src/features/ModelSelect/index.tsx`
- `external/lobehub/src/hooks/useEnabledChatModels.ts`
- `external/lobehub/src/features/ServiceModel/ModelAssignmentsForm.tsx`
- `external/lobehub/src/store/chat/slices/agentRun/actions/transports/client/streamingExecutor.ts`
- `external/lobehub/src/services/chat/index.ts`
- `external/lobehub/src/services/_auth.ts`
- `external/lobehub/src/services/chat/helper.ts`
- `external/lobehub/src/services/chat/mecha/contextEngineering.ts`

## EC Gap

`EVID-011-EC-pre` promoted the Settings active artifact to ModelTitle /
EnabledModelList runtime review. It made the toolbar, remote model actions,
permission-disabled batch controls and empty-tab state visible, but it still
presented the provider/model behavior as a local runtime contract.

The next gap is source interaction: LobeHub does not treat provider/model as a
single Settings panel. The capability flows through aiInfra provider/model
stores, SWR keys, services, provider detail mutations, ModelSelect consumers,
Service Model assignments, chat runtime readiness checks, provider auth headers
and context-window metadata.

## EE Revision

`EVID-011-EE-pre` adds a Settings provider source-interaction state at:

`?surface=settings&state=provider-runtime-contract&check=ee`

The EE state keeps the EC ProviderConfig, ModelTitle, EnabledModelList, checker
and OAuth device-flow contract, then adds:

- `data-review-marker="settings-source-interaction-ee"`
- `data-evidence-id="EVID-011-EE-pre"`
- `data-source-interaction-closure="true"`
- `data-settings-provider-chain="provider-runtime-state|provider-detail-query|provider-config-draft|oauth-device-flow"`
- `data-settings-model-chain="model-list-cache|disabled-models-page|fetch-remote|clear-remote|custom-model|reset-models|batch-disable|sort-order"`
- `data-settings-consumer-chain="model-select-provider-model|service-model-assignment|runtime-state-ready|chat-service-auth|station-sync-pending"`
- a source map for provider cache, model mutation and Agent consumer ownership;
- source-level columns that separate cache ownership, mutation/recovery and
  Agent runtime consumption;
- an explicit Station sync pending warning so prototype evidence cannot be read
  as product provider registry, key vault, OAuth polling or audit ingestion.

## Evidence

### L1 Static

- Prototype: `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`
- Styles: `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`
- Source anchors listed above.

### L2 Visual

- Screenshot: `tmp/agent-lobehub-l2-screenshots/settings-ee-source-interaction-scoped.png`
- Metadata: `tmp/agent-lobehub-settings-ee-scoped-screenshot-meta.json`
- Visual inspection must confirm the Settings EE source-interaction closure
  header, provider cache / model mutation / Agent consumer map, source-level
  closure columns, ModelTitle / EnabledModelList runtime panel and product
  migration blocked warning are visible and readable.

### L3 Dynamic / DOM

- DOM artifact: `tmp/agent-lobehub-settings-ee-dom.json`
- Required proof:
  - `marker="settings-source-interaction-ee"`
  - `evidenceId="EVID-011-EE-pre"`
  - `runtimeContractShell=true`
  - `sourceInteractionClosure=true`
  - `settingsProviderChain="provider-runtime-state|provider-detail-query|provider-config-draft|oauth-device-flow"`
  - `settingsModelChain="model-list-cache|disabled-models-page|fetch-remote|clear-remote|custom-model|reset-models|batch-disable|sort-order"`
  - `settingsConsumerChain="model-select-provider-model|service-model-assignment|runtime-state-ready|chat-service-auth|station-sync-pending"`
  - source-chain/source-column counts are 3
  - provider route/cache, ProviderConfig, ModelTitle toolbar, EnabledModelList,
    Service Model consumer and credential permission gate are visible
  - `forbiddenHits=[]`
  - `portalChromeHit=false`

## Claim Boundary

`EVID-011-EE-pre` promotes Settings from EC provider/model toolbar runtime
history to the active Settings source-interaction artifact. It does not confirm
Settings, does not authorize `EVID-012`, and does not allow Desktop / Station /
Model product migration.

Remaining Settings gaps include real store-backed provider/model/credential
mutations, complete OAuth device-flow backend behavior, Station key vault and
audit ingestion, full Profile/Common/Appearance/Advanced/Stats/Billing parity,
mobile Settings/provider routes and product GATE-008 implementation checks.

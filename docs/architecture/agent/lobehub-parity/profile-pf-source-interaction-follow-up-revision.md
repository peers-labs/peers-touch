# Profile PF Source Interaction Follow-Up Revision

> **Evidence**: EVID-011-PF-pre
> **Status**: active Profile source-interaction artifact / not confirmed
> **Scope**: BOM-006 / BOM-012 / BOM-015; SPEC-003 / SPEC-005 / SPEC-006 / SPEC-007 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014; PLAN-P2 Profile source-interaction follow-up / PLAN-P5 blocked precondition; GATE-003 / GATE-004 / GATE-005 / GATE-006 / GATE-008.

## Source Anchors

- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/AgentHeader.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/AgentTool.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/HeterogeneousAgentStatusCard.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/CloudHeterogeneousConfig.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/RemoteAgentConfigCard.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/store/action.ts`
- `external/lobehub/src/routes/(main)/agent/profile/features/store/selectors.ts`
- `external/lobehub/src/features/ModelSelect/index.tsx`
- `external/lobehub/src/features/AgentBuilder/index.tsx`
- `external/lobehub/src/features/AgentBuilder/AgentBuilderConversation.tsx`
- `external/lobehub/src/features/AgentBuilder/SuggestionChips/index.tsx`
- `docs/architecture/agent/lobehub-parity/agent-config-source-map.md`

## Prototype Route

`http://localhost:3200/?prototype=agent-lobehub-parity&preview=only&surface=profile&state=profile-runtime-contract&check=pf`

Evidence capture used the same route on isolated preview port `4173` after the source build passed because the already-running dev server did not mount the fresh PF bundle during CDP capture. The review URL remains `3200` for Owner handoff and gate synchronization.

Marker: `data-review-marker="profile-source-interaction-pf"`

## Revision Delta

PF promotes Profile from the DW runtime-contract artifact into source-interaction closure:

- Profile truth is Station Agent config with Desktop edit projection; Profile UI is not the durable source of truth.
- Provider/model selection flows from Settings Provider projection through `ModelSelect` into a provider/model compound value before Profile writes `AgentModelRef`.
- Agent meta updates are permission-gated; title is debounced, avatar/background are immediate, and returned config remains the durable reconcile source.
- Prompt writes preserve markdown and structured editor JSON through `debouncedSave` and `finishStreaming` with `structuredClone`.
- Tool and knowledge controls store Agent config references only; tool catalog, credentials, resource inventory, indexing, authorization and retrieval remain outside Profile ownership.
- Agent Builder runs as a separate builtin agent in `RightPanel` with `ChatList` / `ChatInput`; generated suggestions carry feedback/tracing and are not durable config until applied.
- Heterogeneous CLI/cloud/remote branches hide ineffective model/prompt controls and keep device-local handles explicit.

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | Prototype code adds `profile-source-interaction-pf`, source-chain attributes and source closure rows in `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; styles added in `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/profile-pf-source-interaction-scoped.png` opened and inspected; metadata `tmp/agent-lobehub-profile-pf-scoped-screenshot-meta.json` records sha256 `950267ac246bc579a5b17ef24139f242cbf79bab097cb8606d180a5120000894` and `1204x2600` scoped capture. |
| L3 DOM | `tmp/agent-lobehub-profile-pf-dom.json` records marker `profile-source-interaction-pf`, evidence `EVID-011-PF-pre`, provider/model chain, config mutation chain, capability binding chain, builder chain, heterogeneous chain, `sourceInteractionClosure=true`, `sourceChainCount=3`, `sourceColumnCount=3`, `forbiddenHits=[]` and `portalChromeHit=false`. |
| Command | `pnpm --filter @peers-touch/prototype-portal run build` PASS after prototype edit. |

## Claim Boundary

`EVID-011-PF-pre` is prototype evidence only. It does not confirm Profile, does not authorize `EVID-012`, does not prove real Station config mutation, does not prove provider/tool/resource catalog execution, and does not allow Desktop / Station / Model product migration.

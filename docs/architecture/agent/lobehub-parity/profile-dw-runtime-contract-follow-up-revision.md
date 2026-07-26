# Profile DW Runtime Contract Follow-Up Revision

> Evidence: EVID-011-DW-pre  
> Status: active Profile artifact promotion  
> Scope: BOM-006 / BOM-012 / BOM-015; SPEC-003 / SPEC-005 / SPEC-007 / SPEC-010 / SPEC-013 / SPEC-014; PLAN-P2; PLAN-P5 blocked precondition; GATE-003 / GATE-004 / GATE-005 / GATE-006 / GATE-008.

## Source Anchors

- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/AgentTool.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/HeterogeneousAgentStatusCard.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/CloudHeterogeneousConfig.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/RemoteAgentConfigCard.tsx`
- `external/lobehub/src/routes/(main)/agent/profile/features/store/action.ts`
- `external/lobehub/src/routes/(main)/agent/profile/features/Header/index.tsx`
- `external/lobehub/src/features/ModelSelect/index.tsx`
- `external/lobehub/src/features/ProfileEditor/AgentTool.tsx`

## Prototype Route

`http://localhost:3200/?surface=profile&state=profile-runtime-contract&check=dw`

Marker: `data-review-marker="profile-runtime-contract-dw"`

## Revision Delta

DW adds a source-backed Profile runtime-contract state after DD:

- Provider/model identity contract through `ModelSelect` (`config.provider + config.model`).
- Model ability tags for chat/function-call/vision/context visibility.
- AgentTool grouping, web browsing search mode, web filtering and stale-plugin cleanup state.
- Permission-denied fail-closed preview for `edit_own_content`.
- Edit-lock and debounced save traces for prompt mutation.
- Heterogeneous agent branches for local CLI, cloud credentials and remote device/capability states.
- Explicit prototype-only boundary: Station/Desktop/Model migration remains blocked.

## Evidence

- Build: `pnpm --filter @peers-touch/prototype-portal run build` PASS.
- L3 DOM: `tmp/agent-lobehub-profile-dw-dom.json`.
- Browser runtime check: integrated browser opened the DW route, selected `Agent LobeHub Parity`, found marker `profile-runtime-contract-dw`, and verified `forbiddenHits=[]`, `portalChromeHit=false`.

## L2 Status

Durable L2 evidence is available at `tmp/agent-lobehub-l2-screenshots/profile-dw-runtime-contract-scoped.png`.

Metadata: `tmp/agent-lobehub-profile-dw-scoped-screenshot-meta.json`

Capture mode: `headless-chrome-preview-only`

The screenshot was opened and inspected at `1280x960`; it shows the Profile runtime contract header, source anchors, permission/edit-lock contract rows, ModelSelect / AgentTool controls, prompt editor, and prototype-only migration boundary without Portal cards/header. Metadata records `portalChromeHit=false` and image SHA-256 `3795f79ed7a06383d34eb7b9580137f818a1a11b94f240ead1241e9d1f90ddb6`.

## Claim Boundary

`EVID-011-DW-pre` is retained as historical Profile runtime-contract context after `EVID-011-PF-pre`; it promoted the Profile review artifact from DD Builder-visible history to DW runtime configuration and heterogeneous-agent contracts at the time of the DW follow-up. It does not confirm Profile, does not authorize `EVID-012`, and does not allow Desktop / Station / Model product migration.

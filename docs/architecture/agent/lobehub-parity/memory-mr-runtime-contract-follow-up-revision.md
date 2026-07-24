# Agent LobeHub Parity - Memory Runtime Contract Follow-up Revision

> **Status**: active Memory artifact promotion / not confirmed
> **Evidence**: EVID-011-MR-pre
> **Plan Step**: PLAN-P2 Memory runtime contract follow-up / PLAN-P5 blocked precondition
> **BOM**: BOM-004 / BOM-012 / BOM-015
> **Spec**: SPEC-004 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014
> **Gates**: GATE-003 / GATE-004 / GATE-006 / GATE-008

## Source Anchors

- `external/lobehub/src/routes/(main)/memory/(home)/index.tsx`: Home loads tags and persona through `useFetchTags`, `useFetchPersona` and `AsyncBoundary`, with error-before-empty handling and retry.
- `external/lobehub/src/routes/(main)/memory/features/ActionBar/index.tsx`: Memory header composes Purge, MemoryAnalysis and WideScreenButton.
- `external/lobehub/src/routes/(main)/memory/features/ActionBar/PurgeButton.tsx`: purge confirms, calls `purgeAllMemories`, clears detail query keys only after success and reports failure.
- `external/lobehub/src/routes/(main)/memory/features/MemoryAnalysis/index.tsx`: analysis action/status switches between idle, pending, processing and error task states.
- `external/lobehub/src/routes/(main)/memory/features/MemoryAnalysis/AnalysisTrigger.tsx`: analysis opens a date-range modal before extraction.
- `external/lobehub/src/routes/(main)/memory/preferences/index.tsx`: category list owns `q`/`sort` query state, list reset, list fetch and right panel projection.
- `external/lobehub/src/routes/(main)/memory/preferences/features/PreferenceRightPanel.tsx`: detail panel fetches by query id with `AsyncBoundary`, loading, retryable error and `DetailNotFound`.
- `external/lobehub/src/routes/(main)/memory/features/TimeLineView/index.tsx`: timeline list uses `GroupedVirtuoso`, scroll parent and load-more footer.
- `external/lobehub/src/routes/(main)/memory/features/GridView/index.tsx`: grid list uses `VirtuosoGrid`, responsive rows and load-more footer.
- `external/lobehub/src/store/userMemory/slices/base/action.ts`: `purgeAllMemories`, `updateMemory`, `useFetchMemoryDetail`, `useFetchUserMemory` own durable mutation/revalidation boundaries.
- `external/lobehub/src/store/userMemory/utils/searchParams.ts`: active memory context is derived from topic/agent/message sources before retrieval.

## DH Gap

`EVID-011-DH-pre` promoted a cleaner `/memory` Home success artifact, but it still
only proved the compact Home view: Search/Home/category nav, RoleTagCloud,
Persona panel and the click-triggered analysis date modal. It did not expose the
runtime contract that Owner needs to judge whether Peers-Touch has represented
LobeHub's Memory behavior honestly: data boundaries, query-state routing,
virtualized category lists, detail-panel fetch states and destructive mutation
recovery.

## MR Revision

- Added `?surface=memory&state=memory-runtime-contract&check=mr`.
- Added marker `data-review-marker="memory-runtime-contract-mr"` and evidence id
  `EVID-011-MR-pre`.
- Promoted Home AsyncBoundary states: loading, error-before-empty,
  empty-with-analysis and persona success.
- Promoted query-state states: `q`, `sort`, `preferenceId`, `activityId`,
  `contextId`, `experienceId` and `identityId`.
- Promoted list states: initializing, search reset, timeline virtualization,
  grid virtualization, load-more and empty search.
- Promoted detail states: closed, loading, ready, retryable error and not found.
- Promoted analysis states: idle, date-range, validating, pending, processing,
  error and retry.
- Promoted edit/delete/purge recovery states without claiming service success.
- Declared owner boundaries: Station owns durable memory truth, Desktop owns
  query/list/detail projection, Model/proto must later define retrieval,
  mutation, analysis-task and source-link contracts.

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/memory-mr-runtime-contract-scoped.png`, captured from `http://localhost:3200/?prototype=agent-lobehub-parity&preview=only&surface=memory&state=memory-runtime-contract&check=mr`, opened and inspected. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-memory-mr-dom.json`: marker `memory-runtime-contract-mr`, evidence id `EVID-011-MR-pre`, runtime shell, Home/query/list/detail/analysis/edit/delete/purge state attributes, `forbiddenHits=[]`, `portalChromeHit=false`; metadata `tmp/agent-lobehub-memory-mr-scoped-screenshot-meta.json`. |
| Build | `pnpm --filter @peers-touch/prototype-portal run build` passed after the MR TSX/CSS changes. |

## Claim Boundary

`EVID-011-MR-pre` promotes Memory from DH Home success history to the active
runtime-contract artifact. It does not prove real SWR data, real retrieval
results, persisted edits, delete/purge service success, analysis task execution,
source-link resolution, gateway replay or product `GATE-008` parity. It does not
confirm Memory or the prototype, does not authorize `EVID-012`, and does not
allow Desktop / Station / Model product migration.

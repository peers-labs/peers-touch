# Agent LobeHub Parity - Memory Source Interaction Follow-up Revision

> **Status**: active Memory artifact promotion / not confirmed
> **Evidence**: EVID-011-MS-pre
> **Plan Step**: PLAN-P2 Memory source-interaction follow-up / PLAN-P5 blocked precondition
> **BOM**: BOM-004 / BOM-012 / BOM-015
> **Spec**: SPEC-004 / SPEC-009 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014
> **Gates**: GATE-003 / GATE-004 / GATE-006 / GATE-008

## Source Anchors

- `external/lobehub/src/libs/swr/keys.ts`: `userMemoryKeys` defines independent SWR roots for tags, persona, preferences, memory detail, analysis task, retrieval and topic memories.
- `external/lobehub/src/store/userMemory/slices/base/action.ts`: `setActiveMemoryContext`, `useFetchUserMemory`, `useFetchMemoryDetail`, `updateMemory` and `purgeAllMemories` define retrieval cache keys, detail fetches, mutation updates and key-family revalidation.
- `external/lobehub/src/store/userMemory/utils/searchParams.ts`: `createMemorySearchParams` resolves topic summary, agent description, latest user message and sending message into retrieval parameters.
- `external/lobehub/src/routes/(main)/memory/preferences/index.tsx`: preference page owns `q` / `sort` query state, grid-only sort behavior, list reset and `useFetchPreferences`.
- `external/lobehub/src/routes/(main)/memory/preferences/features/List/index.tsx`: list click writes `preferenceId` query state and opens the right panel.
- `external/lobehub/src/routes/(main)/memory/preferences/features/PreferenceRightPanel.tsx`: detail panel fetches `preferenceId` through `useFetchMemoryDetail` and keeps loading, empty and retry inside `AsyncBoundary`.
- `external/lobehub/src/routes/(main)/memory/features/DetailPanel.tsx`: right panel owns the stable detail rail and scroll boundary.
- `external/lobehub/src/routes/(main)/memory/features/MemoryAnalysis/index.tsx`: analysis action/status decides whether action or task status is visible.
- `external/lobehub/src/routes/(main)/memory/features/MemoryAnalysis/useTask.ts`: `useMemoryAnalysisAsyncTask` polls pending/processing extraction tasks and stops when complete/error.
- `external/lobehub/src/routes/(main)/memory/features/SourceLink.tsx`: detail source links route back to `AGENT_CHAT_TOPIC_URL(agentId, topicId)`.

## MR Gap

`EVID-011-MR-pre` promoted Memory from the DH Home success view into a runtime
contract: Home AsyncBoundary, query-state routing, virtualized category lists,
detail boundary states, analysis lifecycle and edit/delete/purge recovery. It
still left the source-interaction chain implicit. Owner review could see which
states exist, but not how LobeHub separates SWR key roots, retrieval context,
category query resets, detail fetches, analysis task polling, mutation
revalidation and source-link ownership.

## MS Revision

- Added `?surface=memory&state=memory-runtime-contract&check=ms`.
- Added marker `data-review-marker="memory-source-interaction-ms"` and evidence
  id `EVID-011-MS-pre`.
- Added `data-source-interaction-closure="true"` while keeping the MR runtime
  contract shell intact.
- Added source-chain attributes:
  - `data-memory-swr-chain="tags|persona|preferences|memory-detail|analysis-task|retrieve"`
  - `data-memory-action-chain="set-active-context|retrieve-cache-key|update-memory|purge-all|mutate-key-families"`
  - `data-memory-consumer-chain="source-link-topic-url|identity-injection|agent-runtime-retrieval|station-contract-pending"`
- Added visible source map for SWR keys, store actions and agent consumer.
- Added source-level closure columns for:
  - SWR and retrieval: key map, retrieval context and analysis task.
  - Mutation and panels: category fetch, detail fetch, edit and purge.
  - Agent consumption: source link, injection identities and Model/proto gap.

## Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/memory-ms-source-interaction-scoped.png`, captured from `http://localhost:3200/?prototype=agent-lobehub-parity&preview=only&surface=memory&state=memory-runtime-contract&check=ms`, opened and inspected at `1600x1900`; metadata `tmp/agent-lobehub-memory-ms-scoped-screenshot-meta.json` records SHA-256 `ed2d224eb174ebec4493dd864ea0c5ee8986d47e188a5a6481ebc984b73e109c`. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-memory-ms-dom.json`: marker `memory-source-interaction-ms`, evidence id `EVID-011-MS-pre`, runtime shell, `sourceInteractionClosure=true`, SWR/action/consumer chains, source map/column counts, fail-closed warning, `forbiddenHits=[]` and `portalChromeHit=false`. |

## Claim Boundary

`EVID-011-MS-pre` promotes Memory from MR runtime-contract history to the active
source-interaction artifact. It does not prove real SWR data, real retrieval
results, persisted edits, delete/purge service success, analysis task execution,
source-link resolution, gateway replay, Station audit ingestion or product
`GATE-008` parity. It does not confirm Memory or the prototype, does not
authorize `EVID-012`, and does not allow Desktop / Station / Model product
migration.

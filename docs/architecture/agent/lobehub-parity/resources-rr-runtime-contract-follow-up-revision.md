# Resources RR Runtime Contract Follow-up Revision

> **Status**: active Resources artifact promotion / not confirmed
> **Evidence**: EVID-011-RR-pre
> **BOM**: BOM-005, BOM-012, BOM-015
> **Spec**: SPEC-006, SPEC-007, SPEC-009, SPEC-010, SPEC-011, SPEC-013, SPEC-014
> **Plan Step**: PLAN-P2 Resources runtime contract follow-up / PLAN-P5 blocked precondition
> **Gate**: GATE-003, GATE-004, GATE-006, GATE-008

## Source Anchors

- `external/lobehub/src/features/ResourceManager/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/Header/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/ListView/ListViewHeader.tsx`
- `external/lobehub/src/features/ResourceManager/components/Explorer/ListView/VirtualizedFileList.tsx`
- `external/lobehub/src/features/ResourceManager/components/Header/AddButton.tsx`
- `external/lobehub/src/features/ResourceManager/hooks/useTopLevelFileUpload.ts`
- `external/lobehub/src/features/ResourceManager/components/UploadDock/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/Editor/index.tsx`
- `external/lobehub/src/features/ResourceManager/components/ChunkDrawer/index.tsx`
- `external/lobehub/src/store/file/slices/resource/initialState.ts`
- `external/lobehub/src/store/file/slices/resource/action.ts`
- `external/lobehub/src/services/resource/index.ts`
- `external/lobehub/src/features/Conversation/ChatInput/index.tsx`
- `external/lobehub/src/features/Conversation/ChatInput/QueueTray.tsx`
- `external/lobehub/packages/database/src/schemas/file.ts`
- `external/lobehub/packages/database/src/schemas/message.ts`
- `external/lobehub/packages/database/src/schemas/relations.ts`

## DR Gap

`EVID-011-DR-pre` promoted Resources from DG ResourceManager default history to the active list-contract artifact. It covered header search, selected actions, error-before-empty retry, list header columns, select-all hint and virtualized-list boundary.

That was still not enough for Agent parity because LobeHub Resources is a runtime boundary across ResourceManager, upload/import, file/page editor overlays, chunk drawer, knowledge membership and ChatInput file context. A list contract alone cannot prove where durable resource truth, Agent binding references, queue restore and Station audit ownership belong.

## RR Revision

`EVID-011-RR-pre` adds a dedicated `resources-runtime-contract` state:

- `data-review-marker="resources-runtime-contract-rr"` on the scoped Resources artifact.
- route/query state: `mode`, `file`, `library`, `folder`, `visibility`, `category`, `search`, `sort`, `view`.
- data state: `loading`, `validating`, `error-before-empty`, `empty`, `data`, `retry`.
- upload state: `drag-active`, `pending`, `uploading`, `success`, `error`, `cancel`, `auto-dismiss`.
- import state: `url`, `notion`, `input-preserved`, `failure-no-row`.
- preview state: `explorer`, `file-editor-overlay`, `page-editor-overlay`, `file-detail-modal`, `back-removes-file-query`.
- index state: `chunking`, `embedding`, `failed`, `retry`, `similarity-search`, `chunk-drawer`.
- Agent state: `visible-unbound`, `attached-context`, `queued-message-restore`, `public-agent-restricted`.
- ownership boundary: base-resource owns inventory/indexing, agent-domain owns binding refs, Station owns durable audit truth.

## L2 / L3 Evidence

- L2 screenshot: `tmp/agent-lobehub-l2-screenshots/resources-rr-runtime-contract-scoped.png`
- L3 DOM: `tmp/agent-lobehub-resources-rr-dom.json`
- Screenshot metadata: `tmp/agent-lobehub-resources-rr-scoped-screenshot-meta.json`

DOM evidence proves:

- `marker=resources-runtime-contract-rr`
- `evidenceId=EVID-011-RR-pre`
- `runtimeContractShell=true`
- `resourceRouteState=mode|file|library|folder|visibility|category|search|sort|view`
- `resourceDataState=loading|validating|error-before-empty|empty|data|retry`
- `resourceUploadState=drag-active|pending|uploading|success|error|cancel|auto-dismiss`
- `resourceImportState=url|notion|input-preserved|failure-no-row`
- `resourcePreviewState=explorer|file-editor-overlay|page-editor-overlay|file-detail-modal|back-removes-file-query`
- `resourceIndexState=chunking|embedding|failed|retry|similarity-search|chunk-drawer`
- `resourceAgentState=visible-unbound|attached-context|queued-message-restore|public-agent-restricted`
- `runtimeOwner=base-resource inventory and indexing / agent-domain binding refs / Station durable audit truth`
- `sourceContract=true`
- `lifecycleContract=true`
- `runtimeBoundaryContract=true`
- `failClosedWarning=true`
- `forbiddenHits=[]`
- `portalChromeHit=false`

## Claim Boundary

`EVID-011-RR-pre` promotes Resources from DR list-contract review to the active runtime-contract artifact for Owner review. It does not confirm Resources, does not authorize `EVID-012`, and does not allow Desktop / Station / Model product migration.

It does not prove real upload, folder upload, Notion import, URL import, SWR mutation, optimistic sync queue, knowledge membership mutation, Agent binding persistence, queued message file restore, chunking/embedding execution, similarity search, delete/move side effects or Station audit ingestion.

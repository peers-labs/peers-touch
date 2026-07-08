# Agent LobeHub Fullstack Parity — M7 Knowledge / Files Parity Spec

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Station + Desktop Rust + Desktop
> **Plan Step**: PLAN-P4 / M7 pre-execution
> **Evidence**: EVID-011-G-pre
> **Gates**: GATE-006, GATE-008
> **Depends On**: EVID-010, EVID-012, EVID-013, EVID-014, EVID-015, EVID-016, EVID-017

---

## 1. Scope

M7 closes Knowledge/File parity after Memory projection is specified and after the Agent turn/runtime contract can carry typed resource references.

This spec defines:

- Knowledge asset and file/folder/url/workspace resource lifecycle.
- Station source-of-truth for durable resource metadata, index status and retrieval diagnostics.
- Desktop Rust boundary for local file handles and authorized filesystem access.
- Desktop resource rail and turn trace behavior.
- Recovery states for indexing, authorization, retrieval and stale local references.

This spec does not:

- Claim Tool/Plugin/Skill parity; M8 owns tool execution and approval.
- Treat raw local paths in Desktop Web as cross-end truth.
- Replace Station OSS/workspace services without a gap-driven migration.
- Claim LobeHub parity from ad hoc file reads or prompt-only injection.
- Start product implementation before revised prototype acceptance after EVID-010 `REVISION REQUIRED` and M1-M6 implementation evidence.

## 2. Source Basis

### 2.1 LobeHub Source

Canonical source map: `tool-knowledge-source-map.md`.

| Area | Source Path | Relevant Behavior |
| --- | --- | --- |
| Unified resource service | `external/lobehub/src/services/resource/index.ts` | Maps files/documents into unified `ResourceItem` with chunking and embedding status. |
| Knowledge base service | `external/lobehub/src/services/knowledgeBase.ts` | Knowledge base CRUD, visibility, transfer/copy/publish, file binding. |
| RAG service | `external/lobehub/src/services/rag.ts` | Parse/chunk/embedding tasks, retry, semantic search and chat retrieval. |
| Agent knowledge slice | `external/lobehub/src/store/agent/slices/knowledge/action.ts` | Agent file/knowledge-base binding, toggle, refresh and SWR invalidation. |
| File/resource store | `external/lobehub/src/store/file/slices/resource/action.ts`, `external/lobehub/src/types/resource.ts` | Optimistic resource state, pending/error queue, folder hierarchy, source type, chunk/embedding statuses. |
| Working sidebar resources | `external/lobehub/src/routes/(main)/agent/features/Conversation/WorkingSidebar/ResourcesSection/` | Agent documents and skills are separated, fetch is gated by panel visibility. |
| Working sidebar files | `external/lobehub/src/routes/(main)/agent/features/Conversation/WorkingSidebar/Files/index.tsx` | Project file tree, search, git status, local/remote device boundary, drag-to-context behavior. |
| Agent document fetch | `external/lobehub/src/hooks/useFetchAgentDocuments.ts`, `external/lobehub/src/services/agentDocument.ts` | Agent-bound documents are first-class conversation resources. |

### 2.2 Peers-Touch Current Sources

| Area | Source Path | Current State |
| --- | --- | --- |
| Knowledge resource model | `apps/station/app/subserver/agent/domain/turn.go` | `KnowledgeResource` and `KnowledgeChunkReference` exist for turn execution. |
| Knowledge retrieval | `apps/station/app/subserver/agent/service/knowledge_retrieval_service.go` | Loads file/folder/project/workspace/url/literal, chunks and ranks content with lightweight embeddings. |
| Retrieval tests | `apps/station/app/subserver/agent/service/knowledge_retrieval_service_test.go` | Proves chunk/rank and disabled-resource skip behavior. |
| Agent bindings | `apps/station/app/subserver/agent/domain/agent_config_service.go`, `infrastructure/persistence/agent_config.go` | Agent knowledge binding stores `resource_id`, policy and enabled state. |
| Workspace contract | `model/domain/agent/workspace.proto` | Workspace, files, diff, upload/download URLs and sync operations exist. |
| Workspace services | `apps/station/app/subserver/agent/service/workspace_service.go`, `workspace_oss_service.go` | Workspace CRUD, file listing/diff/commit/delete and presigned OSS URLs exist. |
| Desktop config types | `apps/desktop/src/services/desktop_api.ts`, `apps/desktop/src/services/agent-runtime-config.ts` | Agent knowledge resources are parsed from Agent config and mapped to turn payload. |
| Chat trace | `apps/desktop/src/store/chat.ts` | Parses `knowledge_retrieved` progress result into `knowledgeChunks`, but event is ad hoc. |
| Profile UI | `apps/desktop/src/pages/AgentProfilePage.tsx` | Resource capability exists in profile surface, but durable lifecycle and recovery are incomplete. |

## 3. Target Ownership

| Capability | Source Of Truth | Desktop Projection Owner | Notes |
| --- | --- | --- | --- |
| Knowledge asset identity | Station | Knowledge/resource runtime store | Cross-end truth is resource ID, not local path. |
| File/folder/url/workspace metadata | Station + Desktop Rust for local handles | Desktop runtime projection | Desktop Rust may resolve local handles; Desktop Web receives opaque refs only. |
| Chunking/indexing/embedding status | Station | Resource rail projection | Must include pending/indexed/error/retry and last indexed time. |
| Agent binding policy | Station Agent config | Agent config projection | Policy maps to manual/auto/always/disabled; UI cannot invent binding truth. |
| Retrieval diagnostics | Station TurnService / KnowledgeRetrievalService | Chat runtime event projection | Turn trace owns selected chunks, scores and skipped/error reasons. |
| Local filesystem access | Desktop Rust | Desktop Web displays approved handles | Raw paths must not become portable business truth. |

## 4. Required Contracts

M7 should promote the existing `KnowledgeResource` into a version-safe resource contract aligned with M1 `AgentResourceRef`.

Required resource shape:

```ts
interface AgentKnowledgeResourceContract {
  resourceId: string;
  agentId?: string;
  type: 'document' | 'folder' | 'project' | 'url' | 'notebook' | 'workspace';
  title: string;
  sourceRef: {
    kind: 'station_asset' | 'workspace_file' | 'desktop_local_handle' | 'url' | 'literal';
    value: string;
  };
  policy: 'manual' | 'auto' | 'always' | 'disabled';
  status: 'authorized' | 'pending_index' | 'indexing' | 'indexed' | 'error' | 'stale' | 'unauthorized';
  chunkCount?: number;
  embeddingStatus?: 'none' | 'pending' | 'running' | 'done' | 'error';
  lastIndexedAt?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

Required turn event shape:

```ts
type AgentRuntimeKnowledgeEvent =
  | { type: 'knowledge.retrieval_started'; turnId: string; resourceIds: string[] }
  | { type: 'knowledge.retrieved'; turnId: string; chunks: KnowledgeChunkReference[] }
  | { type: 'knowledge.skipped'; turnId: string; resourceId?: string; reason: 'disabled' | 'unauthorized' | 'not_indexed' | 'no_match' | 'error' }
  | { type: 'knowledge.index_status'; resourceId: string; status: AgentKnowledgeResourceContract['status']; error?: AgentKnowledgeResourceContract['error'] }
  | { type: 'knowledge.reconciled'; agentId: string; cursor?: string };
```

## 5. Implementation Slices

### M7.1 Station Resource Contract And Lifecycle

Deliverables:

- Define durable resource metadata for document/folder/project/url/notebook/workspace.
- Normalize status transitions: authorized -> pending_index -> indexing -> indexed or error.
- Preserve current lightweight retrieval while adding lifecycle metadata and diagnostics.

Stop condition:

- Do not treat `source` string alone as resource truth once a durable resource ID exists.

### M7.2 Desktop Rust Local Handle Boundary

Deliverables:

- Desktop Rust resolves local file/folder handles and validates allowed roots.
- Desktop Web receives opaque handle IDs plus display metadata.
- Upload/download and workspace OSS operations stay behind Station/Rust APIs.

Stop condition:

- Desktop Web must not persist raw absolute local paths as cross-end resource truth.

### M7.3 Agent Binding And Resource Rail

Deliverables:

- Agent binding UI shows resource type, policy, status, last indexed time, retry action and authorization state.
- Working/resource rail separates Agent documents, workspace files and future skills/tools.
- Fetching is gated by visible panel/runtime projection, not page mount alone.

Stop condition:

- Do not duplicate LobeHub's full Resource Library inside Agent profile; profile is a binding/projection surface.

### M7.4 Retrieval Diagnostics In Chat Trace

Deliverables:

- Chat diagnostics show retrieved chunks, skipped resources, index errors, source titles and score/explain where available.
- Knowledge events are tied to `turnId` and `conversationId`.
- Existing ad hoc `knowledge_retrieved` progress payload is kept only as compatibility until M1 runtime event is implemented.

Stop condition:

- Do not infer Knowledge usage from prompt text or rendered assistant content.

### M7.5 Recovery And Reconcile

Deliverables:

- Surface unauthorized, stale local handle, not indexed, indexing failed, retrieval timeout and no match states.
- Reconcile resource status after reconnect, Agent switch and workspace sync.
- Retry index/retrieval actions must call Station/Rust APIs and record evidence.

Stop condition:

- Do not mark local optimistic state as final success before Station/Rust confirmation.

## 6. Verification Matrix

| Check | Command / Evidence | Required Result |
| --- | --- | --- |
| Desktop typecheck | `pnpm --dir apps/desktop run check` | Pass after M7 product implementation. |
| Station knowledge tests | Targeted `go test ./app/subserver/agent/service -run Knowledge` from `apps/station` or repo-equivalent command | Pass if retrieval/lifecycle services touched. |
| Station workspace tests | Targeted Go tests for workspace/OSS services if workspace paths touched | Pass when workspace contracts or services change. |
| Rust bridge tests | Targeted `cargo test` under `apps/desktop/src-tauri` when local handle/OSS bridge touched | Pass when Desktop Rust paths change. |
| Resource lifecycle evidence | API/test/browser evidence | Resource status moves through pending/indexing/indexed/error/retry states. |
| Chat trace evidence | Browser or automated UI evidence | Turn diagnostics show retrieved/skipped/error knowledge states and chunk source metadata. |
| Security review evidence | Code review checklist | Raw local paths are not persisted as cross-end truth; authorization failures fail closed. |

## 7. Forbidden Relationships

- Desktop Web must not own durable Knowledge/File truth.
- Raw local filesystem paths must not cross Station/Desktop as portable resource identity.
- Knowledge parity must not be claimed from `KnowledgeRetrievalService.Retrieve` alone.
- Resource status must not be faked in UI when Station/Rust cannot prove indexing or authorization.
- Agent profile must not become the full Resource Library source-of-truth.
- M7 must not claim Tool/Plugin/Skill execution parity.
- Product implementation remains blocked until a revised prototype is accepted and prior M1-M6 implementation gates are satisfied.

## 8. Traceability

| Evidence ID | BOM ID | Spec ID | Plan Step | Gate ID | Source Path | Target Path | Owner | Status | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EVID-011-G-pre | BOM-005/BOM-010/BOM-015 | SPEC-006/SPEC-009/SPEC-011/SPEC-013 | PLAN-P4 / M7 pre-execution | GATE-006/GATE-008 | LobeHub `services/resource`, `services/knowledgeBase`, `services/rag`, `store/file`, `store/agent/slices/knowledge`, `WorkingSidebar/ResourcesSection`, `WorkingSidebar/Files`; Peers Station `knowledge_retrieval_service.go`, `agent_config_service.go`, `workspace.proto`, `workspace_service.go`, Desktop `agent-runtime-config.ts`, `chat.ts` | This spec; future resource contract, Desktop Rust local handle bridge, resource rail, chat knowledge diagnostics | Station/Desktop Rust/Desktop | implemented | Product code unchanged; resource lifecycle and GATE-008 remain unproven until PLAN-P5 M7 implementation. |

## 9. Evidence Target

EVID-018 should be recorded after implementation with:

- Station resource lifecycle and retrieval diagnostics test evidence.
- Desktop Rust local handle authorization evidence.
- Desktop resource rail/status UI evidence.
- Chat diagnostics evidence for retrieved/skipped/error knowledge states.
- Commands run and uncovered risks.

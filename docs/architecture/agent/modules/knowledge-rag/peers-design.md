# P1-M3: Knowledge Base & RAG — Peers Design (S2)

> **Module**: P1-M3 Knowledge Base & RAG
> **Step**: S2 — Peers Design
> **Status**: draft
> **Finding**: RAG retrieval + prompt injection pipeline is 80% implemented. Gaps are file upload binding and management UI.

---

## 1. Current State (already implemented)

| Layer | Component | Status |
|-------|-----------|--------|
| Station | knowledge_retrieval_service.go — chunking + scoring + prompt block | ✅ |
| Station | prompt_assembly_service.go — L6 knowledge injection | ✅ |
| Station | agent_config routes — CRUD for agent_knowledge_bindings | ✅ |
| Station | OSS subserver — file upload (PrepareUpload/CompleteUpload) | ✅ |
| Desktop | agent.ts store — knowledge resource CRUD actions | ✅ |
| Desktop | AgentProfilePage — basic resource binding UI | ✅ |
| Desktop | AssistantMessage — chunk references display | ✅ |
| Desktop | Turn request — knowledge_resources passed to Station | ✅ |

## 2. Gaps to Close (P1 scope)

| # | Gap | Impact | Effort |
|---|-----|--------|--------|
| G1 | File upload → knowledge resource binding | Users can't add files as knowledge; only manual path/URL entry | Medium |
| G2 | Knowledge management panel | No dedicated UI to browse, search, or manage knowledge resources | Medium |
| G3 | Embedding provider pluggability | Hash-based embedding has poor semantic recall | Low |

## 3. Design: G1 — File Upload as Knowledge Resource

**Problem**: Currently, knowledge resources are bound by manually typing a file path or URL in AgentProfilePage. There's no way to upload a file from the user's machine and have it automatically become a knowledge resource.

**Solution**: Bridge the existing OSS upload flow to knowledge resource creation.

**Flow**:
```
Desktop File Picker → Rust BFF upload (OSS) → Station stores file → returns file_key
  → Desktop calls knowledge binding create with source=file_key
  → Station knowledge_retrieval_service reads file by key when doing RAG
```

**Implementation**:

1. **Desktop UI**: Add "Upload File" button in AgentProfilePage knowledge section
   - Uses existing file picker dialog (Tauri `dialog.open`)
   - Calls existing `uploadAttachment` Rust command (reuse OSS flow)
   - On success, calls `updateKnowledgeResources` with new resource entry (type=document, source=uploaded_file_key)

2. **Station knowledge_retrieval_service**: Extend `loadResourceContent` to support OSS file keys
   - Add case: if source looks like an OSS key (starts with known prefix), load from OSS storage
   - Reuse existing `file_service.go` read path

3. **Rust BFF**: No new commands needed — reuse `upload_attachment` command (already handles file → OSS)

**Changes needed**:

| File | Change |
|------|--------|
| `apps/desktop/src/pages/AgentProfilePage.tsx` | Add file upload button, call upload API then bind resource |
| `apps/desktop/src/services/desktop_api.ts` | Add `uploadKnowledgeFile` wrapper (thin layer over existing upload) |
| `apps/station/app/subserver/agent/service/knowledge_retrieval_service.go` | Add OSS key resolution in `loadResourceContent` |

## 4. Design: G2 — Knowledge Management Panel

**Problem**: Knowledge resources are buried in the agent profile page. No way to see all resources, their status, chunk counts, or retrieval history.

**Solution**: Add a KnowledgePanel component rendered in the agent config area (tab alongside existing "Model", "Tools", "MCP" tabs).

**Component tree**:
```
AgentProfilePage
└── KnowledgeTab (new)
    ├── KnowledgeResourceList
    │   ├── ResourceItem (name, type, status, size, actions)
    │   └── EmptyState
    ├── AddResourceBar
    │   ├── UploadFileButton
    │   ├── AddURLInput
    │   └── AddFolderButton (desktop path picker)
    └── ResourcePreview (optional: show chunks on click)
```

**Store changes**: Extend `store/agent.ts` (no new store needed at P1 level):
- `knowledgeResources` selector already exists
- Add `uploadAndBindKnowledgeFile(agentId, filePath)` action
- Add `removeKnowledgeResource(agentId, resourceId)` action (already exists as part of updateKnowledgeResources)

**UI library**: LobeUI List + ActionIcon components.

## 5. Design: G3 — Embedding Provider Interface

**Problem**: `embedKnowledgeText()` in knowledge_retrieval_service.go uses deterministic SHA256 hashing. This gives keyword-level matching at best.

**Solution**: Wire the existing `MemoryEmbeddingProvider` interface into knowledge retrieval, with hash fallback when no provider is configured.

**Changes**:

| File | Change |
|------|--------|
| `knowledge_retrieval_service.go` | Accept `EmbeddingProvider` in constructor; use it in `embedKnowledgeText` |
| `agent.go` (DI setup) | Inject the same embedding provider used by memory_service |

**Fallback**: If no embedding provider configured (no API key), continue using hash-based approach. This makes the feature functional without external dependencies.

## 6. What Does NOT Change

- Turn execution flow (already passes knowledge_resources)
- Prompt assembly L6 layer (already injects retrieved chunks)
- Proto definitions (KnowledgeResource/KnowledgeChunkReference already defined)
- Stream event handling (knowledge_chunk events already handled in handler.ts)
- AssistantMessage chunk display (already works)

## 7. File Manifest

| # | File | Action | Gap |
|---|------|--------|-----|
| 1 | `apps/desktop/src/pages/AgentProfilePage.tsx` | Modify — extract knowledge section to KnowledgeTab, add upload | G1, G2 |
| 2 | `apps/desktop/src/components/agent/KnowledgeTab.tsx` | Create — dedicated knowledge management panel | G2 |
| 3 | `apps/desktop/src/components/agent/KnowledgeResourceList.tsx` | Create — resource list with actions | G2 |
| 4 | `apps/desktop/src/components/agent/AddResourceBar.tsx` | Create — upload/URL/folder input bar | G1, G2 |
| 5 | `apps/desktop/src/store/agent.ts` | Modify — add uploadAndBindKnowledgeFile action | G1 |
| 6 | `apps/desktop/src/services/desktop_api.ts` | Modify — add uploadKnowledgeFile wrapper | G1 |
| 7 | `apps/station/app/subserver/agent/service/knowledge_retrieval_service.go` | Modify — OSS key resolution + embedding provider injection | G1, G3 |
| 8 | `apps/station/app/subserver/agent/agent.go` | Modify — inject embedding provider into knowledge service | G3 |

## 8. Acceptance Criteria

See `acceptance.md` in this directory.

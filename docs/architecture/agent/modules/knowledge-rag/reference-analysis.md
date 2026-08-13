# P1-M3: Knowledge Base & RAG — Reference Analysis (S1)

> **Module**: P1-M3 Knowledge Base & RAG
> **Step**: S1 — Reference Analysis
> **Status**: complete
> **Source**: `docs/architecture/agent/lobehub-feature-topology.md` L2 store/library, store/file, services/rag

---

## 1. LobeHub Feature Surface

### Store Layer

- `store/library/slices/crud` — createNewKnowledgeBase, refreshKnowledgeBaseList, removeKnowledgeBase, updateKnowledgeBase
- `store/library/slices/content` — addFilesToKnowledgeBase, removeFilesFromKnowledgeBase
- `store/library/slices/ragEval` — RAG quality evaluation
- `store/agent/slices/knowledge` — addFilesToAgent, addKnowledgeBaseToAgent, removeFileFromAgent, toggleKnowledgeBase
- `store/file/slices/fileManager` — embeddingChunks, loadMoreKnowledgeItems, parseFilesToChunks, reEmbeddingChunks, reParseFile

### Service Layer

- `services/knowledgeBase.ts` — CRUD for knowledge base entities
- `services/rag.ts` — parseFileContent, createEmbeddingChunksTask, semanticSearch, semanticSearchForChat
- `services/upload.ts` — uploadFileToS3, uploadBase64ToS3

### UI Layer

- `features/LibraryModal/` — AssignKnowledgeBase, CreateNew
- `features/ResourceManager/` — ChunkDrawer, Editor, Explorer (MasonryView/ListView), FolderTree, UploadDock
- `features/ChatInput/ActionBar/Knowledge/` — per-message knowledge selector

---

## 2. Peers Current State

| Layer | Component | Status |
|-------|-----------|--------|
| Proto | KnowledgeResource, KnowledgeChunkReference, types/policy/status | ✅ |
| Station CRUD | agent_knowledge_bindings table + 4 endpoints | ✅ |
| Station Retrieval | chunking (1200 chars) + hash-embed (64d) + cosine + keyword scoring | ✅ |
| Station Prompt | L6 knowledge injection in prompt_assembly_service | ✅ |
| Station OSS | File upload pipeline (PrepareUpload/CompleteUpload + CAS) | ✅ |
| Desktop Store | agent.ts — updateKnowledgeResources/getAgentKnowledgeResources | ✅ |
| Desktop UI | AgentProfilePage — resource binding management | ✅ |
| Desktop Messages | AssistantMessage — chunk reference display | ✅ |
| Turn Integration | knowledge_resources in turn request → retrieval → prompt | ✅ |

## 3. Gap Analysis

| # | Gap | LobeHub Equivalent | Severity |
|----|-----|-------------------|----------|
| G1 | No file upload → knowledge resource binding flow | services/upload + services/rag.parseFileContent | High |
| G2 | No Knowledge management page (standalone) | features/ResourceManager | High |
| G3 | No real embedding model (uses SHA256 hash→64d) | embedding service | Medium |
| G4 | No persistent chunk index (recomputed per turn) | vector store | Medium |
| G5 | No standalone KB entity (only per-agent bindings) | store/library CRUD | Low (P2) |
| G6 | No ChatInput knowledge selector | features/ChatInput/ActionBar/Knowledge | Low (P2) |
| G7 | No RAG evaluation | store/file/slices/ragEval | Low (P3) |
| G8 | No chunk visualization | ChunkDrawer, embedding progress | Low (P2) |

## 4. Architecture Constraints

- Knowledge resources reference files by `Source` (path on Station filesystem or URL)
- Station OSS subserver already handles file upload with CAS dedup
- Resource types: document, folder, project, url, notebook, workspace
- Retrieval is on-the-fly: reads file content → chunks → scores → top-6
- Embedding provider interface exists (`MemoryEmbeddingProvider`) but not wired to knowledge

## 5. P1 Scope Decision

P1 closes G1 + G2 + partial G3 (pluggable provider interface). G4-G8 deferred to P2/P3.

Rationale: file upload + management UI makes the RAG pipeline usable end-to-end. Real embedding and persistent indexing improve quality but aren't blockers for functional completion.

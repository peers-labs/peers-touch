# P1-M4: User Memory — Reference Analysis (S1)

> **Module**: P1-M4 User Memory
> **Step**: S1 — Reference Analysis
> **Status**: complete
> **Source**: `docs/architecture/agent/lobehub-feature-topology.md` L2 store/userMemory

---

## 1. LobeHub Feature Surface

### Store Layer (`store/userMemory`)

- `slices/base` — clearEditingMemory, purgeAllMemories, refreshUserMemory, setActiveMemoryContext, setEditingMemory, updateMemory
- `slices/identity` — createIdentity, loadMoreIdentities, resetIdentitiesList, updateIdentity, useFetchIdentities
- `slices/activity` — loadMoreActivities, resetActivitiesList, useFetchActivities
- `slices/context` — loadMoreContexts, resetContextsList, useFetchContexts
- `slices/experience` — loadMoreExperiences, resetExperiencesList, useFetchExperiences
- `slices/preference` — loadMorePreferences, resetPreferencesList, useFetchPreferences
- `slices/agent` — clearTopicMemories, useFetchMemoriesForTopic
- `slices/home` — useFetchPersona, useFetchTags

### UI Integration

- `features/ChatInput/ActionBar/Memory/` — per-message memory toggle

### Runtime

- `state/memory.ts` — runtime memory state in agent orchestration

---

## 2. Peers Current State

| Layer | Component | Status |
|-------|-----------|--------|
| Proto | memory.proto — full CRUD + search + persona + events | ✅ |
| Station Service | 26+ methods — Add/Replace/Remove/List/Search/Persona/Snapshot/Rollback/Freeze | ✅ |
| Station Routes | 18+ endpoints (list/get/delete/search/persona/stats/events/export/import/reembed/feedback) | ✅ |
| Station Embedding | Pluggable (OpenAI-compat, Ollama, hash fallback) + pgvector | ✅ |
| Desktop Rust | 12 Tauri commands (list/get/delete/search/persona/stats/events/export/import/embedding-status/reembed) | ✅ |
| Desktop API | Typed wrappers for all commands | ✅ |
| Desktop UI | MemoryPage (browse/search/persona/events) + MemorySettingsTab | ✅ |
| Prompt Injection | BuildRelevantSnapshot → L3 layer | ✅ |
| Memory Tool | `memory` in ToolRegistryService (LLM save/query) | ✅ |
| Auto-extraction | ExtractFromTurn + FlushMemories | ✅ |

### Exceeds LobeHub

- Snapshots + Rollback
- Freeze protection
- Trust score + feedback
- Decay model (layer-aware exponential)
- Knowledge Salvage (FlushMemories)
- Security scanning (injection/exfiltration detection)
- Score explanation transparency

## 3. Gap Analysis

| # | Gap | LobeHub Equivalent | Severity |
|----|-----|-------------------|----------|
| G1 | No Zustand store (all state in component useState) | store/userMemory (7 slices) | Medium |
| G2 | No inline memory edit UI | setEditingMemory + updateMemory | Medium-High |
| G3 | No per-chat memory toggle | ChatInput/ActionBar/Memory | Medium |
| G4 | No per-layer management tabs | Per-layer slices with loadMore | Medium |
| G5 | No topic-scoped memory view | slices/agent (clearTopicMemories) | Low (P2) |
| G6 | No memory tagging | useFetchTags | Low (P3) |

## 4. P1 Scope

Close G1 + G2 + G3 + partial G4. G5-G6 deferred.

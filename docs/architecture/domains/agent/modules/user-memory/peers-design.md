# P1-M4: User Memory — Peers Design (S2)

> **Module**: P1-M4 User Memory
> **Step**: S2 — Peers Design
> **Status**: draft
> **Finding**: Memory backend is 95%+ implemented (Station + Rust + API). Gaps are frontend store architecture and edit UI.

---

## 1. Current State (already implemented)

| Layer | Component | Status |
|-------|-----------|--------|
| Station | Full memory service (26+ methods) | ✅ |
| Rust BFF | 12 Tauri commands | ✅ |
| Desktop API | Typed wrappers | ✅ |
| Desktop UI | MemoryPage (browse/search/persona/events) | ✅ |
| Prompt injection | L3 BuildRelevantSnapshot | ✅ |
| Memory tool | LLM can save/query via tool call | ✅ |

## 2. Gaps to Close (P1 scope)

| # | Gap | Impact | Effort |
|---|-----|--------|--------|
| G1 | No Zustand memory store | Cross-component state sharing impossible; no cache invalidation | Medium |
| G2 | No memory edit (only delete) | Users cannot correct wrong memories without LLM | Medium |
| G3 | No per-chat memory toggle | Cannot disable memory for sensitive conversations | Low |
| G4 | No layer tabs in browse | All layers in flat list, harder to manage | Low |

## 3. Design: G1 — Zustand Memory Store

**Problem**: MemoryPage manages all memory state via local `useState`. This prevents other components (chat, settings, sidebar badges) from reacting to memory changes.

**Solution**: Create `store/memory.ts` as a Zustand store with the same pattern as `store/agent.ts`.

**Store shape**:
```typescript
interface MemoryState {
  memories: Memory[];
  total: number;
  loading: boolean;
  layer: string | undefined;
  page: number;
  editingMemoryId: string | null;
  editingContent: string;
  persona: Persona | null;
  stats: MemoryStats | null;
}

interface MemoryActions {
  loadMemories: (params?) => Promise<void>;
  searchMemories: (query, opts?) => Promise<ScoredMemory[]>;
  deleteMemory: (id: string) => Promise<void>;
  updateMemory: (id: string, content: string) => Promise<void>;
  setEditingMemory: (id: string | null) => void;
  setLayer: (layer: string | undefined) => void;
  loadPersona: (agentId?: string) => Promise<void>;
  loadStats: () => Promise<void>;
  refreshAll: () => Promise<void>;
}
```

**Key decisions**:
- Store is global singleton (like agent store)
- `updateMemory` calls a new Rust command → Station endpoint
- Optimistic update pattern with rollback on failure

## 4. Design: G2 — Memory Update Endpoint + UI

**Problem**: No way to edit a memory item. Station has `Replace()` but it's text-matching-based (for LLM use). Need a direct ID-based update.

**Solution**: Add a minimal update-by-ID path.

**Station changes**:
- Add `UpdateMemory(ctx, memoryID, newContent)` method to MemoryService
- Add `HandleUpdateMemory` handler
- Add `/agent/memory/update` route

**Rust BFF changes**:
- Add `memory_update` Tauri command

**Desktop changes**:
- Add `api.updateMemory(id, content)` in desktop_api.ts
- Add `updateMemory` action in the new store
- Add inline edit mode in MemoryPage browse items (click content → editable textarea → save/cancel)

## 5. Design: G3 — Per-Chat Memory Toggle

**Problem**: Users cannot disable memory for a specific conversation.

**Solution**: Add a memory toggle button in the chat header or composer area.

**Implementation**:
- Add `memoryEnabled` field to chat session state (store/chat.ts)
- Default: `true` (matches existing behavior)
- When disabled: turn request omits memory snapshot from prompt assembly
- UI: Small toggle icon in the chat message input area (Brain icon with on/off state)

**Changes**:
- `store/chat.ts`: Add `memoryEnabled` per-session state + `toggleMemory` action
- `AgentExecuteTurnInput`: Add optional `memory_disabled?: boolean` field
- Station `turn_service.go`: If `memory_disabled` is true, skip L3 (memory snapshot) in prompt assembly
- Composer UI: Add memory toggle button

## 6. Design: G4 — Layer Tabs

**Problem**: Browse tab shows all memories in a flat list with only a filter chip.

**Solution**: Convert the layer filter into proper tabs at the top of the browse section.

**Implementation**: Minimal — replace the Select filter with antd `Segmented` or tab-like buttons for the 5 layers + "All".

## 7. File Manifest

| # | File | Action | Gap |
|---|------|--------|-----|
| 1 | `apps/desktop/src/store/memory.ts` | Create — Zustand memory store | G1 |
| 2 | `apps/desktop/src/pages/MemoryPage.tsx` | Modify — use store, add inline edit, layer tabs | G1, G2, G4 |
| 3 | `apps/desktop/src/services/desktop_api.ts` | Modify — add updateMemory API | G2 |
| 4 | `apps/desktop/src-tauri/src/interface/tauri_commands/memory.rs` | Modify — add memory_update command | G2 |
| 5 | `apps/station/app/subserver/agent/service/memory_service.go` | Modify — add UpdateMemory method | G2 |
| 6 | `apps/station/app/subserver/agent/handler/memory_handler.go` | Modify — add HandleUpdateMemory | G2 |
| 7 | `apps/station/app/subserver/agent/agent.go` | Modify — register /agent/memory/update route | G2 |
| 8 | `apps/desktop/src/store/chat.ts` | Modify — add memoryEnabled state + toggleMemory | G3 |
| 9 | `apps/desktop/src/components/ChatComposer.tsx` | Modify — add memory toggle button | G3 |
| 10 | Station `turn_service.go` or `prompt_assembly_service.go` | Modify — respect memory_disabled flag | G3 |

## 8. What Does NOT Change

- Memory proto definitions (sufficient)
- Station embedding provider infrastructure
- Memory auto-extraction pipeline
- Memory snapshot/rollback system
- MemorySettingsTab (already complete)
- Memory persona/events tabs (already working)

## 9. Acceptance Criteria

See `acceptance.md` in this directory.

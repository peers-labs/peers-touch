# Module 4: Agent Config & Profile — Peers-Touch Architecture Design

> Step 2 of architecture design methodology.
> Status: DRAFT
> Last updated: 2026-08-12

---

## 1. Architecture Overview

### 1.1 Design Scope (P0)

Enhance the existing Agent Config & Profile system to support full agent configuration:
- System prompt editing (SOUL.md + AGENTS.md already exist; add `systemPrompt` direct editing)
- Model/provider binding (already functional in AgentProfilePage)
- Opening message + questions (already in AgentSettingsModal)
- Knowledge resource list (display + CRUD for `knowledgeResources`)
- Unified settings panel that consolidates AgentSettingsModal + AgentProfilePage capabilities

### 1.2 Deferred (P1+)

| Priority | Feature | Reason |
|----------|---------|--------|
| P1 | Selector layer for agent store | Performance optimization; not blocking functionality |
| P1 | Save status indicator (idle/saving/saved) | UX polish |
| P2 | AI autocomplete for system prompt | Requires streaming infrastructure changes |
| P2 | Two-store pattern (global + feature-scoped) | Architectural refinement for multi-panel |
| P3 | Graph runtime / self-iteration modes | Not in current product scope |

### 1.3 Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Store pattern | Single `useAgentStore` + local component state for editing | Existing pattern works; two-store adds complexity without P0 benefit |
| Persistence | Station owns via existing `api.updateAgent()` | Already implemented; no new service layer needed |
| Config shape | Extend existing `Agent` interface fields + `AgentChatConfig` JSON blob | Matches current data model; no proto changes for P0 |
| Settings UI | Enhance `AgentProfilePage` tabs (primary) + keep `AgentSettingsModal` for quick-edit | Profile page is the workbench; modal is secondary access |
| Knowledge binding | `knowledgeResources` JSON field on Agent (existing) | Already in Agent interface; needs UI and store action |

### 1.4 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Config Data Flow (P0)                    │
│                                                                   │
│  AgentProfilePage                                                 │
│  ┌─────────────────────┐    local state     ┌──────────────────┐ │
│  │ Soul Tab             │◀──────────────────▶│ useState hooks   │ │
│  │ Capabilities Tab     │    (editing buf)   │ (soulMd, etc.)   │ │
│  │ Workspace Tab        │                    └────────┬─────────┘ │
│  └─────────┬───────────┘                             │            │
│            │ onBlur / debounced save                  │            │
│            ▼                                         ▼            │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  useAgentStore                                               │ │
│  │  - updateAgentProfile(id, partial)   ← optimistic update     │ │
│  │  - updateAgentConfig(name, chatCfg)  ← chatConfig merge      │ │
│  │  - updateKnowledgeResources(id, res) ← NEW                   │ │
│  └─────────────────────────────────┬───────────────────────────┘ │
│                                    │                              │
│                                    ▼                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  desktop_api.ts → Tauri IPC → Rust BFF → Station gRPC       │ │
│  │  api.updateAgent(id, payload)                                 │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Enhanced Agent Store

### 2.1 New Actions

```typescript
// Added to useAgentStore

// Update knowledge resources for an agent
updateKnowledgeResources: (agentId: string, resources: AgentKnowledgeResource[]) => Promise<void>;

// Get parsed knowledge resources for an agent
getAgentKnowledgeResources: (agentId: string) => AgentKnowledgeResource[];
```

### 2.2 Knowledge Resource Type (existing in desktop_api.ts)

```typescript
export type AgentKnowledgeResourceType = 'document' | 'folder' | 'project' | 'url' | 'notebook' | 'workspace';

export interface AgentKnowledgeResource {
  id: string;
  type: AgentKnowledgeResourceType;
  title: string;
  path?: string;       // file/folder path
  url?: string;        // URL resource
  enabled: boolean;
  addedAt: string;     // ISO timestamp
}
```

### 2.3 Store Implementation Pattern

The new `updateKnowledgeResources` follows the same optimistic update pattern as `updateAgentProfile`:

1. Serialize resources to JSON string
2. Optimistic local update via `set()`
3. Call `api.updateAgent(id, { knowledgeResources: JSON.stringify(resources) })`
4. Reconcile on success; rollback on error
5. Track via `pendingMutations` with key `knowledge:${agentId}`

### 2.4 Fields Already Available (No Store Changes Needed)

The following config capabilities already exist in the `Agent` interface and are persisted by Station:

| Field | Type | Location | Current UI |
|-------|------|----------|------------|
| `systemPrompt` | string | `Agent.systemPrompt` | None (only soulMd/agentsMd exposed) |
| `model` | string | `Agent.model` | AgentProfilePage routing bar |
| `provider` | string | `Agent.provider` | AgentProfilePage routing bar |
| `openingMessage` | string | `Agent.openingMessage` | AgentSettingsModal |
| `openingQuestions` | JSON string | `Agent.openingQuestions` | AgentSettingsModal |
| `knowledgeResources` | JSON string | `Agent.knowledgeResources` | None |
| `chatConfig` | JSON string | `Agent.chatConfig` | Partially (tools, skills, mcp) |

---

## 3. Settings Panel Design

### 3.1 AgentProfilePage Tab Enhancement

The existing tab structure is enhanced, not replaced:

```
Mode: Configure
├── Soul Tab (existing)
│   ├── SOUL.md editor (existing)
│   ├── AGENTS.md editor (existing)
│   └── System Prompt editor (NEW — direct systemPrompt field)
│
├── Capabilities Tab (existing)
│   ├── Skill Packages (existing)
│   ├── Tools & MCP (existing)
│   └── Knowledge Resources (NEW — list + add/remove/toggle)
│
└── Workspace Tab (existing, no changes for P0)

Mode: Activity
├── Tasks Tab (existing)
├── Memory Tab (existing)
└── Diagnostics Tab (existing)
```

### 3.2 New UI Section: System Prompt (in Soul Tab)

Added below the SOUL.md / AGENTS.md dual-column grid:

```
┌─────────────────────────────────────────────────────────────────┐
│ System Prompt                                                     │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ A monospace textarea for direct system prompt editing.       │ │
│ │ Auto-saves on blur with 1.5s debounce (same as soulMd).     │ │
│ │ This is the raw prompt sent to the LLM; SOUL.md is          │ │
│ │ supplementary identity context.                              │ │
│ │                                                              │ │
│ │ Placeholder: "Enter system instructions for this agent..."  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                          [AI ✨] │
│ (AI button is disabled/hidden for P0; reserved for P2)          │
└─────────────────────────────────────────────────────────────────┘
```

**Persistence**: `api.updateAgent(agent.id, { systemPrompt: value })`

**Relationship to SOUL.md**: At runtime, the chat system concatenates:
1. `systemPrompt` (primary instructions)
2. `soulMd` (identity/personality context)
3. `agentsMd` (workflow/delegation rules)

The UI makes this hierarchy clear with section descriptions.

### 3.3 New UI Section: Knowledge Resources (in Capabilities Tab)

Added as a third ProfileCard in the capabilities tab:

```
┌─────────────────────────────────────────────────────────────────┐
│ Knowledge Resources                         [+ Add Resource]     │
│ Resources that provide context to the agent during conversation  │
│                                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 📄 project-docs.md          document   ✓ enabled    [×]    │ │
│ │ 📁 /path/to/codebase        folder     ✓ enabled    [×]    │ │
│ │ 🔗 https://docs.example.com url        ○ disabled   [×]    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ (Empty state: "No knowledge resources. Add documents, folders,   │
│  or URLs to give this agent domain context.")                    │
└─────────────────────────────────────────────────────────────────┘
```

**Add Resource flow** (P0 — minimal):
- Popover/dropdown with resource type selection
- For `document`/`folder`: native file picker via Tauri `dialog.open()`
- For `url`: text input
- Each resource gets a generated UUID, type, title (filename/URL), and `enabled: true`

### 3.4 AgentSettingsModal (Quick-Edit — Unchanged for P0)

The existing modal remains as a lightweight editor for:
- Title, description, background color, tags (Info tab)
- Opening message + questions (Opening tab)

It is accessed via the Settings gear icon in AgentProfilePage header. No structural changes for P0.

---

## 4. Integration with Provider/Model Selection (M5)

### 4.1 Current State (Already Functional)

The AgentProfilePage routing bar already implements:
- Provider dropdown (filters available models by provider)
- Model select (ModelSelect component with search)
- Effort level selector

These persist to `Agent.model` and `Agent.provider` via `handleModelChange` / `handleProviderChange`.

### 4.2 P0 Enhancement: Model Config Binding Scope

Current behavior:
```typescript
await api.setModelConfig(`agent:${agent.name}`, { provider, model });
```

This sets a per-agent model override that the chat runtime reads. No changes needed for P0.

### 4.3 Future (P1): Default Model Inheritance

When M5 (Provider & Model Management) is fully implemented:
- If agent has no explicit model binding → inherit global default
- AgentProfilePage shows "(default)" indicator when no override is set
- Clear button resets to inherited default

---

## 5. Component Responsibility Map

| Component | Responsibility | Data Source |
|-----------|---------------|-------------|
| `AgentProfilePage` | Full workbench: all config tabs, builder panel, agent roster | `useAgentStore` |
| `AgentSettingsModal` | Quick-edit: title, desc, color, tags, opening msg/questions | Props from parent + `api.updateAgent` |
| `AgentWorkbenchHero` | Title, description, avatar inline editing | Props + callbacks |
| `ProfileCard` | Generic card wrapper | Props |
| `ModelSelect` | Model picker with search | `availableModels` from store |
| `BuilderPanel` | AI assistant for config generation | Agent context payload |

### 5.1 New Components (P0)

| Component | Location | Purpose |
|-----------|----------|---------|
| `SystemPromptEditor` | Inline in Soul tab | Textarea with debounced save for `systemPrompt` |
| `KnowledgeResourceList` | Inline in Capabilities tab | List + add/remove/toggle for knowledge resources |
| `KnowledgeResourceAddPopover` | Child of KnowledgeResourceList | Resource type selection + input |

These are **not** extracted to separate files for P0. They are rendered inline within the tab content of `AgentProfilePage`, following the existing pattern (soul tab editors are inline). Extract to components in P1 when the file grows beyond maintenance threshold.

---

## 6. Data Model Constraints

### 6.1 Serialization

All complex config is stored as JSON strings in the `Agent` record:
- `chatConfig`: `JSON.stringify(AgentChatConfig)`
- `knowledgeResources`: `JSON.stringify(AgentKnowledgeResource[])`
- `openingQuestions`: `JSON.stringify(string[])`
- `tags`: `JSON.stringify(string[])`

This is the existing pattern. No schema migration for P0.

### 6.2 Validation Rules

| Field | Constraint |
|-------|-----------|
| `systemPrompt` | Max 100,000 chars (LLM context limit guard) |
| `openingMessage` | Max 2,000 chars |
| `openingQuestions` | Max 10 items, each max 200 chars |
| `knowledgeResources` | Max 50 items per agent |
| `model` | Must exist in `availableModels` or be empty (inherit default) |

Validation is client-side only for P0. Station validates field-level constraints on write.

---

## 7. Non-Goals (Explicit Exclusions)

1. **No new proto definitions** — P0 uses existing `Agent` flat fields + JSON blobs
2. **No SWR/cache layer** — Continue with manual `loadAgents()` pattern
3. **No selector decomposition** — Direct `agents.find(...)` remains acceptable
4. **No two-store pattern** — Single store + local editing state
5. **No AI autocomplete for system prompt** — P2
6. **No plugin tri-state modes** — Keep binary on/off for applets/tools
7. **No streaming system role generation** — P2
8. **No multi-device working directory** — Single workspace root per agent

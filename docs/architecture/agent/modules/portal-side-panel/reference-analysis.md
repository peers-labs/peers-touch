# P1-M5: Portal / Side Panel — S1 Reference Analysis

> **Module**: P1-M5 Portal / Side Panel
> **Source**: `docs/architecture/agent/lobehub-feature-topology.md` L134-141, L640-660
> **Batch**: P1 — last module before P2

---

## 1. LobeHub Feature Scope (from topology)

### Store Layer (`slices/portal`)

- **Navigation stack**: `clearPortalStack`, `goBack`, `goHome`, `popPortalView`
- **Open actions**: `openAgentDetail`, `openDocument`, `openFilePreview`, `openLocalFile`, `openMessageDetail`, `openNotebook`, `openTaskDetail`, `openTopicCommentThread`
- **Close actions**: `closeDocument`, `closeFilePreview`, `closeLocalFile`, `closeToolUI`, `closeMessageDetail`, `closeNotebook`, `closeTaskDetail`
- **Local file**: `setActiveLocalFile`, `setLocalFileBuffer`, `saveLocalFile`

### UI Layer (`features/Portal`)

| Sub-module | Shows |
|------------|-------|
| `Artifacts/` | Artifact preview (code blocks, live React) |
| `Thread/` | Thread conversation branch |
| `FilePreview/` | File content preview |
| `Document/` | Document viewer |
| `MessageDetail/` | Single message deep-dive (tool calls, metadata) |
| `Plugins/` | Plugin/tool output UI |
| `TaskDetail/` | Background task detail |
| `AgentDetail/` | Agent info card |
| `Home/` | Portal home (Files, Plugin/ArtifactList) |

---

## 2. Existing Implementation — Deep Analysis

### 2.1 Layout Infrastructure

**AgentChatPage** (`pages/AgentChatPage.tsx`):
- Two-column flex: left aside (230px / 48px collapsed) + main (flex:1)
- Topic aside (230px) inside main when not narrow
- **No right panel container** — main ends at right edge
- `ResizeObserver` drives `narrow` state (< 900px → hide topic sidebar)
- Sidebar widths are **hardcoded, not draggable**

**Available resize library**: `@lobehub/ui` exports `DraggablePanel` component.
**Proven pattern**: `BuilderPanel.tsx` wraps `DraggablePanel` with:
- `placement="right"`, defaultWidth 400px, min 320, max 560
- Collapsed state: 40px tab bar with expand button
- Used in AgentProfilePage and NotesPage successfully

### 2.2 Artifact System (split into two independent systems)

**System A — Chat artifact extraction** (`store/chat.ts` L326-390):
- `extractMessageArtifacts(message)` — pure function, runs on assistant messages
- Parses fenced code blocks → classifies into `code | document | diagram | structured`
- Also detects long-form documents (>= 600 chars with headings/tables)
- Produces `MessageArtifact` objects with id, kind, language, content, sourceRange

**System B — Atelier applet sandbox** (`applet/AtelierArtifactPreviewHost.ts`):
- Protocol adapter for applet artifact preview (markdown, web, image, diff renderers)
- Enforces sandboxing (no scripts/network/navigation)
- **Not mounted in chat page** — only in `AppletRuntimePage`
- **Completely independent from System A**

### 2.3 Artifact Rendering — The Disconnected Wire

**AssistantMessage.tsx** (L63-128, L460):
- Accepts `onOpenArtifact?: (artifact: MessageArtifact) => void` prop
- When provided: renders "Open" button (ExternalLink icon) next to each artifact
- When NOT provided: only copy/export are available
- `ArtifactBlock` renders inline artifact cards (title, language tag, copy/export)

**The disconnect**: `ChatPage` → `MessageList` → `MessageBubble` → `AssistantMessage`
does NOT pass `onOpenArtifact`. Therefore:
- **"Open" button never appears in Agent Chat**
- The infrastructure IS ready — just needs the callback wired + a destination panel

### 2.4 ToolCall Rendering

**ToolCallCard.tsx** (`components/messages/ToolCallCard.tsx`):
- `ToolCallItem`: expandable card showing name, status, args, result, approval flow
- `ToolCallsBlock`: collapsed summary "Used N tools...", expands to full list
- In `AssistantMessage` (L454-456): rendered inline between diagnostics and content
- **No "open in panel" action** — everything is inline expand/collapse

### 2.5 KnowledgeChunk Rendering

- `KnowledgeChunkInfo` stored per message
- Rendered as inline citation cards in AssistantMessage
- No panel view exists

---

## 3. Architecture Questions — Answered

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| Q1 | Portal scope | Per-page (AgentChatPage), lifecycle tied to active session | LobeHub portal actions reference message/tool context specific to current conversation |
| Q2 | `onOpenArtifact` destination | Right panel (Portal) | It's already a prop on AssistantMessage waiting to be connected; modal/tab would not reuse this pattern |
| Q3 | Navigation model for P1 | Single active view (not full stack) | P1 only needs 2-3 view types; stack is LobeHub's full-feature model for P2+ |
| Q4 | Narrow mode | Collapse to hidden or minimal icon bar | BuilderPanel precedent: 40px collapsed tab bar |

---

## 4. Gap Analysis

| Gap | Priority | Size | Reuse |
|-----|----------|------|-------|
| G1: Portal state (activeView, open/close) | High | Small | New Zustand slice, ~60 lines |
| G2: Portal container in AgentChatPage | High | Medium | Follow BuilderPanel + DraggablePanel pattern |
| G3: Wire `onOpenArtifact` through MessageList → AssistantMessage | High | Small | Thread callback through 2-3 component levels |
| G4: Artifact preview panel content | High | Medium | Render artifact content with syntax highlighting (already have Prism via LobeUI) |
| G5: Tool detail panel content | Medium | Small | Reuse ToolCallItem expanded view in full-width panel |
| G6: Knowledge chunk panel | Low | Small | Defer to P2 |

---

## 5. Scope Decision for P1-M5

**Deliver**: G1 + G2 + G3 + G4 + G5 (5 items)

**Skip for P2**: Full stack navigation, local file editor, document viewer, thread, agent detail panel, knowledge panel

**Zero backend work** — pure frontend, all data already available.

---

## 6. Key Constraints

1. Portal MUST use `DraggablePanel` from `@lobehub/ui` (proven in BuilderPanel)
2. Portal state lives in a dedicated `store/portal.ts` (not inside chat.ts — chat.ts is already 1400+ lines)
3. `onOpenArtifact` callback threads from Portal store → ChatPage → MessageList → MessageBubble → AssistantMessage
4. In narrow mode (< 900px), Portal is hidden (no overlay)
5. No new i18n keys needed for P1 scope (panel chrome is icon-only)

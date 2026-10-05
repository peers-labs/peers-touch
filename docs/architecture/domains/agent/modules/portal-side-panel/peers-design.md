# P1-M5: Portal / Side Panel — S2 Design

> **Module**: P1-M5 Portal / Side Panel
> **S1 Source**: `reference-analysis.md`

---

## 1. Architecture Overview

Portal is a **first-class rendering surface** in AgentChatPage, equal in status to the conversation area.

```
┌─────────────────────────────────────────────────────────────────────┐
│ AgentChatPage                                                        │
├──────────┬───────────────────────────────┬──────────────────────────┤
│          │                               │                          │
│  Agent   │                               │                          │
│  List    │     Conversation Area         │     Portal Panel         │
│  Aside   │     (ChatPage)                │     (PortalPanel)        │
│          │                               │                          │
│  230px   │     flex: 1                   │     DraggablePanel       │
│          │                               │     320-560px            │
│          │                               │                          │
├──────────┴───────────────────────────────┴──────────────────────────┤
│ narrow mode (< 900px): Portal hidden, Agent List collapsed          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. State Management — `store/portal.ts`

### 2.1 Portal View Type (discriminated union)

```typescript
type PortalView =
  | { type: 'artifacts'; messageId?: string }
  | { type: 'artifactDetail'; artifact: MessageArtifact }
  | { type: 'toolDetail'; messageId: string; toolCallId: string };
```

### 2.2 Store Interface

```typescript
interface PortalState {
  expanded: boolean;
  activeView: PortalView | null;
}

interface PortalActions {
  openArtifact: (artifact: MessageArtifact) => void;
  openArtifacts: (messageId?: string) => void;
  openToolDetail: (messageId: string, toolCallId: string) => void;
  close: () => void;
  toggle: () => void;
}
```

### 2.3 Design Decisions

- **Separate file**: `store/portal.ts` — chat.ts is 1400+ lines, not adding to it
- **No stack for P1**: single `activeView`. `open*` replaces current view. Stack deferred to P2.
- **`expanded` persists**: user can collapse portal; opening a view auto-expands.
- **Store-to-store independence**: portal store does not import chat store. Data lookup happens in components.

---

## 3. Interaction Model — Store Actions from Components

Components call portal store actions directly (no props drilling):

```
AssistantMessage
  → user clicks "Open" on artifact card
  → usePortalStore.getState().openArtifact(artifact)

ToolCallItem
  → user clicks "Details" button
  → usePortalStore.getState().openToolDetail(messageId, toolCallId)

ChatPage header
  → user clicks PanelRight icon (toggle button, right side of header)
  → usePortalStore.getState().toggle()
```

This avoids modifying ChatPage/MessageList/MessageBubble interfaces.
AssistantMessage already imports stores (`useChatStore` for retry); importing `usePortalStore` is the same pattern.

---

## 4. Component Architecture

### 4.1 File Tree

```
src/components/portal/
├── PortalPanel.tsx            # Container: DraggablePanel + view router
├── PortalHeader.tsx           # Title bar with close button
├── views/
│   ├── ArtifactListView.tsx   # All artifacts in current conversation
│   ├── ArtifactDetailView.tsx # Single artifact: syntax highlight / markdown / diagram
│   └── ToolDetailView.tsx     # Full tool call detail: args, result, timing
└── index.ts
```

### 4.2 Component Responsibilities

**PortalPanel** (container):
- Uses `@lobehub/ui` `DraggablePanel` with `placement="right"`, min 320px, max 560px, default 400px
- Reads `usePortalStore()` for `expanded` and `activeView`
- Reads `useChatStore()` for `messages` (read-only, to feed views)
- Routes to view component based on `activeView.type`
- When `activeView === null` && `expanded === true`: shows ArtifactListView

**PortalHeader**:
- Dynamic title based on activeView type
- Close button → `portalStore.close()`

**ArtifactListView**:
- Gets messages from parent (passed as prop from PortalPanel)
- Calls `extractMessageArtifacts()` on assistant messages
- Renders artifact cards grouped by message
- Click → `portalStore.openArtifact(artifact)`

**ArtifactDetailView**:
- Receives `artifact: MessageArtifact` from activeView
- Renders based on `artifact.kind`:
  - `code`: `@lobehub/ui` `Highlighter` with line numbers
  - `document`: `@lobehub/ui` `Markdown`
  - `diagram`: code block fallback (mermaid rendering deferred to P2)
  - `structured`: JSON pretty-print
- Copy/download in header

**ToolDetailView**:
- Looks up `ToolCallInfo` from messages by messageId + toolCallId
- Full-width layout: name, server, status, args (formatted JSON), result (formatted), duration, approval info
- Reuses visual style from ToolCallCard but panel-optimized width

---

## 5. AgentChatPage Integration

### Layout Change

```tsx
// Current: two-column
<div style={{ display: 'flex' }}>
  <aside />
  <main />
</div>

// New: main becomes flex container with portal sibling
<div style={{ display: 'flex' }}>
  <aside />
  <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
    <div style={{ flex: 1 }}>{/* existing content */}</div>
    {!narrow && <PortalPanel />}
  </main>
</div>
```

Portal is a sibling within `main`, not a child of ChatPage. ChatPage is unchanged.

### Portal Toggle Button

Location: ChatPage header, right side (symmetric with profile button on left).
Icon: `PanelRight` from lucide-react.
Behavior: `usePortalStore().toggle()`

---

## 6. Implementation Order

| Step | Deliverable | Depends on |
|------|-------------|-----------|
| 1 | `store/portal.ts` | Nothing |
| 2 | `components/portal/PortalPanel.tsx` + `PortalHeader.tsx` | Step 1 |
| 3 | `components/portal/views/ArtifactDetailView.tsx` | Step 2 |
| 4 | `components/portal/views/ArtifactListView.tsx` | Step 3 |
| 5 | `components/portal/views/ToolDetailView.tsx` | Step 2 |
| 6 | AgentChatPage layout: add PortalPanel as sibling | Steps 2-5 |
| 7 | AssistantMessage: add portal store calls in ArtifactBlock "Open" button | Step 1 |
| 8 | ToolCallCard: add "Details" button calling portal store | Step 1 |
| 9 | ChatPage header: add toggle button | Step 1 |

Steps 1-5: new files, zero changes to existing code.
Steps 6-9: minimal integration (layout sibling, 2 button additions, 1 icon button).

---

## 7. Explicit Non-Scope

- No stack navigation (P2)
- No MessageDetailView (P2)
- No local file editor (P2)
- No thread panel (P2)
- No document viewer (P2)
- No knowledge chunk panel (P2)
- No backend changes / proto / Rust
- No new i18n keys for P1 (panel chrome is icon-only; artifact kind labels use existing code language names)

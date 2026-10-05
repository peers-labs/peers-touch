# Module 3: Chat Input & Composer — Peers-Touch Architecture Design

> Architecture Design Methodology S2 — Peers Adaptation  
> Supersedes: monolithic `ChatInput.tsx`  
> Date: 2026-08-12

---

## 1. Architecture Overview

### 1.1 Design Principles

1. **Plain textarea for P0** — Lexical rich editor deferred to P1.
2. **Registry-driven ActionBar** — configurable per agent/context without touching component internals.
3. **File attachment lifecycle** — stage, upload, preview, send. Already partially implemented via `useAgentAttachmentDrafts`.
4. **Integration-first** — composer owns input state; send delegates to `useChatStore.sendMessage()` and `store/streaming/` for operation tracking.
5. **No command bus, no @mentions for P0** — slash text insertion remains a stub.

### 1.2 Component Tree

```
<ChatComposer>                          # Root container — layout, border, keyboard
├── <AttachmentStage />                 # Shows staged file drafts (existing inline logic extracted)
├── <ComposerTextarea />                # Plain <textarea> with auto-resize + IME guard
├── <ComposerFooter>                    # Bottom bar: actions | spacer | model | send
│   ├── <ActionBar position="left" />   # Registry-driven action buttons
│   ├── <ModelPicker />                 # Provider/model dropdown (extracted from current inline)
│   └── <SendControl />                 # Send/Stop button with disabled/streaming states
└── <HiddenFileInput />                 # Invisible <input type="file"> triggered by ActionBar
```

### 1.3 State Ownership

| State | Owner | Accessed by |
|-------|-------|-------------|
| `inputText` (draft content) | `ChatComposer` local `useState` | `ComposerTextarea`, `SendControl` |
| `drafts` (attachment staging) | `useAgentAttachmentDrafts` hook | `AttachmentStage`, `SendControl` |
| `isStreaming`, `sendMessage` | `useChatStore` (global) | `SendControl`, `ChatComposer` |
| `selectedModel`, `availableModels` | `useAgentStore` (global) | `ModelPicker` |
| `actionItems` | `ActionBarRegistry` config | `ActionBar` |

### 1.4 Directory Structure (target)

```
apps/desktop/src/components/composer/
├── ChatComposer.tsx            # Root (replaces ChatInput.tsx)
├── ComposerTextarea.tsx        # Textarea with auto-resize
├── ComposerFooter.tsx          # Layout wrapper for bottom bar
├── AttachmentStage.tsx         # Staged file previews
├── SendControl.tsx             # Send/Stop button
├── ModelPicker.tsx             # Model/provider dropdown
├── ActionBar/
│   ├── ActionBar.tsx           # Renders items from registry
│   ├── registry.ts            # ActionBarItem registry + config
│   ├── items/
│   │   ├── SlashAction.tsx     # "/" insertion
│   │   ├── FileUploadAction.tsx  # Trigger file picker
│   │   ├── SearchAction.tsx    # (P1 placeholder, hidden by default)
│   │   └── index.ts           # Re-exports
│   └── types.ts               # ActionBarItem interface
├── useAgentAttachmentDrafts.ts # (moved from current location)
└── index.ts                    # Public export: ChatComposer
```

---

## 2. ActionBar Registry

### 2.1 Interface

```typescript
// composer/ActionBar/types.ts

export interface ActionBarItem {
  /** Unique key used for ordering and conditional rendering */
  key: string;
  /** Lucide icon component */
  icon: React.ComponentType<{ size?: number }>;
  /** i18n key for tooltip */
  titleKey: string;
  /** Click handler — receives composer context */
  onAction: (ctx: ActionBarContext) => void;
  /** Whether item is visible (default: true) */
  visible?: boolean | ((ctx: ActionBarContext) => boolean);
  /** Whether item is disabled */
  disabled?: boolean | ((ctx: ActionBarContext) => boolean);
}

export interface ActionBarContext {
  /** Trigger the hidden file input */
  triggerFileInput: () => void;
  /** Insert text at cursor */
  insertText: (text: string) => void;
  /** Current textarea ref */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Whether streaming is active */
  isStreaming: boolean;
}
```

### 2.2 Registry

```typescript
// composer/ActionBar/registry.ts

import { Slash, Image as ImageIcon } from 'lucide-react';
import type { ActionBarItem } from './types';

export const defaultLeftActions: ActionBarItem[] = [
  {
    key: 'slash',
    icon: Slash,
    titleKey: 'chat.input.slashCommand',
    onAction: (ctx) => ctx.insertText('/'),
  },
  {
    key: 'fileUpload',
    icon: ImageIcon,
    titleKey: 'chat.input.uploadFile',
    onAction: (ctx) => ctx.triggerFileInput(),
  },
];

export const defaultRightActions: ActionBarItem[] = [];
```

### 2.3 Extension Pattern

Consumers (e.g., specialized agent panels) override via props:

```typescript
<ChatComposer
  leftActions={[...defaultLeftActions, myCustomAction]}
  rightActions={[modelPickerAction]}
/>
```

---

## 3. File Attachment Flow

### 3.1 Lifecycle State Machine

```
                  +----------+
                  |   IDLE   |  (no files staged)
                  +----+-----+
                       |
         user picks /  | drops files
                       v
                  +----+-----+
                  | UPLOADING|  per-file: status='uploading'
                  +----+-----+
                       |
         upload done   |  uploadAgentAttachmentFile() resolves
                       v
                  +----+-----+
                  |  READY   |  per-file: status='ready', attachment populated
                  +----+-----+
                       |
                  send / user removes
                       v
                  +----+-----+
                  |  CLEARED |  drafts=[], preview URLs revoked
                  +----------+

Error branch:
  UPLOADING --upload fails--> FAILED (per-file: status='failed')
  User can remove failed items individually.
```

### 3.2 Data Types (existing, unchanged)

```typescript
// Already defined in useAgentAttachmentDrafts.ts
export interface AgentAttachmentDraft {
  id: string;
  name: string;
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'failed';
  attachment?: ChatAttachmentInput;
}
```

### 3.3 Upload Path

```
User action (file input onChange / drop)
  → useAgentAttachmentDrafts.addFiles(files)
    → For each file:
        1. Create draft { id, name, previewUrl (blob URL for images), status: 'uploading' }
        2. Call uploadAgentAttachmentFile({ conversationId }, file)
        3. On success: update draft → status: 'ready', populate attachment field
        4. On failure: update draft → status: 'failed'
  → UI: AttachmentStage renders drafts with remove button + loading indicator
```

### 3.4 Integration with Send

At send time:

```typescript
const readyAttachments: ChatAttachmentInput[] = drafts
  .filter(d => d.status === 'ready' && d.attachment)
  .map(d => d.attachment!);

// Convert to ChatComposerAttachment[] for useChatStore.sendMessage
const composerAttachments: ChatComposerAttachment[] = readyAttachments.map(att => ({
  cid: att.cid,
  filename: att.filename,
  mime_type: att.mime_type,
  size: att.size,
  attachment: att,
}));

sendMessage(inputText, composerAttachments);
clearDrafts();
```

### 3.5 Constraints

- Send button is **disabled** while any draft has `status === 'uploading'`.
- Send button is **disabled** when `inputText.trim() === '' && readyAttachments.length === 0`.
- Failed uploads remain visible; user removes them manually or retries (P1: retry).
- Preview URL (`URL.createObjectURL`) is revoked on draft removal or clear.

---

## 4. Integration with Existing Send Flow

### 4.1 Current Contract

```typescript
// store/chat.ts line 414
sendMessage: (content: string, attachments?: ChatComposerAttachment[]) => void;
```

The composer calls this with:
- `content`: trimmed textarea value
- `attachments`: array from the attachment staging (see section 3.4)

### 4.2 Operation Tracking (store/streaming/)

`sendMessage` internally:
1. Creates a `user` ChatMessage with content + attachments.
2. Creates an `assistant` placeholder message.
3. Creates an Operation via `createOperation({ type: 'sendMessage', ... })`.
4. Starts SSE stream via `streamAgentCollaborationEvents`.
5. Reduces stream events through `reduceStreamEvent`.

The composer does **not** manage operations. It only:
- Reads `isStreaming` to show stop button.
- Calls `stopStreaming()` when user clicks stop.

### 4.3 Post-Send Reset

After `sendMessage` is called:
1. `setInput('')` — clear textarea.
2. `clearDrafts()` — clear all attachment drafts, revoke preview URLs.
3. Reset textarea height to default.
4. Draft for current session key is cleared from `topicDraftRef`.

### 4.4 Model Selection Flow

The composer reads `useAgentStore` for:
- `selectedModel` / `defaultModel` — determines which model shows in picker
- `availableModels` — populates the dropdown
- `setSelectedModel(modelId, providerId)` — user selects a different model

This is **read-only** from the composer's perspective (no ownership change needed). The `sendMessage` action in `store/chat.ts` resolves the effective model from `useAgentStore.getState()` at call time.

---

## 5. ADR Decisions

### ADR-ChatInput-01: Plain Textarea over Lexical for P0

**Context:** LobeHub uses Lexical for rich editing (mentions, action tags, slash menus). Lexical adds ~80KB and significant complexity.

**Decision:** Keep native `<textarea>` for P0. The registry pattern and file staging work identically regardless of editor implementation. Lexical upgrade (P1) only changes `ComposerTextarea` internals.

**Consequence:** No structured editor data (`editorData`/JSON serialization) sent with messages. Messages are pure text + attachments.

### ADR-ChatInput-02: ActionBar as Registry, Not Hardcoded

**Context:** Current implementation has two hardcoded `ActionIcon` elements. Adding/removing actions requires editing the monolithic component.

**Decision:** `ActionBar` renders from an array of `ActionBarItem` objects. Default items provided by `registry.ts`. Parent can override via props.

**Consequence:** Adding new actions (e.g., web search, knowledge base) requires only adding an entry to the registry or passing it via props. Zero changes to existing components.

### ADR-ChatInput-03: Attachment Hook Remains a Hook (Not Global Store)

**Context:** LobeHub uses a global `FileStore`. Our `useAgentAttachmentDrafts` is per-component.

**Decision:** Keep the hook-based approach. Rationale:
- We have a single composer instance (no multi-panel yet).
- The hook already handles the full lifecycle correctly.
- Moving to a global store is a P1 concern when we need multi-panel.

**Consequence:** Attachment state resets on component unmount. Draft persistence across navigation is handled by the `conversationId`-keyed effect.

### ADR-ChatInput-04: Model Picker is Part of Composer, Not ActionBar

**Context:** The model picker visually sits in the footer but is not a simple action button — it's a complex dropdown with search.

**Decision:** `ModelPicker` is a standalone component in `ComposerFooter`, not an `ActionBarItem`. It occupies the space between left actions and send button.

**Consequence:** Model picker rendering and state management are isolated. If we later want it configurable per-context, we can still hide/show it via a prop.

---

## 6. Migration Path

### Phase 1 (P0 — this batch)

1. Extract `ChatComposer.tsx` from `ChatInput.tsx` using new directory structure.
2. Extract `AttachmentStage`, `ComposerTextarea`, `ComposerFooter`, `SendControl`, `ModelPicker`.
3. Implement `ActionBar` with registry; move slash/file-upload to registry items.
4. Move `useAgentAttachmentDrafts.ts` into `composer/`.
5. Delete old `ChatInput.tsx`; update all imports.
6. Wire up: textarea → send → attachment → same behavior as today, just decomposed.

### Phase 2 (P1 — future)

- Replace `ComposerTextarea` with Lexical-based `ComposerEditor`.
- Add draft persistence (localStorage keyed by sessionKey).
- Add retry for failed uploads.
- Add drag-and-drop file support.
- Add new ActionBar items: search, knowledge, tools.

### Phase 3 (P2 — future)

- Command bus (slash commands with side-effects).
- @mention system.
- AI autocomplete.
- Input history recall.

---

## 7. Dependency Map

```
ChatComposer
├── store/chat.ts         → sendMessage, stopStreaming, isStreaming, currentSessionKey
├── store/agent.ts        → selectedModel, availableModels, setSelectedModel
├── store/streaming/      → Operation types (read-only for isStreaming derivation)
├── services/agentAttachments.ts → uploadAgentAttachmentFile
├── services/desktop_api  → ChatAttachmentInput type
├── i18n                  → t() for all UI strings
└── @lobehub/ui           → ActionIcon
    react-layout-kit      → Flexbox
    antd                  → Dropdown, Input, theme
    lucide-react          → Icons
```

No new external dependencies introduced for P0.

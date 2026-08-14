# Module 3: Chat Input & Composer — LobeHub Reference Implementation Analysis

> Step 1b of Architecture Design Methodology  
> Source: `external/lobehub/src/features/ChatInput/`  
> Date: 2026-08-12

---

## 1. Data Flow Diagram

```
User Input
    |
    v
+-------------------+    onChange()     +----------------------+
| InputEditor       |----------------->| ChatInput Store      |
| (@lobehub/editor  |                  | (zustand per-input)  |
|  Lexical-based)   |                  |                      |
|                   |   getMarkdown()  | - editor: IEditor    |
|  - Rich plugins   |<-----------------| - markdownContent    |
|  - Mention menu   |                  | - isContentEmpty     |
|  - Slash commands  |                  | - expand             |
|  - ActionTag nodes |                  | - inputCompletion*   |
|  - AutoComplete    |                  +----------+-----------+
+-------------------+                             |
    |                                             | handleSendButton()
    | paste/drop                                  v
    v                                  +----------+-----------+
+-------------------+                  | onSend callback      |
| File Upload       |                  | (injected by parent) |
| (useFileStore)    |                  +----------+-----------+
|                   |                             |
| - chatUploadFile  |                             v
|   List (staging)  |                  +----------+-----------+
| - chatContext     |                  | ConversationLifecycle|
|   Selections      |                  | (ChatStore slice)    |
| - uploadWith      |                  |                      |
|   Progress        |                  | sendMessage({        |
+-------------------+                  |   message,           |
    |                                  |   editorData,        |
    | files[]                          |   files,             |
    +--------------------------------->|   context,           |
                                       |   contextSelections, |
                                       |   metadata,          |
                                       | })                   |
                                       +----------+-----------+
                                                  |
                                       +---------+-----------+
                                       | Runtime Selection   |
                                       | client | gateway |  |
                                       | hetero             |
                                       +--------------------+
```

**Flow summary:**

1. User types in Lexical-based `Editor` component (via `@lobehub/editor`)
2. `onChange` fires `updateMarkdownContent()` on the per-input zustand store
3. Draft auto-saves every 500ms via `useChatInputDraft`
4. On Enter/click Send: `handleSendButton()` serializes editor to markdown + JSON
5. Calls the `onSend` callback which wraps `ConversationLifecycleActionImpl.sendMessage()`
6. `sendMessage` collects: editorData, file IDs from FileStore, contextSelections, command bus overrides
7. Dispatches to appropriate runtime (client/gateway/heterogeneous)

---

## 2. State Machine

```
                    +-----------+
                    |   EMPTY   |
                    | (initial) |
                    +-----+-----+
                          |
              user types  |  editor.onChange()
                          v
                    +-----+-----+
            +------>|  TYPING   |<------+
            |       +-----------+       |
            |            |              |
            |  remove    | add files    | remove all files
            |  text      v              |
            |       +----+------+       |
            |       | HAS_ATTACH|-------+
            |       +-----------+
            |            |
            +------------+ (both: typing + attachments)
                         |
          Enter / click  |  handleSendButton()
                         v
                   +-----+-----+
                   |  SENDING  |
                   +-----------+
                         |
                   success / error
                         v
                   +-----+-----+
                   |   EMPTY   |  (editor cleared, drafts removed)
                   +-----------+

   Independent overlay states:
   - DISABLED: canCreate=false OR canUseResource=false OR sendButtonProps.disabled
   - GENERATING: sendButtonProps.generating=true (shows stop button)
   - EXPANDED: expand=true (fullscreen editor mode)
   - INPUT_COMPLETION_PAUSED: inputCompletionError != undefined
```

**State holders:**

| State | Owner | Signal |
|-------|-------|--------|
| Content empty/non-empty | `useEditorState(editor).isEmpty` | Lexical state |
| Has attachments | `fileChatSelectors.chatUploadFileListHasItem` | FileStore |
| Is generating | `sendButtonProps.generating` | ChatStore operation |
| Is disabled | `sendButtonProps.disabled` OR permission checks | Multiple |
| Is expanded | `ChatInput store.expand` | Local store |

---

## 3. Architecture Mapping Table

| LobeHub Component | Path | Peers-Touch Equivalent | Gap |
|---|---|---|---|
| **ChatInputProvider** | `features/ChatInput/ChatInputProvider.tsx` | N/A | No provider pattern; all state in component |
| **ChatInput store** (zustand) | `features/ChatInput/store/` | `useState` local + `useChatStore` | No dedicated input store |
| **InputEditor** (Lexical) | `features/ChatInput/InputEditor/index.tsx` | `<textarea>` in `ChatInput.tsx` | No rich editor, no plugins |
| **ActionBar** (16 actions) | `features/ChatInput/ActionBar/` | 2 icons (Slash, Image) | Missing: Memory, Search, Tools, Params, Model, etc. |
| **ControlBar** | `features/ChatInput/ControlBar/` | Model dropdown inline | Missing: ModeSelector, WorkspaceControls, ApprovalMode |
| **SendArea** | `features/ChatInput/SendArea/` | Inline send/stop button | Missing: ExpandButton, context actions |
| **SendButton** | `features/ChatInput/SendArea/SendButton.tsx` | ActionIcon with ArrowUp | Missing: permission gating, menu |
| **DesktopChatInput** | `features/ChatInput/Desktop/index.tsx` | `ChatInput.tsx` (monolithic) | No resize, no fullscreen, no drag-drop |
| **ContextContainer** | `Desktop/ContextContainer/` | Attachment preview inline | No context selections, no file preview modal |
| **FileStore.chatUploadFileList** | `store/file/slices/chat/` | `useAgentAttachmentDrafts` | Simpler; no S3 upload, no RAG parsing |
| **FileStore.uploadWithProgress** | `store/file/slices/upload/` | Direct Tauri command | No hash dedup, no progress tracking |
| **ConversationLifecycle.sendMessage** | `store/chat/slices/agentRun/actions/entries/` | `useChatStore.sendMessage()` | No operation tracking, no command bus, no queue |
| **Command Bus** | `entries/commandBus/` | N/A | No slash commands as editor nodes |
| **MentionMenu** (@ agents/topics/files) | `InputEditor/MentionMenu/` | N/A | No mention system |
| **ActionTag** (/ commands) | `InputEditor/ActionTag/` | `insertSlash()` appends "/" | No slash-command UI; just text insertion |
| **ReferTopic** | `InputEditor/ReferTopic/` | N/A | No topic reference |
| **LocalFileTag** | `InputEditor/LocalFileTag/` | N/A | No local file references in editor |
| **Input completion** (AI autocomplete) | `InputEditor` + `ReactAutoCompletePlugin` | N/A | No AI input completion |
| **Draft storage** | `draftStorage.ts` + `useChatInputDraft` | `topicDraftRef` (in-memory) | No persistence across sessions |
| **Input history** | `inputHistoryStorage.ts` + `useChatInputHistory` | N/A | No input history recall |
| **TypoBar** | `features/ChatInput/TypoBar/` | N/A | No typo correction |

---

## 4. Key Function Signatures

### 4.1 ChatInput Store — Actions

```typescript
// features/ChatInput/store/action.ts
export interface Action {
  clearInputCompletionError: () => void;
  dismissInputCompletionError: () => void;
  getJSONState: () => Record<string, any> | undefined;
  getMarkdownContent: () => string;
  handleSendButton: () => void;
  handleStop: () => void;
  pauseInputCompletion: (error: State['inputCompletionError']) => void;
  setDocument: (type: string, content: any, options?: Record<string, unknown>) => void;
  setExpand: (expand: boolean) => void;
  setJSONState: (content: any) => void;
  setShowTypoBar: (show: boolean) => void;
  updateMarkdownContent: () => void;
}
```

### 4.2 ChatInput Store — State

```typescript
// features/ChatInput/store/initialState.ts
export type SendButtonHandler = (params: {
  clearContent: () => void;
  editor: IEditor;
  getEditorData: () => Record<string, any> | undefined;
  getMarkdownContent: () => string;
}) => Promise<void> | void;

export interface SendButtonProps {
  disabled?: boolean;
  generating: boolean;
  onStop: (params: { editor: IEditor }) => void;
  shape?: 'round' | 'default';
  size?: number;
}

export interface ChatInputFeature {
  inputCompletion?: boolean;
  inputHistory?: boolean;
  mention?: boolean;
  slash?: boolean;
}

export interface PublicState {
  agentId?: string;
  allowExpand?: boolean;
  contextWindowMessages?: ContextWindowMessage[];
  draftKey?: string;
  expand?: boolean;
  feature?: ChatInputFeature;
  getMessages?: () => OpenAIChatMessage[];
  leftActions: ActionKeys[];
  mentionItems?: SlashOptions['items'];
  mobile?: boolean;
  onMarkdownContentChange?: (content: string) => void;
  onSend?: SendButtonHandler;
  rightActions: ActionKeys[];
  sendButtonProps?: SendButtonProps;
  sendMenu?: MenuProps;
  showTypoBar?: boolean;
  slashPlacement?: SlashPlacement;
}

export interface State extends PublicState {
  _savedEditorState?: Record<string, any>;
  editor?: IEditor;
  inputCompletionError?: InputCompletionError;
  inputCompletionErrorDismissed: boolean;
  isContentEmpty: boolean;
  markdownContent: string;
  slashMenuRef: ChatInputProps['slashMenuRef'];
}
```

### 4.3 ChatInputEditor Hook (Public API)

```typescript
// features/ChatInput/hooks/useChatInputEditor.ts
export interface ChatInputEditor {
  clearContent: () => void;
  focus: () => void;
  getJSONState: () => any;
  getMarkdownContent: () => string;
  instance: IEditor;
  setDocument: (type: string, content: any, options?: Record<string, unknown>) => void;
  setExpand: (expand: boolean) => void;
  setJSONState: (content: any) => void;
}
```

### 4.4 File Upload — Chat Slice

```typescript
// store/file/slices/chat/action.ts
class FileActionImpl {
  addChatContextSelection(context: ChatContextContent): void;
  clearChatContextSelections(): void;
  clearChatUploadFileList(): void;
  dispatchChatUploadFileList(payload: UploadFileListDispatch): void;
  removeChatContextSelection(id: string): void;
  removeChatUploadFile(id: string): Promise<void>;
  uploadChatFiles(rawFiles: File[], agentId: string): Promise<void>;
  startAsyncTask(id: string, runner: (id: string) => Promise<string>,
    onFileItemUpdate: (fileItem: FileListItem) => void): Promise<void>;
}
```

### 4.5 File Upload — Upload Slice

```typescript
// store/file/slices/upload/action.ts
class FileUploadActionImpl {
  uploadWithProgress(params: {
    file: File;
    onStatusUpdate?: OnStatusUpdate;
    knowledgeBaseId?: string;
    skipCheckFileType?: boolean;
    parentId?: string;
    source?: string;
    uploadId?: string;
    abortController?: AbortController;
    visibility?: 'private' | 'public';
  }): Promise<{ id: string; url: string; dimensions?: {...}; filename?: string } | undefined>;

  uploadBase64FileWithProgress(base64: string):
    Promise<{ id: string; url: string; dimensions?: {...}; filename?: string } | undefined>;
}
```

### 4.6 SendMessage — Entry Point

```typescript
// store/chat/slices/agentRun/actions/entries/conversationLifecycle.ts
export interface SendMessageWithContextParams extends SendMessageParams {
  context: ConversationContext;
  inputEditor?: ChatInputEditor | null;
  onTopicCreated?: (topicId: string) => void | Promise<void>;
}

// From @lobechat/types (SendMessageParams)
interface SendMessageParams {
  message: string;
  editorData?: Record<string, any>;
  files?: UploadFileItem[];
  forceRuntime?: string;
  metadata?: MessageMetadata;
  onlyAddUserMessage?: boolean;
  contextSelections?: ChatContextContent[];
  messages?: UIChatMessage[];
  parentId?: string;
  pageSelections?: any[];
}
```

### 4.7 Command Bus

```typescript
// store/chat/slices/agentRun/actions/entries/commandBus/types.ts
export interface CommandSendOverrides {
  forceNewTopic?: boolean;
  triggerCompression?: boolean;
}

export type CommandHandler = (ctx: CommandHandlerContext) => CommandSendOverrides | void;
export type CommandRegistry = Record<CommandType, CommandHandler>;
```

### 4.8 ActionBar Config

```typescript
// features/ChatInput/ActionBar/config.ts
export const actionMap = {
  agentMode: AgentMode,
  clear: Clear,
  contextWindow: ContextWindow,
  fileUpload: Upload,
  plus: Plus,
  history: History,
  memory: Memory,
  mention: Mention,
  model: Model,
  modelLabel: ModelLabel,
  params: Params,
  promptTransform: PromptTransform,
  search: Search,
  temperature: Params,
  tools: Tools,
  typo: Typo,
} as const;

export type ActionKey = keyof typeof actionMap;
export type ActionKeys = ActionKey | ActionKey[] | '---';
```

---

## 5. Key Architectural Patterns

### 5.1 Per-Instance Store via React Context

LobeHub creates a **fresh zustand store per ChatInput mount**, wrapped in `ChatInputProvider`. This enables:
- Multiple simultaneous inputs (main chat, thread panels, embedded conversations)
- Each with independent editor state, send handlers, and feature flags
- The parent conversation configures `leftActions`, `rightActions`, `onSend`, `sendButtonProps`

### 5.2 Editor as a First-Class Entity

The editor is `@lobehub/editor` (Lexical-based) with:
- Rich text plugins (mention nodes, action tag nodes, local file tag nodes, refer-topic nodes)
- Dual serialization: JSON (for persistence/restore) + Markdown (for LLM consumption)
- Plugin-based extensibility (AutoComplete, SlashMenu, MentionMenu)
- Custom commands (`INSERT_ACTION_TAG_COMMAND`, `INSERT_REFER_TOPIC_COMMAND`, etc.)

### 5.3 Command Bus Pattern

Slash commands (`/newTopic`, `/compact`) are parsed from `editorData` by `processCommands()` in the send path. They produce `CommandSendOverrides` that alter the send behavior without touching the editor logic.

### 5.4 File Upload as Separate Store

Files are managed in a global `FileStore` (not per-input). The input reads `fileChatSelectors` to know if files exist. Upload lifecycle: `addFiles` -> `uploadWithProgress` (hash dedup + S3) -> `dispatchChatUploadFileList` status updates -> consumed at send time.

### 5.5 Configurable Action System

Actions (left/right bars) are declared as `ActionKeys[]` in the store state. Each key maps to a component via `actionMap`. This makes the toolbar entirely data-driven and reconfigurable per conversation type.

---

## 6. Gaps Analysis for Peers-Touch

| Priority | Gap | Impact |
|----------|-----|--------|
| P0 | No rich editor — plain textarea cannot support mentions, slash commands, or structured editor data | Blocks agent-management delegation, tool selection, topic references |
| P0 | No per-input store — single monolithic component cannot host multiple conversation panels | Blocks thread/portal architecture |
| P1 | No file upload lifecycle — no progress, no dedup, no RAG parsing | Limits multimodal capability |
| P1 | No configurable action bar — actions are hardcoded | Cannot adapt per-agent or per-context |
| P1 | No command bus — no way to add slash commands without modifying core send logic | Limits extensibility |
| P2 | No draft persistence — only in-memory per topic | Loses user work on refresh |
| P2 | No input history — no recall of previous messages | Missing productivity feature |
| P2 | No AI autocomplete | Missing AI-native experience |
| P3 | No context selections / page selections | Blocks knowledge-augmented chat |
| P3 | No workspace/permission gating | Blocks multi-user scenarios |

# Module 3: Chat Input & Composer — Acceptance Scenarios

> Every state transition in the Chat Composer must be covered by at least one scenario below.  
> Format: Given / When / Then with explicit state assertions.  
> Date: 2026-08-12

---

## 1. Basic Text Input

### SC-01: Empty state — send disabled

```
GIVEN  composer mounts with no prior draft
WHEN   no user action
THEN   inputText === ''
AND    send button is disabled (visual: muted color, cursor: default)
AND    textarea shows placeholder from i18n key 'chat.input.placeholder'
```

### SC-02: Typing enables send

```
GIVEN  inputText === ''
WHEN   user types "Hello"
THEN   inputText === 'Hello'
AND    send button becomes enabled (visual: primary color, cursor: pointer)
AND    textarea auto-resizes to content height (up to 190px max)
```

### SC-03: Enter sends message

```
GIVEN  inputText === 'Hello' AND isStreaming === false AND uploading === false
WHEN   user presses Enter (without Shift, without IME composing)
THEN   sendMessage('Hello', []) is called on useChatStore
AND    inputText resets to ''
AND    textarea height resets to default
AND    send button returns to disabled state
```

### SC-04: Shift+Enter inserts newline

```
GIVEN  inputText === 'Line 1'
WHEN   user presses Shift+Enter
THEN   inputText === 'Line 1\n' (newline inserted, no send)
AND    textarea auto-resizes
```

### SC-05: IME composition does not trigger send

```
GIVEN  user is composing CJK input (isComposing === true)
WHEN   Enter key fires (keyCode 229 or isComposing true)
THEN   no send occurs
AND    composition continues normally
```

---

## 2. Draft Preservation

### SC-06: Session switch saves draft

```
GIVEN  currentSessionKey === 'conv-A' AND inputText === 'draft text'
WHEN   currentSessionKey changes to 'conv-B'
THEN   topicDraftRef['conv-A'] === 'draft text'
AND    inputText loads topicDraftRef['conv-B'] (or '' if absent)
```

### SC-07: Return to session restores draft

```
GIVEN  topicDraftRef['conv-A'] === 'draft text'
WHEN   currentSessionKey changes back to 'conv-A'
THEN   inputText === 'draft text'
```

---

## 3. File Attachment Staging

### SC-08: File upload — happy path

```
GIVEN  no files staged (drafts.length === 0)
WHEN   user clicks file upload action and selects 2 image files
THEN   drafts.length === 2
AND    each draft.status === 'uploading'
AND    each image draft has previewUrl (blob URL)
AND    send button is disabled (uploading === true)
WHEN   both uploads complete successfully
THEN   each draft.status === 'ready'
AND    each draft.attachment is populated with ChatAttachmentInput
AND    send button becomes enabled (inputText empty but readyAttachments.length > 0)
```

### SC-09: File upload — failure

```
GIVEN  user selects 1 file
WHEN   upload fails (network error / server error)
THEN   draft.status === 'failed'
AND    draft remains visible with failed indicator
AND    send button: disabled if no ready attachments and no text
```

### SC-10: Remove staged file

```
GIVEN  drafts contains [{ id: 'a', status: 'ready', previewUrl: 'blob:...' }]
WHEN   user clicks remove on draft 'a'
THEN   drafts === []
AND    URL.revokeObjectURL was called for 'blob:...'
AND    send button re-evaluates (disabled if no text and no other attachments)
```

### SC-11: Send with attachments clears staging

```
GIVEN  inputText === 'Check this' AND drafts has 1 ready attachment
WHEN   user sends
THEN   sendMessage('Check this', [composerAttachment]) is called
AND    inputText === ''
AND    drafts === [] (clearDrafts invoked)
AND    all preview URLs revoked
```

### SC-12: Cannot send while uploading

```
GIVEN  inputText === 'msg' AND drafts has 1 item with status === 'uploading'
WHEN   user presses Enter
THEN   no send occurs (early return: uploading === true)
```

### SC-13: Session change clears drafts

```
GIVEN  drafts.length === 2 (for currentSessionKey 'conv-A')
WHEN   currentSessionKey changes to 'conv-B'
THEN   drafts === [] (cleared by conversationId effect in hook)
AND    preview URLs revoked
```

---

## 4. Streaming / Stop Control

### SC-14: Streaming shows stop button

```
GIVEN  isStreaming === true
WHEN   composer renders
THEN   send button is replaced by stop button (Square icon, error color)
AND    textarea remains editable (user can type next message)
```

### SC-15: Stop streaming

```
GIVEN  isStreaming === true
WHEN   user clicks stop button
THEN   stopStreaming() is called on useChatStore
```

### SC-16: Cannot send during streaming

```
GIVEN  isStreaming === true AND inputText === 'next question'
WHEN   user presses Enter
THEN   no send occurs (early return: isStreaming === true)
```

---

## 5. Model Picker

### SC-17: Model picker shows current model

```
GIVEN  selectedModel === 'gpt-4o' in useAgentStore
WHEN   composer renders
THEN   model picker button displays 'GPT-4o' (display_name) with provider icon
```

### SC-18: Model selection updates store

```
GIVEN  model dropdown is open
WHEN   user clicks on 'Claude 3.5 Sonnet' entry
THEN   setSelectedModel('claude-3-5-sonnet', 'anthropic') is called
AND    dropdown closes
AND    model picker button updates to new model
```

### SC-19: Model search filters list

```
GIVEN  model dropdown is open with 10 models
WHEN   user types 'gpt' in search input
THEN   only models whose display_name or provider contains 'gpt' are shown
```

### SC-20: Model resolves at send time

```
GIVEN  user selected model 'gpt-4o' via picker
WHEN   user sends a message
THEN   store/chat.ts sendMessage reads useAgentStore.getState().selectedModel === 'gpt-4o'
AND    the operation uses that model for the streaming request
```

---

## 6. ActionBar Registry

### SC-21: Default actions render

```
GIVEN  no custom actions passed via props
WHEN   composer mounts
THEN   ActionBar renders exactly 2 items: slash (Slash icon) and fileUpload (Image icon)
AND    items have tooltips from i18n keys
```

### SC-22: Custom action integration

```
GIVEN  parent passes leftActions=[...defaultLeftActions, { key:'search', icon: Search, ... }]
WHEN   composer mounts
THEN   ActionBar renders 3 items in order: slash, fileUpload, search
```

### SC-23: Slash action inserts text

```
GIVEN  inputText === 'hello '
WHEN   user clicks slash action button
THEN   inputText === 'hello /' (appended)
AND    textarea receives focus
```

### SC-24: File upload action triggers input

```
GIVEN  hidden file input exists in DOM
WHEN   user clicks file upload action button
THEN   fileInputRef.current.click() is called
AND    file picker dialog opens
```

### SC-25: Action visibility condition

```
GIVEN  action has visible: (ctx) => !ctx.isStreaming
WHEN   isStreaming === true
THEN   that action button is not rendered
WHEN   isStreaming === false
THEN   that action button appears
```

---

## 7. Keyboard & Accessibility

### SC-26: Tab order

```
GIVEN  composer is focused
WHEN   user presses Tab
THEN   focus moves: textarea → action buttons (left to right) → model picker → send button
```

### SC-27: Textarea max height with scroll

```
GIVEN  user pastes multi-line text exceeding 190px computed height
WHEN   textarea auto-resizes
THEN   textarea.style.height === '190px' (clamped)
AND    textarea shows vertical scrollbar
```

---

## 8. Error States

### SC-28: All uploads failed — send only text

```
GIVEN  inputText === 'help' AND drafts has 2 items both status === 'failed'
WHEN   user presses Enter
THEN   sendMessage('help', []) is called (failed attachments excluded)
AND    failed drafts remain visible (not auto-cleared on send)
```

> Note: This is a design decision — failed items are NOT auto-cleared on send.
> User explicitly removes them or they persist as visual feedback.

### SC-29: Mixed ready + failed — send ready only

```
GIVEN  inputText === '' AND drafts = [{ status:'ready', att:A }, { status:'failed' }]
WHEN   user presses Enter
THEN   sendMessage('', [composerAttachment(A)]) is called
AND    ready draft is cleared; failed draft remains
```

---

## 9. Component Extraction Correctness

### SC-30: ChatComposer replaces ChatInput with identical behavior

```
GIVEN  ChatInput.tsx is deleted and ChatComposer.tsx is used everywhere
WHEN   user performs any interaction previously possible
THEN   behavior is identical to pre-refactor (no regressions)
```

### SC-31: No console.log or debug statements

```
GIVEN  full source of composer/ directory
WHEN   grep for console.log, print, debugPrint
THEN   zero matches (only domain logger allowed)
```

### SC-32: All UI strings use i18n

```
GIVEN  full source of composer/ directory
WHEN   grep for hardcoded Chinese/English user-facing literals
THEN   zero matches (all text via t() from useTranslation)
```

---

## 10. Verification Matrix

| Scenario | State Transition | Store Touched | Component |
|----------|-----------------|---------------|-----------|
| SC-01 | mount → EMPTY | — | SendControl |
| SC-02 | EMPTY → TYPING | local useState | ComposerTextarea, SendControl |
| SC-03 | TYPING → SENT → EMPTY | useChatStore | ChatComposer |
| SC-04 | TYPING → TYPING (newline) | local useState | ComposerTextarea |
| SC-05 | COMPOSING → COMPOSING | — | ComposerTextarea |
| SC-06 | SESSION_A → SESSION_B | local ref | ChatComposer |
| SC-07 | SESSION_B → SESSION_A | local ref | ChatComposer |
| SC-08 | IDLE → UPLOADING → READY | hook state | AttachmentStage |
| SC-09 | UPLOADING → FAILED | hook state | AttachmentStage |
| SC-10 | READY → REMOVED | hook state | AttachmentStage |
| SC-11 | READY → SENT → CLEARED | useChatStore + hook | ChatComposer |
| SC-12 | UPLOADING → blocked send | — | SendControl |
| SC-13 | SESSION_CHANGE → CLEARED | hook state | AttachmentStage |
| SC-14 | STREAMING → show stop | useChatStore | SendControl |
| SC-15 | STREAMING → CANCELLED | useChatStore | SendControl |
| SC-16 | STREAMING → blocked send | — | SendControl |
| SC-17 | mount → model shown | useAgentStore | ModelPicker |
| SC-18 | SELECT → store update | useAgentStore | ModelPicker |
| SC-19 | SEARCH → filtered | local state | ModelPicker |
| SC-20 | SEND → model resolved | useAgentStore (read) | — |
| SC-21 | mount → default items | registry | ActionBar |
| SC-22 | mount → custom items | props | ActionBar |
| SC-23 | CLICK → text inserted | local useState | ActionBar, ComposerTextarea |
| SC-24 | CLICK → file dialog | DOM ref | ActionBar |
| SC-25 | streaming → hide action | useChatStore | ActionBar |

# Module 2: Message & Actions — Acceptance Scenarios

> **Module**: P0-M2 Message & Actions
> **Step**: S2 (acceptance definition)
> **Coverage**: Every action + every message state transition

---

## Core Action Scenarios

### AS-01: Copy assistant message
- **Precondition**: Conversation has a completed assistant message
- **Action**: User clicks copy button on assistant message
- **Expected**: Content copied to clipboard, toast confirmation shown
- **Failure variant**: Empty message → copy button disabled or copies empty string gracefully
- **Evidence**: `navigator.clipboard.readText()` matches message content
- **Status**: pending

### AS-02: Copy user message
- **Precondition**: Conversation has a user message
- **Action**: User clicks copy from message action menu
- **Expected**: User message text copied to clipboard
- **Evidence**: Clipboard content matches
- **Status**: pending

### AS-03: Edit user message
- **Precondition**: Conversation has a user message (not streaming)
- **Action**: User clicks edit, modifies text, saves
- **Expected**: Message content updates in UI immediately, persists to server
- **Failure variant**: Save fails → error toast, content reverts
- **Evidence**: Message content in DOM matches new text; BFF query confirms persistence
- **Status**: pending

### AS-04: Delete message
- **Precondition**: Conversation has messages (not streaming)
- **Action**: User clicks delete on a message
- **Expected**: Message removed from list immediately
- **Failure variant**: Server delete fails → message still removed from UI (optimistic)
- **Evidence**: Message no longer in DOM; messages array length decreased
- **Status**: pending

### AS-05: Regenerate assistant message
- **Precondition**: Completed assistant message exists, not currently streaming
- **Action**: User clicks regenerate
- **Expected**: Old assistant message marked as replaced, new streaming message appears
- **Failure variant**: Stream errors → new message shows error state with retry option
- **Evidence**: New message ID appears with `loading: true` then transitions to content
- **Status**: pending

### AS-06: Retry failed message
- **Precondition**: Assistant message in error state
- **Action**: User clicks retry
- **Expected**: New streaming attempt with same prompt, error message replaced
- **Evidence**: Error message replaced by loading → content message
- **Status**: pending

### AS-07: Delete and regenerate
- **Precondition**: Completed assistant message exists
- **Action**: User clicks "delete and regenerate" from menu
- **Expected**: Old message deleted, new streaming response generated
- **Evidence**: Old message ID gone, new message streaming
- **Status**: pending

### AS-08: Branch from message
- **Precondition**: Conversation with multiple messages
- **Action**: User clicks branch from a user message
- **Expected**: New session/topic created with messages up to that point
- **Evidence**: New session key created, messages duplicated up to branch point
- **Status**: pending

### AS-09: Continue generation
- **Precondition**: Completed assistant message (non-error, non-streaming)
- **Action**: User clicks "continue" from menu
- **Expected**: New streaming response continuing from the assistant's last output
- **Evidence**: New assistant message appears and streams content
- **Status**: pending

---

## Message State Scenarios

### AS-10: Streaming message shows loading state
- **Precondition**: User sends a message
- **Action**: Observe assistant message during streaming
- **Expected**: Message shows loading indicator, content accumulates character by character
- **Evidence**: `message.loading === true` during stream, content grows
- **Status**: pending

### AS-11: Thinking block renders during reasoning
- **Precondition**: Model that emits thinking events (e.g. o1/DeepSeek)
- **Action**: Send message, observe thinking phase
- **Expected**: Collapsible thinking block appears above main content, auto-expands during stream, collapsible after done
- **Evidence**: Thinking block DOM element present with content; collapses on click
- **Status**: pending

### AS-12: Tool call card renders during execution
- **Precondition**: Agent with tools enabled
- **Action**: Send message that triggers a tool call
- **Expected**: Tool call card appears showing tool name, arguments, pending status; after result shows success/error
- **Evidence**: Tool call card DOM with name + args + status badge
- **Status**: pending

### AS-13: Error state shows retry action
- **Precondition**: Stream errors (provider failure)
- **Action**: Observe assistant message after error
- **Expected**: Message shows error text + retry button as primary action; no other actions shown
- **Evidence**: Error text visible, retry button present, regenerate visible
- **Status**: pending

### AS-14: Action bar hidden during streaming
- **Precondition**: Message is currently streaming
- **Action**: Hover over streaming message
- **Expected**: No action bar appears (actions meaningless during stream)
- **Evidence**: No action bar DOM elements on hover
- **Status**: pending

### AS-15: Action bar shows on hover for completed messages
- **Precondition**: Completed assistant or user message
- **Action**: Hover over message
- **Expected**: Action bar appears with role-appropriate actions
- **Evidence**: Action bar DOM visible with correct buttons
- **Status**: pending

---

## Component Decomposition Scenarios

### AS-16: MessageBubble dispatches by role
- **Precondition**: Messages of different roles (user, assistant, system) exist
- **Action**: Render message list
- **Expected**: Each role renders with its appropriate component (different visual treatment)
- **Evidence**: Assistant messages show avatar + markdown + actions; user messages show right-aligned + edit capability
- **Status**: pending

### AS-17: Knowledge chunks display
- **Precondition**: Agent with knowledge base, stream emits knowledge_retrieved progress
- **Action**: Send message that triggers RAG
- **Expected**: Knowledge sources shown as chips/cards below thinking block
- **Evidence**: Knowledge chunk elements visible with resource titles
- **Status**: pending

---

## Coverage Matrix

| State Transition | Scenario(s) |
|-----------------|-------------|
| idle → streaming | AS-10 |
| streaming → done | AS-10, AS-15 |
| streaming → error | AS-13 |
| done → editing | AS-03 |
| done → regenerating | AS-05 |
| error → retry | AS-06 |
| done → branched | AS-08 |
| done → continue | AS-09 |
| done → deleted | AS-04 |
| thinking active | AS-11 |
| tool calling | AS-12 |
| hover → actions visible | AS-15 |
| streaming → actions hidden | AS-14 |

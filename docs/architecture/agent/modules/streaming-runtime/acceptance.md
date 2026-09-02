# Streaming Runtime — Acceptance Scenarios

> **Module**: P0-M1 Streaming Runtime
> **Derived from**: peers-design.md (Run Lifecycle State Machine, Section 5)
> **Status**: superseded by `docs/architecture/agent/modern-chat-agent/acceptance-matrix.md`
> **Historical note**: scenarios using `local_tool_request` or a Rust approval
> waiter are not valid MCA-D19 evidence.

---

## Coverage Matrix

Every state transition in the FSM (Section 5.3 of peers-design.md) is covered by at least one scenario below.

| Transition | Scenario(s) |
|---|---|
| idle → streaming | A1, A2, A3 |
| streaming → streaming (text) | A4 |
| streaming → streaming (thinking) | A5 |
| streaming → streaming (tool_call + tool_result) | A6 |
| streaming → streaming (progress) | A7 |
| streaming → approval_pending | A8 |
| streaming → completed | A9 |
| streaming → failed | A10, A11 |
| streaming → cancelled | A12 |
| approval_pending → streaming (approve) | A13 |
| approval_pending → streaming (deny) | A14 |
| approval_pending → cancelled | A15 |
| approval_pending → failed (timeout) | A16 |
| completed → idle (next send) | A17 |
| failed → idle (retry) | A18 |
| cancelled → idle (resend) | A19 |

---

## Scenarios

### A1: Send Message — New Conversation (Draft)

**Precondition**: Session is a draft (`draft:*` key), idle state.

**Steps**:
1. User sends a message.
2. Store creates optimistic user + assistant messages.
3. Operation starts with status `running`.
4. `streamAgentTurn()` is called.
5. Station responds with `conversation_created` event containing real `conversation_id`.
6. Draft session key is replaced with real conversation ID across operations, session list, and buffers.

**Acceptance**:
- `currentSessionKey` equals the real conversation ID.
- Session list no longer contains the draft key.
- Operation is keyed by the real conversation ID.
- Streaming continues normally after key replacement.

---

### A2: Send Message — Existing Conversation

**Precondition**: Session has a real key, idle state.

**Steps**:
1. User sends a message.
2. Operation starts.
3. Events stream through to completion.

**Acceptance**:
- No `conversation_created` event emitted.
- Messages accumulate correctly on the existing session.

---

### A3: Regenerate Message

**Precondition**: Existing conversation with a completed assistant message, idle state.

**Steps**:
1. User triggers regenerate on an assistant message.
2. New assistant message is created with `operation: 'regenerate'` and `replacementOf` pointing to the original.
3. Original message gets `replacedBy` set.
4. Operation starts with type `regenerate`.

**Acceptance**:
- Two assistant messages exist: original (with `replacedBy`) and replacement (with `replacementOf`).
- Only the replacement is loading/streaming.
- Operation type is `regenerate`.

---

### A4: Streaming — Text Accumulation

**Precondition**: Operation running, streaming state.

**Steps**:
1. Multiple `text` events arrive with incremental content.
2. Each event is reduced via `reduceStreamEvent()`.

**Acceptance**:
- `message.content` equals concatenation of all `text` event payloads.
- `message.loading` remains `true`.
- `lastEventAt` is updated on each event.
- UI re-renders with accumulated content (throttled).

---

### A5: Streaming — Thinking Accumulation

**Precondition**: Operation running.

**Steps**:
1. `thinking` events arrive with `content` and eventually `done: true`.

**Acceptance**:
- `message.thinking` accumulates all thinking content.
- `message.thinkingDone` is `false` until a `thinking` event with `done: true`.
- After `done: true`, `message.thinkingDone` is `true`.

---

### A6: Streaming — Tool Call and Result (No Approval)

**Precondition**: Operation running.

**Steps**:
1. `tool_call` event arrives with `{ id, name, args }`.
2. `tool_result` event arrives with `{ id, name, content }`.

**Acceptance**:
- After `tool_call`: `message.toolCalls` contains entry with `pending: true`, `status: 'pending'`.
- After `tool_result`: matching entry has `pending: false`, `status: 'success'`, `result` populated.
- Run state remains `streaming`.

---

### A7: Streaming — Progress Event

**Precondition**: Operation running.

**Steps**:
1. `progress` event with `stage: 'knowledge_retrieved'` and `result` JSON.

**Acceptance**:
- `message.knowledgeChunks` is populated from parsed result.
- If stage is not `knowledge_retrieved`, pending tool calls get `progress` and `progressPct` updated.

---

### A8: Streaming → Approval Pending

**Precondition**: Operation running, streaming state.

**Steps**:
1. Rust BFF receives `local_tool_request` from Station.
2. Rust emits `tool_approval_required` Tauri event.
3. TS store receives event.

**Acceptance**:
- Operation status transitions to `waiting_for_approval`.
- `pendingApprovalId` is set on the operation.
- `message.toolCalls` contains entry with `status: 'approval_required'` and `approvalId`.
- UI displays approval prompt.
- Stream is NOT closed (Rust BFF is blocking on condvar, Station SSE is still open).

---

### A9: Streaming → Completed (Done Event)

**Precondition**: Operation running.

**Steps**:
1. `done` event arrives with `{ model, task_id }`.

**Acceptance**:
- `message.loading` is `false`.
- `message.model` is set from event.
- `message.processDuration` is computed.
- All pending tool calls are finalized to `status: 'success'`.
- Operation status is `completed`.
- `syncMessages()` is triggered.
- Topic reconciliation runs.
- `isStreaming` is `false` for current session.

---

### A10: Streaming → Failed (Provider Error)

**Precondition**: Operation running.

**Steps**:
1. `error` event arrives with `{ error: "rate_limit_exceeded", detail, resolution, providerId }`.

**Acceptance**:
- `message.error` is set (user-friendly via `presentChatRuntimeError()`).
- `message.errorDetail` is set.
- `message.resolution` contains actionable `ErrorResolutionAction`.
- `message.loading` is `false`.
- All pending tool calls finalized to `status: 'error'`.
- Operation status is `failed`.

---

### A11: Streaming → Failed (Transport Error)

**Precondition**: Operation running.

**Steps**:
1. SSE connection drops or HTTP returns non-2xx.
2. Rust BFF emits resolved error via `emit_resolved_error()`.
3. `onError` callback fires in TS.

**Acceptance**:
- Same as A10 but error source is transport, not Station event.
- Error message is resolved through `presentChatRuntimeError()`.

---

### A12: Streaming → Cancelled (User Stop)

**Precondition**: Operation running.

**Steps**:
1. User clicks stop button.
2. `stopOperation(sessionKey)` is called.
3. AbortController is aborted.
4. `api.stopChat(sessionKey)` is called.

**Acceptance**:
- `message.loading` is `false`.
- All pending tool calls finalized to `status: 'cancelled'`.
- Operation status is `cancelled`.
- `isStreaming` is `false`.
- Rust BFF's `cancel_flag` is set, SSE read loop exits.

---

### A13: Approval Pending → Streaming (User Approves)

**Precondition**: Operation in `waiting_for_approval`, approval UI visible.

**Steps**:
1. User clicks "Approve".
2. `decideToolApproval(approvalId, true)` is called.
3. API call `api.decideAgentToolApproval()` sends decision to Rust.
4. Rust unblocks condvar, executes tool, submits result to Station.
5. Station continues agent loop, more events arrive.

**Acceptance**:
- Tool call entry transitions to `status: 'approved'`, then after result: `status: 'success'`.
- Operation resumes to `running` / `streaming`.
- `pendingApprovalId` is cleared.
- Stream events continue being processed.

---

### A14: Approval Pending → Streaming (User Denies)

**Precondition**: Operation in `waiting_for_approval`.

**Steps**:
1. User clicks "Deny".
2. `decideToolApproval(approvalId, false)` is called.
3. Rust unblocks condvar, submits denial to Station.
4. Station continues (may produce more text or finish).

**Acceptance**:
- Tool call entry transitions to `status: 'denied'`.
- Operation resumes to `running`.
- Stream continues (Station may emit more events or `done`).

---

### A15: Approval Pending → Cancelled

**Precondition**: Operation in `waiting_for_approval`.

**Steps**:
1. User clicks stop button while approval is pending.
2. `stopOperation()` aborts the controller.
3. Rust condvar unblocks (approval registry removed on stream cleanup).

**Acceptance**:
- Operation transitions to `cancelled`.
- Approval UI is dismissed.
- Tool call finalized as `cancelled`.
- No further events processed.

---

### A16: Approval Pending → Failed (Timeout)

**Precondition**: Operation in `waiting_for_approval`, 300s elapse.

**Steps**:
1. Rust condvar times out after `TOOL_APPROVAL_TIMEOUT`.
2. Rust submits error result to Station ("tool approval timed out").
3. Station may emit `error` event or continue with the error.

**Acceptance**:
- If Station emits error: same as A10.
- If Station continues: stream resumes, pending tool call is marked as errored.
- Operation transitions back to `running` or to `failed` depending on Station's response.

---

### A17: Completed → Idle (Next Send)

**Precondition**: Previous operation completed.

**Steps**:
1. User sends a new message in the same session.

**Acceptance**:
- Previous operation is cleared from `operations` map.
- New operation is created.
- FSM starts fresh at `streaming`.
- Previous messages remain in the list.

---

### A18: Failed → Idle (Retry)

**Precondition**: Previous operation failed, error message visible.

**Steps**:
1. User clicks retry on the failed message.
2. `retryMessage(messageId)` is called.

**Acceptance**:
- Failed message gets `replacedBy` set.
- New assistant message created with `operation: 'retry'`.
- New operation starts.
- Error state is cleared for new operation.

---

### A19: Cancelled → Idle (Resend)

**Precondition**: Previous operation was cancelled.

**Steps**:
1. User sends a new message.

**Acceptance**:
- Previous cancelled operation is gone from operations map.
- New operation starts normally.
- Cancelled message remains with `loading: false` and partial content.

---

## Edge Case Scenarios

### E1: Rapid Cancel During First Event

**Steps**:
1. User sends message.
2. User immediately clicks stop before any SSE event arrives.

**Acceptance**:
- AbortController fires.
- Assistant message has empty content, `loading: false`.
- No crash or dangling state.

---

### E2: Session Switch During Active Stream

**Steps**:
1. Stream is active on session A.
2. User switches to session B.
3. Events continue arriving for session A.

**Acceptance**:
- Events for session A update `sessionBuffers[A]` but NOT `messages` (since current is B).
- When user switches back to A, `messages` is restored from the live buffer.
- Session B loads its own history normally.

---

### E3: Multiple Approval Requests in One Turn

**Steps**:
1. Station's agent loop calls two tools that both require local execution + approval.
2. First approval is presented, user approves.
3. Second approval is presented.

**Acceptance**:
- Only one approval is pending at a time (Rust blocks sequentially per `resolve_and_submit_local_tool_request`).
- Each approval transitions: streaming → approval_pending → streaming.
- Both tool calls end up in `message.toolCalls` with correct status progression.

---

### E4: Error During Approval Wait

**Steps**:
1. Approval is pending.
2. Network drops, SSE stream errors at transport level.

**Acceptance**:
- `onError` fires.
- Operation fails.
- Approval UI is dismissed.
- Condvar in Rust may timeout separately (does not affect TS state since stream is already done).

---

### E5: Concurrent Operations Across Sessions

**Steps**:
1. Session A has an active stream.
2. User opens session B and sends a message.

**Acceptance**:
- Both sessions have independent operations in `operations` map.
- Events are routed by `sessionKey` / `resolvedSessionKey`.
- UI shows streaming state for whichever session is currently viewed.
- No cross-contamination of messages.

---

### E6: Conversation Created Event After Cancel

**Steps**:
1. Draft session sends message.
2. User cancels before `conversation_created` arrives.
3. `conversation_created` arrives anyway (was already in flight).

**Acceptance**:
- The session key is still updated (conversation was created server-side).
- Operation is already cancelled, so no further event processing.
- Next message sent will use the real conversation ID.

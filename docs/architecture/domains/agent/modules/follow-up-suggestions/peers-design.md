# P2-M8: Follow-up Suggestions — Design (S2)

> **Module**: P2-M8 Follow-up Suggestions
> **Status**: implemented; Native proof pending
> **Depends on**: P0 streaming (done event)

---

## 1. Architecture Decision

**Station-generated suggestions in DonePayload** (not client-side extraction).

Rationale:
- One roundtrip, not two (no separate "extract" call after done)
- Station already has full conversation context at turn end
- Simpler client — just render what arrives, no extra API wiring
- Optional output shares the admitted Topic Provider and execution budget.

## 2. Data Flow

```
Station turn completes
  → generates 3 follow-up suggestions via LLM call
  → attaches to DonePayload.suggestions[]
  → SSE event: { event: "done", data: { suggestions: ["...", "...", "..."] } }

Desktop streaming handler
  → reduceStreamEvent extracts suggestions from done payload
  → stores on ChatMessage.followUpSuggestions: string[]

Desktop UI
  → FollowUpChips component renders below last assistant message
  → click expands Add to input / Reply now
  → Add to input appends without replacing the draft
  → Reply now submits the suggestion while retaining the draft
  → chips disappear once user sends any message
```

## 3. Proto Change

```protobuf
message DonePayload {
  string task_id = 1;
  TurnSummary turn_summary = 2;
  repeated string follow_up_suggestions = 3;  // NEW
}
```

## 4. Station Change

`follow_up_suggestions.go` generates optional output before `completeTurn`:

- Resolve the same admitted Provider/Model and actor-scoped credential.
- Call through `callProviderWithRuntimeAuthority`; capability provenance,
  input limits and provider-attempt reservation remain mandatory.
- Bound the conversation excerpt to 2048 characters per side and output to
  256 tokens or the smaller admitted limit.
- Use a two-second child deadline. Skip when the parent has at most two
  seconds remaining, so auxiliary work cannot consume the completion margin.
- Isolate auxiliary CLI execution with a turn-specific conversation reference.
- Accept exactly three distinct, non-empty JSON strings of at most 240 characters.
- Failure, invalid output or timeout omits suggestions.
- Include call usage in the attempt ledger and trace.
- Persist `TurnEvent.suggestions` in the same transaction as the assistant
  message and terminal event; live delivery and replay use that committed event.

## 5. Desktop Changes

### 5.1 Types

`streaming/types.ts`:
```typescript
export interface DoneEventPayload {
  task_id?: string;
  turn?: Record<string, unknown>;
  type?: string;
  suggestions?: string[];  // NEW
}
```

`store/chat.ts` ChatMessage:
```typescript
followUpSuggestions?: string[];
```

### 5.2 Handler

`streaming/handler.ts` case 'done':
```typescript
case 'done': {
  return {
    ...msg,
    toolCalls: doneCalls,
    loading: false,
    model: s(d.model) || msg.model,
    processDuration: ...,
    followUpSuggestions: Array.isArray(d.suggestions) ? d.suggestions : undefined,
  };
}
```

### 5.3 UI Component

`components/chat/FollowUpChips.tsx`:
- Renders `message.followUpSuggestions` as clickable chips
- Positioned below the last assistant message
- On click: expands explicit Add to input and Reply now actions.
- Insert uses `appendComposer`; send uses the existing `sendMessage` owner.
- Disappears when streaming starts (new message)

### 5.4 Integration

`MessageList` (or equivalent rendering loop): after the last assistant message, if it has `followUpSuggestions` and is the most recent message, render `<FollowUpChips>`.

## 6. Agent Config

There is no Agent Profile model selector or follow-up toggle. Suggestions use
the Topic override or Settings default selected during turn admission.

## 7. File Changes

| File | Change |
|------|--------|
| `model/domain/agent/turn_stream.proto` | Add `repeated string follow_up_suggestions = 3` to DonePayload |
| `apps/station/.../follow_up_suggestions.go` | Bound generation using admitted runtime authority |
| `apps/station/.../turn_service.go` | Generate suggestions after main response |
| `apps/desktop/src/store/streaming/types.ts` | Add `suggestions?` to DoneEventPayload |
| `apps/desktop/src/store/chat.ts` | Add `followUpSuggestions?` to ChatMessage |
| `apps/desktop/src/store/streaming/handler.ts` | Extract suggestions in done case |
| `apps/desktop/src/components/chat/FollowUpChips.tsx` | **NEW** — chip UI |
| `apps/desktop/src/components/messages/AssistantMessage.tsx` | Render FollowUpChips for last message |

## 8. Out of Scope

- Per-message client-side extraction (LobeHub pattern) — we use server-side generation instead
- Custom suggestion count config — fixed at 3
- Suggestion caching/history

## 9. Verification

Focused Station tests cover malformed Provider output, bounded strings and
committed terminal-event serialization. The Native
`conversation-follow-up` scenario requires a real authorized HTTP Provider
request, visible suggestions, two-stage interaction and preserved draft.
Fixture output alone cannot establish product proof. Native remains UNPROVEN
until the current-source Suite and cleanup pass.

# P2-M8: Follow-up Suggestions — Design (S2)

> **Module**: P2-M8 Follow-up Suggestions
> **Status**: S2 design
> **Depends on**: P0 streaming (done event)

---

## 1. Architecture Decision

**Station-generated suggestions in DonePayload** (not client-side extraction).

Rationale:
- One roundtrip, not two (no separate "extract" call after done)
- Station already has full conversation context at turn end
- Simpler client — just render what arrives, no extra API wiring
- Toggle via agent config (no per-message decision on client)

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
  → click → sendMessage(suggestion)
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

In `turn_service.go`, after main LLM response completes and before sending done event:
- If agent config has `follow_up_enabled = true` (default: true)
- Make a fast LLM call with system prompt: "Generate 3 brief follow-up questions the user might ask next, based on this conversation. Return as JSON array of strings."
- Parse response → attach to DonePayload
- If generation fails or times out (2s max), send done without suggestions (graceful degradation)

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
- On click: calls `sendMessage(chip.text)` + clears suggestions from store
- Disappears when streaming starts (new message)

### 5.4 Integration

`MessageList` (or equivalent rendering loop): after the last assistant message, if it has `followUpSuggestions` and is the most recent message, render `<FollowUpChips>`.

## 6. Agent Config

Add `follow_up_enabled` to agent config (default true). Proto field in `agent.proto`:
```protobuf
optional bool follow_up_enabled = 19;
```

Client toggle in agent settings (simple switch).

## 7. File Changes

| File | Change |
|------|--------|
| `model/domain/agent/turn_stream.proto` | Add `repeated string follow_up_suggestions = 3` to DonePayload |
| `model/domain/agent/agent.proto` | Add `optional bool follow_up_enabled = 19` to ExecuteTurnRequest (or agent config) |
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

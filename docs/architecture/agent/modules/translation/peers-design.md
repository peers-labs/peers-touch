# P2-M5 Translation — Peers Design (S2)

## 1. Feature Source

**LobeHub topology**: `store/chat/slices/translate` — per-message translation via LLM call.

**Scope** (from `p2-rich-rendering.md`):
- Per-message translation action (message action bar)
- Target language auto-detection (user locale inversion)
- Inline translation display (below original content)
- Toggle off (re-click removes translation)

**Out of scope** (deferred):
- Batch translate (topic-level) — low priority, no LobeHub parity needed now
- Target language picker UI — auto-detect is sufficient for v1

---

## 2. Architecture Decision

### 2.1 API Layer

Translation reuses the `QuickCompletion` endpoint already built in P2-M8:

```
POST /agent/quick-completion
Body: { "agent_id": "<current>", "prompt": "<translate prompt>" }
Response: { "ok": true, "content": "<translated text>" }
```

Frontend call path:
```
UI action → store.translateMessage(id)
  → api.quickCompletion(agentId, prompt)
    → invokeRustDataFromStatus('agent_quick_completion', { agent_id, prompt })
      → station_client::request_json_auth(POST, "/agent/quick-completion", ...)
        → Station TurnService.QuickCompletion
```

**Rationale**: Translation is a one-shot LLM call with no streaming, tool use, or history. `QuickCompletion` (10s timeout, low effort) is purpose-built for this.

### 2.2 Rust BFF Layer

New Tauri command: `agent_quick_completion`

```rust
#[tauri::command]
pub fn agent_quick_completion(input: AgentQuickCompletionInput, state, window) -> AppResult<Value> {
    // input: { agent_id: String, prompt: String }
    // calls station_client::request_json_auth(POST, "/agent/quick-completion", ...)
    // returns { "content": "..." }
}
```

Registered in `main.rs` command list.

### 2.3 Frontend API

Add to `desktop_api.ts` `api` object:

```typescript
quickCompletion: (agentId: string, prompt: string) =>
  invokeRustDataFromStatus<{ agent_id: string; prompt: string }, { content: string }>(
    'agent_quick_completion', { agent_id: agentId, prompt }
  ).then(r => r.content),
```

### 2.4 Store Layer

Already implemented in `store/chat.ts`:

```typescript
translateMessage: async (id: string) => {
  // 1. Find message
  // 2. If already translated → toggle off (set translation: undefined)
  // 3. Detect target lang from navigator.language
  // 4. Call api.quickCompletion(agentId, translatePrompt)
  // 5. Set message.translation = result
}
```

**Adjustment needed**: Current impl calls `api.quickCompletion(prompt)` with one arg. Must update to pass `agentId` as first arg (from current agent context).

### 2.5 Action Bar Integration

Add `onTranslate` callback to `MessageActionContext`:

```typescript
// types.ts
export interface MessageActionContext {
  // ... existing
  onTranslate: () => void;
}
```

Add translate action to `buildAssistantActions` menu in `registry.ts`:

```typescript
{ key: 'translate', label: 'chat.message.action.translate', icon: Languages, onClick: ctx.onTranslate },
```

Position: after `continue`, before `delAndRegenerate` (non-destructive utility action).

### 2.6 Inline Translation Rendering

In `AssistantMessage.tsx`, after the main `<Markdown>` block, conditionally render:

```tsx
{message.translation && (
  <Flexbox style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 8, marginTop: 8 }}>
    <Typography.Text type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
      {t('chat.message.translation.label')}
    </Typography.Text>
    <Markdown {...chatMarkdownProps} variant="chat" fontSize={14}>
      {message.translation}
    </Markdown>
  </Flexbox>
)}
```

### 2.7 Locale Keys

```json
// en/chat.json
"chat.message.action.translate": "Translate"
"chat.message.translation.label": "Translation"

// zh-CN/chat.json
"chat.message.action.translate": "翻译"
"chat.message.translation.label": "译文"
```

---

## 3. Data Flow

```
User clicks "Translate" on assistant message
  → MessageActionBar dispatches onTranslate
    → useChatStore.translateMessage(message.id)
      → detects target lang (zh→English, else→中文)
      → builds prompt: "Translate to {lang}. Return ONLY the translation.\n\n{content}"
      → api.quickCompletion(agentId, prompt)
        → Tauri invoke → Rust BFF → Station /agent/quick-completion
          → TurnService.QuickCompletion → ProviderService.Call (low effort, 10s timeout)
        ← plain text response
      → sets message.translation = result
      → UI re-renders with inline translation block

User clicks "Translate" again on same message
  → translateMessage detects existing translation
  → sets message.translation = undefined (toggle off)
```

---

## 4. Implementation Checklist

| # | Layer | File | Change |
|---|-------|------|--------|
| 1 | Rust BFF | `src-tauri/src/interface/tauri_commands/agent_quick_completion.rs` | New command |
| 2 | Rust BFF | `src-tauri/src/main.rs` | Register command |
| 3 | Frontend API | `services/desktop_api.ts` | Add `quickCompletion` to `api` object |
| 4 | Store | `store/chat.ts` | Update `translateMessage` to pass agentId |
| 5 | Actions types | `messages/actions/types.ts` | Add `onTranslate` to context |
| 6 | Actions registry | `messages/actions/registry.ts` | Add translate action |
| 7 | UI render | `messages/AssistantMessage.tsx` | Render translation block |
| 8 | Locales | `packages/locales/en/chat.json`, `zh-CN/chat.json` | Add keys |

---

## 5. Acceptance Criteria Preview

- **D1**: `api.quickCompletion` resolves without type errors
- **D2**: `pnpm run check` passes with new action wiring
- **D3**: Rust `cargo check` passes with new command
- **F1**: Click translate on English message → Chinese translation appears inline
- **F2**: Click translate again → translation disappears (toggle)
- **F3**: Translation action hidden during streaming
- **F4**: Translation prompt uses correct target language based on locale
- **I1**: Station `/agent/quick-completion` returns translated text within 10s
- **I2**: Auth token propagated correctly through Rust BFF

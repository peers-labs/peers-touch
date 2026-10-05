# P2-M5 Translation — Acceptance (S4)

## Deterministic (D) — Build & Type Safety

| ID | Check | Result |
|----|-------|--------|
| D1 | `pnpm run check` passes (TS strict, social-wire, runtime-boundaries) | ✅ |
| D2 | `cargo check` passes (Rust BFF, new command registered) | ✅ |
| D3 | `go build ./app/...` passes (Station, QuickCompletion endpoint) | ✅ |
| D4 | `Languages` icon imported from lucide-react, no missing exports | ✅ |
| D5 | Locale keys exist in both `en/chat.json` and `zh-CN/chat.json` | ✅ |
| D6 | `onTranslate` present in all `MessageActionContext` construction sites | ✅ |

## Functional (F) — Runtime Behavior

| ID | Check | Expected |
|----|-------|----------|
| F1 | Click "Translate" on English assistant message | Chinese translation appears inline below content |
| F2 | Click "Translate" again on same message | Translation disappears (toggle off) |
| F3 | Translate action hidden during streaming (loading=true) | Action bar empty during streaming |
| F4 | navigator.language starts with 'zh' → translates to English | Correct target language |
| F5 | navigator.language is 'en' → translates to 中文 | Correct target language |
| F6 | Translation request times out (>10s) → no crash | Graceful failure, no UI change |

## Integration (I) — Full Stack Path

| ID | Check | Expected |
|----|-------|----------|
| I1 | Frontend → Tauri invoke `agent_quick_completion` → Rust BFF | Correctly serializes {agent_id, prompt} |
| I2 | Rust BFF → `request_json_auth(POST, "/agent/quick-completion")` → Station | Auth token propagated, JSON body forwarded |
| I3 | Station TurnService.QuickCompletion → ProviderService.Call | Uses configured provider+model, 10s timeout, low effort |
| I4 | Station response `{ok: true, content: "..."}` → Rust → Frontend | Content extracted, stored as `message.translation` |

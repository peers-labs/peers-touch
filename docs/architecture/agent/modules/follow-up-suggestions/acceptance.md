# P2-M8: Follow-up Suggestions — Acceptance (S2/S4)

> **Module**: P2-M8 Follow-up Suggestions
> **Status**: defined (execute in S4)

---

## Deterministic Checks (automated)

| # | Check | Command / Verification |
|---|-------|----------------------|
| D1 | TypeScript compiles | `cd apps/desktop && pnpm run check` — 0 errors |
| D2 | Go compiles | `cd apps/station && go build ./app/subserver/agent/...` — 0 errors |
| D3 | Proto generates | `./model/build.sh` — no errors |
| D4 | No `any` in FollowUpChips | `grep ': any' apps/desktop/src/components/chat/FollowUpChips.tsx` → 0 hits |
| D5 | No console.log | `grep 'console.log' apps/desktop/src/components/chat/FollowUpChips.tsx` → 0 hits |
| D6 | DonePayload has suggestions field | `grep 'follow_up_suggestions' model/domain/agent/turn_stream.proto` → 1 hit |
| D7 | ChatMessage has followUpSuggestions | `grep 'followUpSuggestions' apps/desktop/src/store/chat.ts` → exists |

## Functional Scenarios (manual, S4)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| F1 | Suggestions appear after response | Send a message, wait for completion | 3 suggestion chips appear below last assistant message |
| F2 | Click suggestion sends message | Click a suggestion chip | New user message sent with that text, chips disappear |
| F3 | Chips disappear on new message | Manually type and send another message | Previous suggestions no longer shown |
| F4 | No suggestions during streaming | While response is streaming | No chips visible (loading = true) |
| F5 | Graceful degradation | If suggestion generation fails (timeout/error) | Done event still arrives, no chips shown, no errors |
| F6 | Only last message shows chips | Multiple assistant messages in conversation | Only the final one shows suggestions |

## Integration Checks

| # | Check | Verification |
|---|-------|-------------|
| I1 | Done event still works without suggestions | If generation fails, message completes normally |
| I2 | No impact on streaming performance | Suggestion generation happens after main response is complete |
| I3 | Locale keys present | Both en and zh-CN have `chat.followUp.title` |

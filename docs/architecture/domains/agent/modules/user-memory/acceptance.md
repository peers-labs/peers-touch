# P1-M4: User Memory — Acceptance (S2/S4)

> **Module**: P1-M4 User Memory
> **Status**: defined (execute in S4)

---

## Deterministic Checks (automated)

| # | Check | Command / Verification |
|---|-------|----------------------|
| D1 | TypeScript compiles | `cd apps/desktop && pnpm run check` — 0 errors |
| D2 | Rust compiles | `cd apps/desktop && cargo check --manifest-path src-tauri/Cargo.toml` |
| D3 | Station compiles | `cd apps/station && go build ./app/subserver/agent/...` |
| D4 | Station tests pass | `cd apps/station && go test ./app/subserver/agent/...` |
| D5 | No `any` types in store/memory.ts | `grep ': any' apps/desktop/src/store/memory.ts` → 0 hits |
| D6 | No hardcoded strings | All user-facing text uses `t()` from i18n |
| D7 | No console.log | `grep 'console.log' apps/desktop/src/store/memory.ts` → 0 hits |

## Functional Scenarios (manual, S4)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| F1 | Edit memory content | MemoryPage → browse → click item → edit icon → change text → save | Memory content updated, list refreshes |
| F2 | Cancel memory edit | Click edit → modify text → cancel | Original content preserved |
| F3 | Memory store reactivity | Edit memory on MemoryPage → switch to chat → return to MemoryPage | Updated content persists without re-fetch |
| F4 | Layer tab filter | Click "Identity" tab → only identity memories shown | Filter applied, count matches |
| F5 | Memory toggle in chat | Open chat → click memory toggle off → send message | Response generated without memory context |
| F6 | Memory toggle persistence | Toggle off → switch session → return | Toggle state preserved per-session |
| F7 | Update endpoint | Call memory_update with new content | Station persists, re-embeds updated content |

## Integration Checks

| # | Check | Verification |
|---|-------|-------------|
| I1 | Store integrates with existing MemoryPage | No duplicate state management; page reads from store |
| I2 | Update reuses existing embedding pipeline | Updated memory is re-embedded via same provider |
| I3 | Memory toggle doesn't break turn flow | Turn executes normally with or without memory |

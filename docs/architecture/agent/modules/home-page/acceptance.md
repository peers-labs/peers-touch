# P3-M6 Home Page — Acceptance

> **Module**: Home Page | **Batch**: P3 | **Status**: ✅ S5 交付

## D — Deterministic Gates

| # | Check | Pass |
|---|-------|------|
| D1 | TS compiles (`pnpm run check` exits 0) | ✅ |
| D2 | No `console.log` / debug statements | ✅ |
| D3 | All UI strings use i18n `t()` keys | ✅ |
| D4 | Locale keys in en + zh-CN (`agent.home.*`) | ✅ |
| D5 | Page descriptor follows project pattern | ✅ |
| D6 | Registered in `registry.ts` + `CORE_PAGES` | ✅ |

## F — Functional Checks

| # | Scenario | Expected | Pass |
|---|----------|----------|------|
| F1 | Navigate to home page | Shows activity stats, quick actions, recent topics | ✅ |
| F2 | Recent topics (cross-agent) | Last 5 topics sorted by updated_at | ✅ |
| F3 | Pinned agents section | Shows agents with pinned/favorite flag | ✅ |
| F4 | Quick actions (New Chat, Create Agent) | Trigger navigation callbacks | ✅ |
| F5 | Empty state (no agents/topics) | Graceful empty display | ✅ |

## I — Integration Checks

| # | Scenario | Pass |
|---|----------|------|
| I1 | Data from existing agent + topic stores (no new store) | ✅ |
| I2 | Page navigation via `navigateTo('home')` | ✅ |
| I3 | No duplicate data fetching (reuses loaded store state) | ✅ |

## Files

- `src/pages/HomePage.tsx`, `HomePage.descriptor.tsx`, `HomePageContainer.tsx`
- `packages/locales/{en,zh-CN}/agent.json` — 12 keys

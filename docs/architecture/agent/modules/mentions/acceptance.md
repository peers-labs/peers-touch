# P3-M8 Mentions — Acceptance

> **Module**: Mentions | **Batch**: P3 | **Status**: ✅ S5 交付

## D — Deterministic Gates

| # | Check | Pass |
|---|-------|------|
| D1 | TS compiles | ✅ |
| D2 | No debug statements | ✅ |
| D3 | All UI strings via i18n | ✅ |
| D4 | Locale keys (`agent.mentions.*`) in en + zh-CN | ✅ |
| D5 | Store uses `createDesktopStore` | ✅ |
| D6 | No `any` types | ✅ |

## F — Functional Checks

| # | Scenario | Expected | Pass |
|---|----------|----------|------|
| F1 | `useMentionTrigger` detects `@` | Opens popup when preceded by space/start | ✅ |
| F2 | MentionPopup shows filtered agents | Filters by query after `@` | ✅ |
| F3 | Keyboard navigation | Up/Down/Enter/Escape | ✅ |
| F4 | Select agent → adds to mentionedAgentIds | Store updated | ✅ |
| F5 | MentionTag renders with avatar + name | Visual tag component | ✅ |
| F6 | MentionTagBar shows all mentions | Horizontal tag row | ✅ |
| F7 | Remove mention (x button) | Removed from store | ✅ |
| F8 | `clearMentions` on send | Cleans state | ✅ |

## I — Integration Checks

| # | Scenario | Pass |
|---|----------|------|
| I1 | `getFilteredAgents` excludes current agent and already-mentioned | ✅ |
| I2 | Barrel export `src/components/chat/mentions.ts` ready for ChatInput wiring | ✅ |
| I3 | Hook returns handlers compatible with textarea onChange/onKeyDown | ✅ |

## Files

- `src/store/mentions.ts`
- `src/components/chat/MentionPopup.tsx`
- `src/components/chat/MentionTag.tsx`
- `src/components/chat/composer/useMentionTrigger.ts`
- `src/components/chat/mentions.ts` (barrel)
- Locale: 4 keys

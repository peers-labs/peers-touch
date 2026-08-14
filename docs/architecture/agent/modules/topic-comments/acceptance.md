# P3-M7 Topic Comments — Acceptance

> **Module**: Topic Comments
> **Batch**: P3 — Multi-Agent & Ecosystem
> **Status**: S4 验收
> **Source**: `lobehub-feature-topology.md` → `store/topicComment`

---

## D — Deterministic Gates

| # | Check | Command / Evidence | Pass |
|---|-------|--------------------|------|
| D1 | TS compiles without error | `pnpm run check` exits 0 | ✅ |
| D2 | No `console.log` / `debugPrint` | grep scan clean | ✅ |
| D3 | No hardcoded UI strings | All user-facing text uses `t()` keys | ✅ |
| D4 | Locale keys exist in en + zh-CN | `chat.topicComments.*` (3 keys), `agent.sidebar.menu.comments` (1 key) | ✅ |
| D5 | Store uses `createDesktopStore` factory | `topicComments.ts` line 1 | ✅ |
| D6 | No `any` type in new code | Verified in TopicCommentsView + topicComments store | ✅ |

---

## F — Functional Checks

| # | Scenario | Expected | Verified |
|---|----------|----------|----------|
| F1 | Right-click topic → "Comments" | Portal opens with TopicCommentsView | ✅ |
| F2 | Type comment + press Enter | Comment added, appears in list with timestamp | ✅ |
| F3 | Click Send button (disabled when empty) | Only submits when input non-empty | ✅ |
| F4 | Delete a comment (trash icon) | Comment removed from list | ✅ |
| F5 | Refresh page → reopen comments | Comments persist via localStorage | ✅ |
| F6 | Switch topics → open comments | Shows different comment list per topicKey | ✅ |
| F7 | Empty state | Shows "No comments yet" placeholder | ✅ |
| F8 | Close portal → reopen | State preserved (expanded + activeView) | ✅ |

---

## I — Integration Checks

| # | Scenario | Expected | Verified |
|---|----------|----------|----------|
| I1 | Portal already showing artifacts → open comments | View switches to topicComments cleanly | ✅ |
| I2 | Portal header reflects view type | PortalHeader receives `activeView` prop | ✅ |
| I3 | Thread view and comments coexist | Each is independent portal view, no state collision | ✅ |
| I4 | localStorage key isolation | `peers-agent-topic-comments` does not conflict with other storage | ✅ |
| I5 | Topic deletion (sidebar) | Comments for deleted topic remain orphaned but inert (no error) | ✅ |

---

## Architecture Conformance

- **Store pattern**: Zustand via `createDesktopStore`, consistent with `portal.ts`, `chat.ts`.
- **Persistence**: localStorage (local-first), no Station dependency — appropriate for v1 personal notes.
- **Portal integration**: Extends `PortalView` union type; routing in `PortalPanel.tsx` matches existing patterns.
- **Entry point**: Topic context menu in `AgentSidebar.tsx`, using `usePortalStore.getState()` (static access, no hook dependency in callback).
- **i18n**: All 4 new keys registered in both locales.

---

## Files Modified

| File | Change |
|------|--------|
| `src/store/topicComments.ts` | New store (CRUD + localStorage) |
| `src/store/portal.ts` | `openTopicComments` action + PortalView type |
| `src/components/portal/views/TopicCommentsView.tsx` | New view component |
| `src/components/portal/PortalPanel.tsx` | Route topicComments view |
| `src/components/AgentSidebar.tsx` | "Comments" menu item + import |
| `packages/locales/en/chat.json` | 3 keys |
| `packages/locales/zh-CN/chat.json` | 3 keys |
| `packages/locales/en/agent.json` | 1 key |
| `packages/locales/zh-CN/agent.json` | 1 key |

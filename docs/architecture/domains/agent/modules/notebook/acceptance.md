# P3-M5 Notebook — Acceptance

> **Module**: Notebook / Pages | **Batch**: P3 | **Status**: ✅ S5 交付

## D — Deterministic Gates

| # | Check | Pass |
|---|-------|------|
| D1 | TS compiles | ✅ |
| D2 | No debug statements | ✅ |
| D3 | All new UI strings via i18n | ✅ |
| D4 | Locale keys (`notes.notebook.*`) in en + zh-CN | ✅ |
| D5 | Store uses `createDesktopStore` | ✅ |

## F — Functional Checks

| # | Scenario | Expected | Pass |
|---|----------|----------|------|
| F1 | Existing NotesPage still functional | No regression | ✅ |
| F2 | Notebook store CRUD (createPage, updatePage, deletePage) | API-backed operations | ✅ |
| F3 | Search pages by title/content | `getFilteredPages()` filters correctly | ✅ |
| F4 | `getRecentPages(limit)` | Returns sorted by updatedAt | ✅ |
| F5 | Dirty state tracking | `markDirty` / clean on save | ✅ |

## I — Integration Checks

| # | Scenario | Pass |
|---|----------|------|
| I1 | Store wraps existing backend API (not localStorage) | ✅ |
| I2 | HomePage can use `useNotebookStore` for recent pages | ✅ |
| I3 | No conflict with existing NotesPage local state | ✅ |

## Files

- `src/store/notebook.ts`
- `packages/locales/{en,zh-CN}/notes.json` — 10 keys

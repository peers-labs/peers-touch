# P1-M5: Portal / Side Panel — Acceptance (S2/S4)

> **Module**: P1-M5 Portal / Side Panel
> **Status**: defined (execute in S4)

---

## Deterministic Checks (automated)

| # | Check | Command / Verification |
|---|-------|----------------------|
| D1 | TypeScript compiles | `cd apps/desktop && pnpm run check` — 0 errors |
| D2 | No `any` types in portal components | `grep -r ': any' apps/desktop/src/components/portal/ apps/desktop/src/store/portal.ts` → 0 hits |
| D3 | No console.log | `grep -r 'console.log' apps/desktop/src/components/portal/ apps/desktop/src/store/portal.ts` → 0 hits |
| D4 | No hardcoded strings | All user-facing text uses locale keys or is icon-only |
| D5 | Portal store exists | `apps/desktop/src/store/portal.ts` exists, exports `usePortalStore` |
| D6 | Component files exist | `apps/desktop/src/components/portal/{PortalPanel,PortalHeader,views/ArtifactDetailView,views/ArtifactListView,views/ToolDetailView}.tsx` all exist |
| D7 | No circular imports | Portal components do not import from `store/chat.ts`; data flows via props |

## Functional Scenarios (manual, S4)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| F1 | Open artifact from message | Send message that produces code block → click "Open" on artifact card | Portal expands, shows syntax-highlighted code |
| F2 | Artifact list view | Click portal toggle when no specific artifact selected | Shows list of all artifacts in conversation |
| F3 | Navigate artifact → list | View artifact detail → click back/close → reopen portal | Returns to list view |
| F4 | Tool detail from message | Expand tool calls → click "Details" on a tool call | Portal shows full tool args + result |
| F5 | Close portal | Click X in portal header | Portal collapses, chat area reclaims width |
| F6 | Portal toggle persistence | Close portal → send another message → open portal | Portal opens to last state or default (artifact list) |
| F7 | Narrow mode | Resize window below 900px | Portal disappears, chat uses full width |
| F8 | DraggablePanel resize | Drag portal left edge | Panel width changes, persists between views |

## Integration Checks

| # | Check | Verification |
|---|-------|-------------|
| I1 | Portal doesn't break existing chat | Chat page works identically when portal is collapsed |
| I2 | Data flows via props | Portal receives messages as prop, never reads chat store directly |
| I3 | AssistantMessage unchanged | onOpenArtifact prop already existed; no internal changes to AssistantMessage |
| I4 | DraggablePanel from @lobehub/ui | Import verified, no new dependency added |

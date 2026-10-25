# Desktop Search continuity

Search is one Shell overlay. It inherits shared UI Identity; no separate
Search module skin is defined. Its main subject is the readable result list,
with the input as the action rail and the field as the loading-feedback owner.

## Input and display

- The input reflects every keystroke immediately. IME composition does not
  dispatch queries until composition ends.
- Input admission is debounced by 120 ms. Enter submits the current draft
  immediately.
- Until the newest response arrives, keep the previous readable results,
  order, highlight query, group title, selection and scroll position.
- Commit the result, its query and its mode together. A new result query/mode
  resets list selection and scroll once; refreshing or appending the same
  query preserves position.
- Never relabel old results with the new draft. Enter on a changed draft
  submits it even if a retained row was selected.
- An empty response is a completed query, not a transient loading state.
  Retain its query-specific empty state until the next response commits.
- A request lasting 200 ms displays a localized status indicator in a fixed
  input-field slot. Fast requests do not flash a spinner. Loading must not
  insert space above the result list or resize the overlay.
- The panel has a state-independent height bounded by the current viewport.
  The input and filter rails cannot shrink; results scroll within the remaining
  space. Coverage has a reserved, keyboard-scrollable slot above a fixed action
  row. Initial content, pending queries, results, empty/error states, coverage
  changes, refresh and opening feedback must not move or resize these regions.
  Full coverage copy remains readable even when it exceeds the reserved slot.
- Errors preserve draft text. A background-query error may retain a result
  only while the native read validity still permits it.

## Runtime and authority

`runtimes/searchQueries.ts` uses the framework-independent TanStack Query
Client/Observer for request subscriptions, AbortSignal cancellation, query
storage and previous-data projection. The lifecycle owner is `searchRuntime`;
the Zustand store exposes semantic presentation state only.

Native Search/Messaging remains the authority for read scope, source revision,
expiry, permission, cancellation and opening. Check native read state before
cache admission and after a read. Placeholder data never extends its native
lease. Clear private projections and query partitions on scope, session,
Station or matching Messaging invalidation. Hide a displayed response at the
earliest expiry/lease deadline even without input. Reconcile on focus and at
the existing two-second interval; unreadable/unknown data fails closed.

Query storage is bounded to 32 frames/640 items, with at most 200 displayed
items. Partial results do not become reusable complete cache entries.
Resource row identity uses authority, object kind/id and navigation anchor,
independent of mutable content revision. Same-session close/open restores
readable data and scroll; it cannot bypass native validity checks.
The store retains one selected row key; the overlay derives its rendered index.
Temporary source concealment changes visible content only. It preserves the
last qualified traversal, selected key and scroll, and DOM scroll clamping
cannot overwrite that context. User selection among remaining readable rows
remains authoritative. A qualified new intent resets context; a qualified
same-intent page clears selection only if the selected key actually disappeared.

## Regression journey

Given a native Desktop account with synchronized Chinese message history:

1. Search a known query and obtain real rows.
2. Type and backspace through overlapping queries; capture each rendered
   frame and DOM mutation. Before commit, rows and highlights stay attached
   to the previous displayed query. Only the newest draft may commit.
3. Repeat a cached query and close/reopen; validate readable result reuse and
   stable scroll. No delayed request may overwrite a later query.
4. Measure a fast request and a delayed real response: the latter shows
   status after 200 ms without moving the panel, field, filter rail, result
   viewport, coverage or action row (tolerance 1 CSS px at a fixed viewport).
   Compare initial, result, empty/error and source coverage/recovery frames;
   resize checks compare stability separately at each actual native viewport.
5. Exercise IME, no-hit, changed-draft Enter, pagination and original-message
   open. Validate that auth/expiry/invalidation immediately removes private
   content. A missing runtime cell remains `UNPROVEN`.

Evidence consists of real response identity, input/commit trace, screenshots
and geometry. Synthetic fixture data, a prototype, or an API response alone
does not prove the receiver-visible journey.

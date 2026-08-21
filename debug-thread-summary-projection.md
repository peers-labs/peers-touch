# Debug Session: thread-summary-projection
- **Status**: [OPEN]
- **Issue**: A real Native inline reply renders in both clients, but the root row's thread summary count and reply IDs remain empty.
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: `.dbg/trae-debug-log-thread-summary-projection.ndjson`

## Reproduction Steps
1. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
2. Create the Alice/Bob MLS group through the visible Chat UI.
3. Send one Alice root message and one Bob root message.
4. Hover Bob's root row, click the real Reply action, and send Alice's inline reply.
5. Observe that the reply renders in both clients while Bob's root row does not reach one reply ID.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | The inline reply intent binds `replyToMessageId` but omits `threadRootMessageId` | High | Low | Confirmed: line 1 reports the reply target with both root fields empty |
| B | The Engine returns the thread root, but the TypeScript projection drops it | Medium | Low | Rejected: line 2 shows the Engine projection itself has an empty root |
| C | The store contains the linked reply, but `ChatMessageArea` does not subscribe to the state that invalidates its summary | Medium | Low | Rejected: lines 3-38 repeatedly show the rendered relation candidate and empty root |
| D | Summary ownership counts only explicit thread roots while inline replies carry only a reply target | High | Low | Confirmed: lines 2-38 preserve `replyTo=<root>` with an empty root and zero summary |
| E | The summary is only delayed by a bounded projection race | Low | Low | Rejected: the exact state persisted through the full 120-second wait |
| F | The Native Gate treats only standalone rows as visible messages and ignores the visible thread preview | High | Low | Confirmed post-fix: relation/count converged, but the helper timed out before its summary check |
| G | The root row receives an empty `threadPreviewMessages` array despite the converged reply ID | Medium | Low | Rejected: commit events report the exact reply ID |
| H | The preview receives the reply but its stable DOM marker is not committed | Medium | Low | Rejected: every commit event reports `markerFound=true` |
| I | The preview marker exists, but its rendered text does not match the sent reply | Medium | Low | Confirmed: the content marker was attached to the sender label instead of the reply text |
| V | The Native Reply click does not enter the React button handler | Medium | Low | Reply button click event is absent |
| W | The Reply callback runs, but `replyToUlid` never commits or is cleared before send | High | Low | Callback exists without a stable non-empty state transition |
| X | The visible overlay target differs from the expected Bob root | Medium | Low | Overlay and callback message IDs differ from the hovered root |
| Y | Reply state commits for the expected root, but the send closure reads an empty value | Low | Low | Non-empty commit precedes a send with no inline-reply intent event |

## Log Evidence
Pre-fix run:
`20260821T073541077837Z-4cabc173c0405ac9c988f2d2dfcc3398`.

- Line 1: the real Reply action produced
  `replyToMessageId=01M0HM3C70VTG3X6QXR8G3RS2B` while both the target root and
  explicit intent root were empty.
- Line 2: the Engine projection returned the committed reply with the same
  reply target and an empty `threadRootMessageId`; the TypeScript mapper did
  not drop a value.
- Lines 3-38: the root row repeatedly saw the relation candidate, but
  `loadedReplyIds=[]`, `threadCountReplyCount=0`, and no latest reply ID.
- The Gate again failed with
  `timed out waiting for thread summary projection`; cleanup released `3330`,
  `3331`, `4445`, and `4446`.

Post-fix relation run:
`20260821T074412262780Z-fdf3c7ccfbe3f72f6606e1e101ce59ab`.

- Line 2: the committed reply now carries the exact root in
  `threadRootMessageId`.
- Lines 3-6: `loadedReplyIds` immediately contains the reply; the canonical
  count/latest projection then converges to the same ID with count `1`.
- The run moved earlier to a distinct Gate defect:
  `wait_message_text` searched only standalone `[data-message-ulid]` rows, while
  a correctly rooted reply is rendered as a visible root-owned thread preview.
- The product preview therefore needs stable reply ID/content DOM markers, and
  the Native helper must recognize that visible surface without weakening the
  later summary/panel exact-ID assertion.

Preview marker diagnostic run:
`20260821T075949019506Z-c85b6c95c4f0c3d5b57f934a61653627`.

- G was rejected: every preview commit reported the exact reply ID.
- H was rejected: `markerFound=true` and `contentFound=true` on every commit.
- I was confirmed: the marked element alternated between sender-label lengths,
  proving `data-thread-preview-message-content` was attached to the sender
  `<Text>` rather than the adjacent reply-content `<Text>`.
- The marker was moved to the actual reply-content element; the Gate helper
  remains unchanged and still requires the expected reply text and exact ID.

Thread exact verification run:
`20260821T080712872082Z-f8e3af1719281cf80fd3aeebc8ff427d`.

- The visible preview carried the expected reply text and exact reply ID.
- The immutable assertion ledger recorded `thread_exact=PASS` with summary and
  panel count `1`, the same reply ID, and the exact root ID.
- The run advanced to closing the panel and exposed a separate narrow-window
  layout failure: the close button rect was outside the `864px` viewport at
  `x=1080..1108`. That failure belongs to a new debug session and does not
  invalidate the thread relation/summary/panel proof.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

Reply lifecycle diagnostic run:
`20260821T084006802166Z-cfa8745ff57bc4469dc01cee8187843a`.

- All three Native sends completed, including the 18-character reply payload.
- The reply send emitted no `ChatMessageArea:handleSend` inline-reply intent
  event and no relation/summary event.
- The Gate therefore timed out at `thread summary projection` before reaching
  the transcript post-fix probe.
- Hover/overlay Native evidence remained healthy and cleanup released
  `3330/3331/4445/4446`.
- This run does not invalidate the earlier exact thread or transcript evidence;
  it exposes an intermittent Reply action/state lifecycle before intent
  construction.

Reply lifecycle verification run:
`20260821T085148009517Z-f6f0a3c957625f32c2a82c4c92e32c1b`.

- V rejected: the React Reply button handler entered for Bob root
  `01M0HREWPP08395PSB5G6TCEMR`.
- X rejected: overlay target, callback target, and expected root were identical;
  the anchor remained connected.
- W rejected: `replyToUlid` committed to the exact root, remained available
  through `handleSend`, then cleared after intent capture.
- Y rejected: the send closure read the same non-empty reply target.
- The Engine relation, summary, preview, and panel converged to reply
  `01M0HRF5557B7A5YRR6CMWN97F`; `thread_exact=PASS`.
- The run advanced into the corrected transcript assertion. Cleanup evidence and
  direct `lsof` verification show all actor ports released.

Transient action refocus run:
`20260821T092456697805Z-9eb5cdac84a4179ccaf983c3fd3d3893`.

- The real hover produced the expected pane-owned overlay, but no V, W, X, Y,
  inline-reply intent, relation, or summary event followed in this run.
- Composer instrumentation proved the third send completed, so it was sent as
  an ordinary top-level message rather than a Reply.
- Hover instrumentation proved the Driver re-focused the already-focused actor
  by moving the pointer to the title bar. The row then emitted `mouseleave`,
  and the 140ms close timer removed the transient overlay before the paced
  Native click completed.
- This run does not reopen the product relation fix. It exposes a Driver target
  lifecycle defect before the Reply handler. The Driver must establish focus
  before resolving transient selectors and must not move the pointer when the
  actor already owns focus.
- Cleanup evidence and direct `lsof` verification show ports
  `3330/3331/4445/4446` released.

Idempotent-focus verification run:
`20260821T093354484080Z-7f080a8e2ca1c7ca4f44c3b9c7534a18`.

- V, W, X, and Y were rejected again: the Reply handler and callback entered
  for the expected root, state committed, and the send closure captured the
  same non-empty target.
- The Engine relation contained the exact root and reply IDs.
- `thread_exact=PASS`; the Gate advanced through transcript, toolbar, and the
  successful reaction picker before failing at Reaction recovery.
- This comparison closes the transient Driver target lifecycle defect in dirty
  runtime evidence without changing product Reply or thread semantics.
- Cleanup evidence and direct `lsof` verification show ports
  `3330/3331/4445/4446` released.

## Verification Conclusion
The inline Reply action submits an incomplete `SendMessageIntent`. The
`socialChat` command owner passes the reply target but does not derive the
immutable thread root required by the Messaging architecture. The Engine and
renderer then preserve that incomplete relation correctly, so neither thread
counting nor the panel can discover the reply. The fix belongs in the
`socialChat` send-intent construction shared by Direct and Group: use the
explicit root when provided; otherwise resolve the reply target's existing root
or use the target itself as the root. The post-fix relation evidence confirms
that correction. A separate Acceptance selector gap prevented the run from
reaching the already-converged summary assertion; the helper must preserve
visible thread-preview identity as well as standalone-row identity.
The final dirty verification passed the exact summary/panel assertion. The
debug session remains open until user confirmation and clean source-bound
verification; instrumentation is intentionally retained.

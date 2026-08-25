# Debug Session: attachment-send-draft
- **Status**: [OPEN]
- **Issue**: A normal two-attachment Native send allocates a message ID and attachment IDs but returns composer state `draft` instead of `queued`.
- **Debug Server**: http://127.0.0.1:7780/event
- **Log File**: `.dbg/trae-debug-log-attachment-send-draft.ndjson`

## Reproduction Steps
1. Build the dedicated Desktop binary from exact HEAD with `make acceptance-driver-build`.
2. Deploy the same HEAD to Profile Three and verify `/app-meta/version`.
3. Run `CHAT_ACCEPTANCE_RESET=1 CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 make acceptance-chat-native-product-closure`.
4. Complete the failed-attachment recovery journey, then select the normal image and text attachments and send.
5. Observe `messaging_send_outcome:not_queued:draft`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | Native send fires before attachment hydration completes. | High | Low | Submit entry observes attachment records that are still uploading or incomplete. | Rejected |
| B | The Engine accepts submit but writes the composer state back to `draft` in the same transition. | Medium | Medium | Engine transition logs show a queued command followed by a draft state update. | Rejected |
| C | Rust-to-TypeScript outcome mapping converts a queued result into `draft`. | Medium | Low | Rust outcome and renderer outcome disagree for the same message ID/revision. | Rejected |
| D | One attachment upload or metadata operation fails after IDs are allocated, preventing outbox enqueue. | High | Low | Attachment result contains a failed/non-ready item or upload error before submit returns. | Rejected in the reproduction |
| E | The preceding failure injection remains active and contaminates the normal send. | Medium | Low | Fault state remains enabled at normal submit entry or the normal path reports the injected failure. | Rejected |
| F | The pending sender row renders before the committed attachment projection exists, so eager image open fails once and never resolves the preview. | High | Low | Gate accepts a two-ID pending send and clears drafts, then `openAttachment` reports `messaging attachment projection is unavailable` while Alice never reaches an image-loaded row. | Confirmed |
| G | The lifecycle deletes a completed upload source before the pending message is committed, leaving the eager sender preview without either a valid local source or canonical projection. | High | Low | Cleanup reports the attachment before `open_attachment_once`; pending lookup is missing/incomplete and canonical projection is absent. | Pending |
| H | The sender commit omits canonical attachment projections even after the pending row is removed. | Medium | Low | `open_attachment_once` reports no pending source and no canonical projection after command commit. | Pending |
| I | The attachment row and projection exist, but image decoding or asset URL conversion fails. | Low | Low | Engine returns a verified path while the DOM image remains unloaded or errors. | Pending |

## Log Evidence
- Pre-instrumentation Native run `20260823T170346937849Z-df8e52a09b8fcec409c868892409bcb6`:
  `Composer send outcome was not queued: {'revision': 3, 'state': 'draft', 'messageId': '01M0QSEVDAW61C8NNABWBR16GW', 'count': 2, 'ids': ['01M0QSEVDB0JNY476ATKMHRB7J', '01M0QSEVDB7G86M5HQM5TAS4BC']}`.
- Runtime frontend error:
  `messaging_send_outcome:not_queued:draft`.
- Assertions through `attachment_failure_draft_retained` passed.
- Actor ports, processes, logs, and storage were released by the Gate.
- Instrumented Native run `20260823T171841857361Z-14eded7ef7d01d037840bf1f38352ed6`:
  - NDJSON line 19: failed draft count and hit-testable dialog count are both zero.
  - NDJSON line 21: both Composer drafts are `ready`; `uploading=false`, `failed=false`.
  - NDJSON lines 23-24: both Engine attachment transfers return `Complete`.
  - NDJSON lines 25-28: Engine, raw Tauri response, store projection, and Gate all observe the same `pending` outcome and command ID.
- The new first failure is:
  `attachment-only sender/receiver rows diverged or contain text`.
- Runtime DOM evidence shows identical attachment IDs/kinds/states on both actors, but
  `[data-message-content]` includes attachment filename, size, and sender-only visibility badge text.
- Source inspection confirms `data-message-content` marks the whole `.msg-bubble`, while
  `ChatMessageContent` renders both message plaintext and attachment cards inside that element.

## Instrumentation
- `ChatComposer:submit`: draft readiness and attachment conservation before send.
- `im-service:sendMessage`: renderer request shape and raw Tauri response.
- `messaging::engine:submit_message`: Engine entry, per-attachment transfer progress, and prepare result.
- `native_product_closure_runner`: failed-attachment dialog release and Gate-observed outcome.

## Fix
- Preserve `data-message-content` as the full message bubble geometry marker.
- Add `data-message-text` to the rendered plaintext span.
- Read `data-message-text` for attachment-only plaintext equality while retaining all attachment
  identity, kind, state, image-load, and byte-exact assertions.
- Keep all instrumentation enabled with `runId=post-fix` until user confirmation.

## Verification Conclusion
The original `draft` outcome did not reproduce and none of hypotheses A-E explains this run.
The latest boundary is a distinct DOM semantic ownership defect: the message-content marker
represents the entire bubble instead of the visible message plaintext. The debug session remains
open because intermittent `draft` evidence has not yet been reproduced or closed.

## Post-Fix Attempts
- Commit `6887f2f2c90dba26a183614f964cc5171955acbb` is deployed to Profile Three and
  bound to the dedicated `acceptance-webdriver` binary.
- Runs `20260823T212227617712Z-4d06da18937af7e522b49ee3a83ca0ed` and
  `20260823T212411163739Z-a8615d3a18a8784e7945e270c6b71f80` both stopped before
  the first product action because the Alice Native process could not become frontmost.
- Environment evidence: `NSWorkspace.frontmostApplication` is `loginwindow` PID 416 and
  `IOConsoleUsers.CGSSessionScreenIsLocked=Yes`.
- Both failed runs released Actor processes, ports, logs, and storage. The post-fix debug log
  remains empty because neither run reached the attachment journey.
- After the console briefly appeared unlocked, exact-HEAD commit
  `b27f3bd898f4c95d841e3dd4a805fb53115035c8` was deployed and rebuilt. Run
  `20260824T005920933280Z-ae94692e7e51697d3d77abbecd5781d4` again stopped before
  `group.create.ui`; immediate recheck showed `loginwindow` frontmost and
  `CGSSessionScreenIsLocked=Yes`. The debug log remained empty and cleanup passed.
- Exact HEAD `c52950e10d350396310a4ff94bbfd41e216a6c11` passed the dedicated WebDriver
  smoke and matched Profile Three `build_commit=c52950e10d35`. Run
  `20260824T013241143244Z-e4945039f87e362b28ede31d5b5a9e8f` ran while the console
  had no lock marker and Alice emitted `host:app-resume:window-focus`, but the
  cooperative activation wait still timed out before `group.create.ui`. Current
  evidence does not distinguish `document.hasFocus()` from Native point ownership,
  so the next change must be evidence-only activation instrumentation. Runtime
  cleanup passed and the post-fix attachment log remains empty.
- After the Acceptance-only cross-Space window fix, exact-HEAD run
  `20260824T020842025058Z-dff949138ed1919b0a9b946d8b7cd55c` crossed Native
  activation and reached `attachments.ui`. Attachment-only sender/receiver
  plaintext semantics passed. The next first failure was text-plus-attachment
  exact plaintext: both actors rendered the identical prefix
  `\ue03da\ue003` before the expected text.
- Python inspection proves the prefix is exactly
  `Keys.COMMAND + "a" + Keys.BACKSPACE`. The embedded WebDriver serialized the
  clearing shortcut as text. The fix routes select-all and backspace through the
  existing CoreGraphics keyboard path and waits until the Composer value is
  empty before inserting the intended text.
- Exact-source Linux run
  `20260825T105212735213Z-01976d5d011a067dddb2692d7d6b7721`
  at `906b5fe67f5f1e651c7b960964150bcc55029855` passed two ready Composer
  attachments, a `pending` send outcome with two attachment IDs, Composer draft
  cleanup, background upload recovery, and failed-attachment draft retention.
  It then timed out waiting for the Alice image attachment to load. Runtime log
  line 1585 recorded `messaging attachment projection is unavailable` for the
  eager image open.
- The Engine's visible-message query intentionally merges
  `messaging_pending_messages` with committed projections and loads completed
  draft metadata for pending rows. `open_attachment_once`, however, required
  `messaging_attachment_projections` before checking the completed upload
  transfer. The sender row could therefore render before its canonical
  projection and permanently retain the one-shot eager-open error.
- The owning-layer repair lets the Engine resolve only an actor-local source
  joined to the same pending message and a completed upload transfer. It
  revalidates the source bytes against the durable draft plaintext SHA-256.
  Committed sender and receiver paths retain the canonical projection and
  download verification flow.
- Exact-source Linux run
  `20260825T163209869286Z-756e3bd025991a3bae94acc70da349a8`
  at `4e7062b3ae97a61dcf860c30a3175ad4ec6dc0d0` passed source/runtime
  identity, transcript/thread, reactions, avatar/Station attribution,
  background upload recovery, settings readback, and failed-attachment draft
  retention. It accepted and cleared the two ready attachment drafts, then
  timed out waiting for the Alice two-attachment row. Runtime evidence again
  recorded `messaging attachment projection is unavailable` for attachment
  `01M0WXCBR1PKE0AW0933CNQPWC`. All actor processes, tunnels, endpoint leases,
  ports, and storage were released. The next diagnostic run must distinguish
  G/H/I at the Engine lifecycle boundary.

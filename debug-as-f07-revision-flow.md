# Debug Session: as-f07-revision-flow
- **Status**: [OPEN]
- **Issue**: The first exact-source AS-F07 production scenario times out with
  `agent.acceptance.turnSubmissionTimeout` before emitting independently
  evaluated revision evidence.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-as-f07-revision-flow.ndjson

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`, profile `two`.
2. Deploy Station and build the Acceptance Desktop binary from the same clean
   source commit.
3. Run `agent-v2-kernel-foundation-e2e` with
   `PT_AGENT_V2_ALLOW_STATION_RESTART=1`.
4. Observe the first Browser AS-F07 tuple.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | The cancellable retry-source turn never emits a text event before its 120-second deadline | High | Low | The last checkpoint is `retry-source-started`, with no `retry-source-cancel-requested` |
| B | The retry-source cancellation is acknowledged but its stream never emits terminal cancellation | Medium | Low | Cancellation response is recorded, but `retry-source-finished` is absent |
| C | The completed baseline turn exceeds the generic 120-second turn deadline | Medium | Low | Retry completes and the last checkpoint is `baseline-started` |
| D | A synchronous retry/regenerate/edit command blocks while executing its provider turn | Medium | Low | The last checkpoint is immediately before one revision command |
| E | Branch selection or receiver projection blocks after all revision commands complete | Low | Low | Edit completes and the last checkpoint is branch-selection or DOM wait |

## Instrumentation
- Record one redacted stage checkpoint before and after each AS-F07 production
  action.
- Record only stage name, elapsed time, terminal event type, sequence, and
  presence/count facts. Do not record content, actor identity, credentials, or
  tokens.

## Log Evidence
- Exact-source run
  `20260830T085407159167Z-7d59eb27f0e0e3b9a727cdbc9fa93c95`
  reached Browser AS-F07 after all AS-F06 tuples passed, then failed with
  `agent.acceptance.turnSubmissionTimeout`.
- The failure did not identify which of the two observed turns timed out.
- Exact-source run
  `20260830T092128791528Z-9a9c827e6d32f6b854cb103f7e29d6d8`
  used clean source, deployed Station, and Desktop commit
  `4fc6bcd5645c6c3a8587f822e4ea8a0fbf6ba4b7`.
- `.dbg/trae-debug-log-as-f07-revision-flow.ndjson` lines 1-3 show that
  Browser AS-F07 started, requested cancellation after the first text event
  at 2361 ms / sequence 3, and observed a `cancelled` terminal event at
  3092 ms.
- The immutable Gate log then failed at `agent_retry_turn failed`; no
  `retry-finished` checkpoint was emitted.
- Exact-source rerun
  `20260830T105006501570Z-9ea71a2d66bc221db156d1ea3dc3c69d`
  passed AS-F05 and AS-F06, entered Browser AS-F07, and emitted only
  `scenario-started` before `agent.acceptance.turnSubmissionTimeout`.
  No `retry-source-cancel-requested` event was emitted.
- Exact-source run
  `20260830T111643174494Z-96ed0bfa4a8c8fb9f72039d48a16aff7`
  cancelled at durable `provider_call_started` sequence 2 in 3207 ms and
  observed terminal `cancelled` in 3421 ms. Retry started with conversation
  version 4 and one terminal attempt (`status=13`), then returned
  `RustCommandException / INTERNAL_ERROR` in 113 ms. Station logs show the
  retry transaction completed and `turn started` was emitted before the HTTP
  handler returned 500.
- Exact-source run
  `20260830T114748280303Z-4519f9380180cb5ed5ba6536ddcf714c`
  reproduced the same cancellation and 113 ms retry failure. The Station error
  body was generic and contained no typed code/message.
- `ExecuteTurn` registers ownership before `createOrReopenTurnRecord`. Retry
  supplies only `ExistingTurnID`, so the current implementation generates and
  registers a different `TurnID`, then replaces it with the existing Turn ID.
  The first `emitTurnEvent` consequently fails the ownership fence as
  superseded. The existing early-retry test supplied both IDs and masked this
  production shape.
- Checkpoint `a05900a5caa699a7b1c7a33dee3959c386925d45`
  resolved execution ownership from the admitted Turn ID. Exact-source run
  `20260830T122020868414Z-9839533f2d4beeafe189649535e82bd3`
  removed the prior 113 ms HTTP 500: Station accepted the retry, reused
  `turn_47afbf8dcf8d18d4f93fe64d`, entered the provider path, and returned HTTP
  200 after 34.338 seconds. The Desktop command failed after approximately
  15 seconds with transport status `0`, before the Station response arrived.
  Cleanup passed and AS-F07 remained the first failing tuple.

## Verification Conclusion
- Hypothesis A is confirmed as nondeterministic: one run emitted cancellable
  text in 2361 ms, while the next source-matched run emitted no text within
  120 seconds.
- Hypothesis B is rejected: cancellation reached a terminal `cancelled` event.
- Hypothesis C is not reached.
- Hypothesis D is confirmed at the first retry command, but its owning
  Station/transport error is not yet identified.
- Hypothesis E is not reached.
- The fixture must not use external provider first-token latency as the
  cancellation boundary. The next implementation cancels on the durable
  `provider_call_started` progress event, which is emitted after source user
  message persistence, while preserving the real provider, cancellation, and
  retry paths. Typed retry error instrumentation remains active.
- The cancellation-boundary correction is runtime-confirmed. Hypothesis D is
  now narrowed to the early retry execution path after atomic admission and
  before provider invocation. The next instrumentation extracts only the
  typed Station error code/message from the existing HTTP error body.
- Hypothesis D is confirmed: retry execution ownership is registered against
  the wrong Turn ID. The fix must bind ownership to the precreated/existing
  admission ID before execution starts; instrumentation remains for post-fix
  comparison.
- The post-fix run confirms the ownership correction and refines Hypothesis D:
  retry execution completes successfully on Station, but the synchronous
  revision request exceeds Desktop's generic 15-second JSON transport timeout.
  The next investigation must decide from the accepted revision contract
  whether revision commands return a durable admission acknowledgement or use
  a long-running Turn-specific transport timeout.
- Source-backed timing identified a second Station defect: the original
  execution used the pinned `128000` context window, while retry used `0`,
  forced compression for only 190 estimated tokens, spent about 29 seconds
  generating an unnecessary summary, and split the conversation before the
  final provider call. The local fix now restores the context limit from the
  persisted reconciled runtime snapshot and rejects invalid limits.
- Reconcile Gate A retained the existing synchronous Proto response contract.
  Desktop now routes retry/regenerate/edit through a bounded Turn-execution
  transport policy and moves native blocking work off the Tauri main thread.
  Branch/tombstone remain short interactive requests. Post-fix runtime
  comparison is pending.
- Exact-source run
  `20260830T154703060073Z-5ec0d1b6ce4880d6a1e73af571e369d5`
  on `30c0fdb99ec8ad166985366fb4aa223867c3bb74` passed the prior
  Browser AS-F04 failure and reached Browser AS-F07, where
  `agent_retry_turn failed`. The Debug Server had exited during the long
  Foundation run, so `.dbg/trae-debug-log-as-f07-revision-flow.ndjson`
  remained empty and this run cannot distinguish a Station response,
  Turn-execution transport timeout, or native command failure. The same
  exact-source run must be repeated with the Debug Server retained.
- Exact-source run
  `20260830T162124124250Z-d80b623b486ff157036d4f6beafbf873`
  on `06eeb9dce5a2f92507dd7eeee503a01fb78da5d4` retained the
  Debug Server and reproduced the Browser failure. Debug lines 1-5 show
  cancellation requested at provider admission, terminal `cancelled` at
  1979.9 ms, retry start from conversation version `4`, and HTTP
  `409 CONFLICT` at 2295.5 ms.
- Station logs show `/turn/retry` returned 409 in 4 ms. Database readback shows
  the source Turn and attempt were `cancelled`, the conversation version
  remained `4`, no revision command was inserted, and the latest assistant
  message for that Turn was `completed` because the provider tool-call message
  had already been persisted.
- Hypothesis D is refined and confirmed: transport and execution ownership are
  no longer failing. `RevisionService` rejects the authoritative cancelled Turn
  because it incorrectly applies retry eligibility to the immutable completed
  tool-call assistant artifact.
- The local fix preserves the completed tool-call message, creates a distinct
  pending assistant projection for the new attempt under the existing branch,
  and keeps provider context rooted at the source user message. Post-fix
  runtime comparison is pending.

# Debug Session: foundation-f06-terminal-race-v2
- **Status**: [OPEN]
- **Issue**: The unchanged 419-cell Foundation Gate fails in Browser English AS-F06 preparation because the recovery Turn is already terminal before the transport-cut scenario can take ownership.
- **Debug Server**: http://127.0.0.1:7780/event
- **Log File**: .dbg/trae-debug-log-foundation-f06-terminal-race-v2.ndjson

## Reproduction Steps
1. Activate the canonical `chat-native-disposable` profile.
2. Deploy exact source `2d9d69df40b2ac8fd5d41d58c19de949e16fceec`.
3. Run `agent-attachment-e2e` and confirm 19/19 assertions.
4. Run the unchanged `agent-v2-kernel-foundation-e2e`.
5. Observe Browser English `AS-F06` fail in `foundationF06Prepare` with `agent.acceptance.foundationRecoveryTurnAlreadyTerminal`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | The provider completes the recovery Turn before the transport cut is armed. | High | Low | The terminal event timestamp precedes the cut request or cut acknowledgement. |
| B | The cut is armed, but the fault proxy does not match the active request/stream. | Medium | Medium | The cut is acknowledged for a different request or no bytes are cut before terminal settlement. |
| C | Browser restart/readback selects a stale conversation or Turn. | Medium | Low | Prepared conversation/Turn IDs differ from the IDs read after restart. |
| D | Cleanup wraps an expected already-terminal state and obscures the primary ordering failure. | Medium | Low | Cleanup begins after terminal settlement and emits secondary cancel/readback failures. |
| E | The real proxy cut completes, but Browser consumes an already-buffered terminal frame before its recovery store observes transport loss. | High | Low | Confirmed: proxy cut was requested and acknowledged with the matching active record, then `done` removed that record in the same millisecond before the non-CONNECTED boundary settled. |

## Instrumentation Plan
- Record preparation start and the elapsed time to failure.
- Record terminal event type, sequence, event counts, recovery-record state, and whether the cut was already requested.
- Record fault-cut request and acknowledgement timing and recovery cursor/phase.
- Record cleanup locator selection and secondary cleanup outcome.

## Log Evidence
- Pre-fix run: `20260911T011437939285Z-27e9444f5a5686f4e1697f9440f97bed`.
- Candidate run: `20260911T011446852235Z-3196ffd3b473f6a37d35965371cd9582`.
- Failure tuple: `foundation-browser-direct / browser / direct_model / AS-F06 / en / single / sample-001`.
- Primary chain: `FoundationCandidateError -> FoundationClientError -> GateError`.
- Cleanup: both clients, all ports, storage, and actor identity released; outer Provisioner cleanup passed.
- Instrumented run
  `20260911T013357171761Z-3e0f22bd90738ba4e8d15784e5ad8e1c`
  on `ed423e16eef10a6d43a32a781e2b9fc48338c8c9` crossed all four
  AS-F06 tuples.
- Browser English requested and acknowledged the cut at 4039/4041 ms;
  Browser Simplified Chinese at 3847/3849 ms; Desktop English at 1949/1992
  ms; Desktop Simplified Chinese at 2289/2328 ms.
- Every tuple retained its recovery record at acknowledgement, settled only
  after the cut boundary, and completed scenario cleanup.
- Exact-source run
  `20260912T112845134359Z-c05aa8bcfaf45a91f7e171c27a90c915`
  on `68417f9f19bf8e2a78700dd2799edd4e958ea7db` crossed the
  managed-launcher restart defect. Browser English AS-F06 completed its cut,
  restart, and cleanup. Browser Simplified Chinese requested the proxy cut at
  2616 ms and received the acknowledgement at 2617 ms with the matching active
  record still `CONNECTED`; a buffered `done` event was consumed at 2618 ms
  before the recovery phase changed, removing the record and producing
  `foundationRecoveryTurnAlreadyTerminal`.
- That failed preparation also proved the cleanup diagnostic gap: the durable
  cleanup locator contained the Turn ID, but canceling the already-terminal
  Turn returned `agent.turnCancelFailed` and prevented queue cancellation and
  Conversation deletion inside the first cleanup attempt. Outer failure
  cleanup eventually released all processes, ports, storage, and Station
  leases.
- The local correction preserves the external proxy as the fault authority,
  then invokes the existing production transport-disconnect primitive only
  after the proxy acknowledges that its active sockets are closed. This drops
  buffered post-cut frames through the existing `consumeAgentSSE` abort check
  before waiting for the recovery phase. Cleanup records a Turn-cancel error
  but continues to queue cancellation, Conversation deletion, and final residue
  verification; a still-active dependency therefore continues to fail closed.
  Desktop API tests pass `60/60`, Foundation runtime/scenario tests pass
  `74/74`, Agent static tests pass `85/85`, Desktop strict check and diff
  hygiene pass. Exact-source post-fix proof remains pending.

## Verification Conclusion
The earlier controlled run rejected A through D as stable defects, but the
latest exact-source run confirms E and reproduces D as a secondary cleanup
problem. The proxy remains the source of the outage: the local transport is
disconnected only after the proxy acknowledges the real cut, solely to discard
bytes buffered before that acknowledgement. No retry, timeout increase,
synthetic terminal, or relaxed oracle is introduced.

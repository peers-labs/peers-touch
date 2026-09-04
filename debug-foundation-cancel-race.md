# Debug Session: foundation-cancel-race
- **Status**: [OPEN]
- **Issue**: Browser AS-F03 intermittently observes a non-cancelled Station terminal winner after requesting cancellation from the first text event.
- **Debug Server**: `http://127.0.0.1:7779/event`
- **Log File**: `.dbg/trae-debug-log-foundation-cancel-race.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile.
2. Verify Station source identity equals the current clean worktree HEAD.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable reset and Station restart envelope.
4. Observe Browser `AS-F03 / zh-CN / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The provider commits `completed` after the first text event but before the cancellation transaction wins. | High | Low | Pending: capture the Station cancellation response status and callback-to-response timing. |
| B | The first text event is delivered from an already-buffered transport chunk after Station has committed a terminal state. | High | Low | Pending: capture event sequence and terminal events already observed when cancellation resolves. |
| C | The Harness derives a stale or unrelated Turn ID from the accumulated event list. | Medium | Low | Pending: compare the triggering text event Turn ID with the selected Turn ID. |
| D | Desktop Browser transport reshapes or omits the Station-authored cancellation status. | Medium | Low | Pending: capture the complete safe response shape and compare it with Station contract semantics. |

## Log Evidence
- Exact-source Gate run `20260904T141328825018Z-38da519bb0beba1008fa7b78826514ee` on `af2a859a04b386e65d88f181e4b0a7b97d249caf` failed at Browser `AS-F03 / zh-CN / single / sample-001` with `agent.acceptance.foundationActiveTurnCancelRejected`.
- The Gate reached `FIXTURE_READY`, source and live Station commits matched, and provisioner plus client cleanup completed successfully.
- The current Harness discards the non-cancelled status before emitting diagnostics, so the immutable Gate log cannot distinguish hypotheses A-D.

## Instrumentation
- `A`: cancellation response status and request-to-response latency.
- `B`: observed event types and sequences at request and response boundaries.
- `C`: triggering-event Turn identity equality with the selected cancellation target.
- `D`: safe response presence or normalized error code from the Desktop adapter.

## Verification Conclusion
Pending post-instrumentation exact-source evidence.

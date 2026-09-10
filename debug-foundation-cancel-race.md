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
| A | The provider commits `completed` after the first text event but before the cancellation transaction wins. | High | Low | Confirmed: the failing sample returned `completed` and had already observed `done` sequence 44 when the cancel response arrived. |
| B | Buffered text frames continue to reach the client while the cancellation request is in flight. | High | Low | Confirmed: both tuples requested cancellation at sequence 3 and had observed text through sequence 31 when the response arrived. |
| C | The Harness derives a stale or unrelated Turn ID from the accumulated event list. | Medium | Low | Rejected: triggering and selected Turn identities matched in all three instrumented tuples. |
| D | Desktop Browser transport reshapes or omits the Station-authored cancellation status. | Medium | Low | Rejected: responses were present and preserved both `cancelled` and `completed` Station statuses. |

## Log Evidence
- Exact-source Gate run `20260904T141328825018Z-38da519bb0beba1008fa7b78826514ee` on `af2a859a04b386e65d88f181e4b0a7b97d249caf` failed at Browser `AS-F03 / zh-CN / single / sample-001` with `agent.acceptance.foundationActiveTurnCancelRejected`.
- The Gate reached `FIXTURE_READY`, source and live Station commits matched, and provisioner plus client cleanup completed successfully.
- The current Harness discards the non-cancelled status before emitting diagnostics, so the immutable Gate log cannot distinguish hypotheses A-D.
- Diagnostic run `20260904T142747367508Z-59fddbe07fd75bf50392a158f05b2e3c` on `50f98702f09bead6606ff641224c4a1feea4c0b3` passed both Browser AS-F03 locale tuples. Cancellation was requested at text sequence 3 after 2062-2219 ms and returned `cancelled` after 158-162 ms; both Turn-identity comparisons were true.
- Each cancellation response arrived after buffered text through sequence 31 had already been observed. The strict AS-F03 oracle still passed, and the run later advanced to AS-F12.
- Diagnostic run `20260904T153321748945Z-5390dd23d06e8b2d74cc7b8d0253071f` on `4a0fdfb81bf356e1ef54e1e942c559dde9e7bcdb` reproduced the Browser AS-F03 English failure. Cancellation was requested from text sequence 3 after 1375 ms. The response arrived 146.5 ms later with the authoritative status `completed`; the stream had already delivered text through sequence 43 and `done` sequence 44.

## Instrumentation
- `A`: cancellation response status and request-to-response latency.
- `B`: observed event types and sequences at request and response boundaries.
- `C`: triggering-event Turn identity equality with the selected cancellation target.
- `D`: safe response presence or normalized error code from the Desktop adapter.

## Fix
- Replace the short response request with the plan-required long live-provider workload.
- Permit at most two real cancellation-window acquisition attempts.
- Retry only when Station returns the legitimate durable `completed` winner, deleting that completed conversation before the next attempt.
- Preserve strict failure for every other non-cancelled outcome and for retry exhaustion.
- Preserve the final requirement for one authoritative `cancelled` terminal event.

## Verification Conclusion
The ordinary provider can finish and durably commit before the separate
cancellation request wins, even though the request starts from the first
client-observed text event. The current AS-F03 fixture therefore does not
provide the delayed-provider precondition required by the plan. Station
terminal-winner semantics, Turn identity, and Desktop response transport are
correct. Post-fix exact-source comparison is pending; keep this session open.

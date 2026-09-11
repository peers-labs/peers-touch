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

## Verification Conclusion
Pending focused pre-fix instrumentation and reproduction.

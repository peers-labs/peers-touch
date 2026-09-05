# Debug Session: foundation-recovery-error-key
- **Status**: [OPEN]
- **Issue**: Browser AS-F06 observes `RECOVERY_FAILED`, but the captured recovery evidence has an empty `errorHash`.
- **Debug Server**: `http://127.0.0.1:7782/event`
- **Log File**: `.dbg/trae-debug-log-foundation-recovery-error-key.ndjson`

## Reproduction Steps
1. Use the approved `chat-native-disposable` profile.
2. Verify the Station at `10.37.94.156:18132` is healthy and source-matched.
3. Run `agent-v2-kernel-foundation-e2e` with disposable reset and Station restart authorization.
4. Observe Browser `AS-F06 / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | The accepted `recovery_failed` event contains no canonical failure key. | High | Low | Event instrumentation records no failure-key source before the reducer enters `RECOVERY_FAILED`. | Pending |
| B | The event carries the failure identity under another field that the reducer does not normalize. | Medium | Low | A safe field-presence map shows an alternate reason/error code while the normalized key is empty. | Pending |
| C | Sequence deduplication retains an earlier empty-key failure and rejects a later keyed failure. | Medium | Medium | A later `recovery_failed` event with a key is rejected at the same or older sequence. | Pending |
| D | The Harness samples the recovery record before the failure key is committed. | Low | Low | The outage-boundary sample has an empty key, followed by a keyed state transition without another accepted event. | Pending |

## Log Evidence
- Exact-source run
  `20260905T122935196020Z-b10c556a47fdd200739b280e907e37ba`
  on `d983768315b338e71a5cea48f4eccc95f6a93daa` failed at Browser
  `AS-F06 / en / single / sample-001` because `errorHash` was empty.
- Existing recovery instrumentation records an accepted `recovery_failed`
  transition into `RECOVERY_FAILED`, but it does not record whether the
  normalized failure key was present.
- Provisioner cleanup completed `DONE / PROVEN / passed`.

## Instrumentation
- `agentTurnRecovery.consume` records whether an accepted
  `recovery_failed` event carries error/reason/error-code fields and whether
  the current, reduced, and committed records hold a failure key.
- `agentTurnRecovery.setPhase` records failure-key presence across transitions
  into and out of `RECOVERY_FAILED`.
- The AS-F06 Harness records failure-key presence at outage entry, initial
  recovery-failure sampling, and retry-failure sampling.
- All records contain only booleans, phase names, sequences, and recovery
  epochs; no error text or identity is emitted.

## Verification Conclusion
Pending runtime instrumentation.

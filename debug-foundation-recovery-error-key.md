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
| A | The accepted `recovery_failed` event contains no canonical failure key. | High | Low | Event instrumentation records no failure-key source before the reducer enters `RECOVERY_FAILED`. | Inconclusive: the target boundary was not reached in the latest run. |
| B | The event carries the failure identity under another field that the reducer does not normalize. | Medium | Low | A safe field-presence map shows an alternate reason/error code while the normalized key is empty. | Inconclusive: the target boundary was not reached in the latest run. |
| C | Sequence deduplication retains an earlier empty-key failure and rejects a later keyed failure. | Medium | Medium | A later `recovery_failed` event with a key is rejected at the same or older sequence. | Inconclusive: the target boundary was not reached in the latest run. |
| D | The Harness samples the recovery record before the failure key is committed. | Low | Low | The outage-boundary sample has an empty key, followed by a keyed state transition without another accepted event. | Inconclusive for the target tuple; other transitions prove `setPhase(..., failureKey)` retains the key. |

## Log Evidence
- Exact-source run
  `20260905T122935196020Z-b10c556a47fdd200739b280e907e37ba`
  on `d983768315b338e71a5cea48f4eccc95f6a93daa` failed at Browser
  `AS-F06 / en / single / sample-001` because `errorHash` was empty.
- Existing recovery instrumentation records an accepted `recovery_failed`
  transition into `RECOVERY_FAILED`, but it does not record whether the
  normalized failure key was present.
- Provisioner cleanup completed `DONE / PROVEN / passed`.
- Exact-source run
  `20260905T131248877567Z-ef022ff2b49f7b5593a5ad8bd508c217`
  on `f95a4dd0eb779aae6106872257a1d1c4247535b2` stopped earlier:
  provider completion closed the recovery record before outage observation.
  The error-key instrumentation therefore sampled `MISSING` rather than the
  original empty-key boundary.
- Two independent `RECONNECTING -> RECOVERY_FAILED` transitions recorded
  `failureKeyArgumentPresent=true` and `nextFailureKeyPresent=true`. This
  proves the normal `failRecovery` phase transition retains a supplied key,
  but it does not classify the original empty-hash tuple.
- Post-fix exact-source aggregate
  `20260905T144656500100Z-697d09085b429dbe9832fe2545120f4e`
  on `cdf50ddc8b0c4f2f3d6c3d87c8bbc83907dcce87` recorded two normal
  `RECONNECTING -> RECOVERY_FAILED` transitions with a supplied and retained
  failure key. The host rebooted at `2026-09-05T23:09:05+08:00` before the
  runner finalized the target tuple or emitted a candidate and cleanup
  receipt. The attempt remains `INCOMPLETE / UNPROVEN` and does not classify
  the original empty-hash boundary.

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
The target empty-`errorHash` boundary remains unclassified because the latest
run failed earlier at the now-confirmed provider-terminal race. The current
post-fix candidate makes the transport cut deterministic before Station
restart. Keep this session open and reuse the instrumentation on the next
exact-source run; no failure-key behavior change is justified yet. The
interrupted run supplied supporting normal-transition evidence only.

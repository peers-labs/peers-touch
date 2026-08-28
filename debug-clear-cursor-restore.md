# Debug Session: clear-cursor-restore
- **Status**: [OPEN]
- **Issue**: Linux Native product Gate restores `clearedAt` to zero, but Alice and Bob transcripts do not become exactly equal before the existing timeout.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-clear-cursor-restore.ndjson`

## Reproduction Steps
1. Run `chat-native-product-closure-e2e` against the disposable Station on port `18132`.
2. Complete the unchanged product journey through restart recovery.
3. Clear Alice history, restart Alice, and verify the transcript remains cleared.
4. Restore Alice history and retain the existing exact Alice/Bob transcript assertion.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Station message listing returns an incomplete historical set after restore. | High | Medium | Pending: compare Station/Engine message projection with both DOM transcripts. |
| B | Desktop reload still applies the previous `clearedAt` while rebuilding Alice's transcript. | High | Low | Pending: compare local member settings, Station settings, and Alice transcript after restore. |
| C | Alice and Bob projections differ only in mutable receipt or attachment presentation fields. | Medium | Low | Pending: persist the final normalized transcript diff. |
| D | DOM extraction observes only a virtualized or not-yet-rendered transcript window. | Medium | Medium | Pending: compare DOM row counts with Engine projection counts over the timeout. |

## Log Evidence
Pre-fix run `20260828T094159402051Z-14d24d8003f13ea5febfcb97d7950910` reached restored `clearedAt == 0` and then timed out waiting for the unchanged exact transcript assertion. The failed report did not preserve the final Alice/Bob transcript snapshots.

Instrumentation points:

- `A-D:restore-success`: first exact-match observation, attempt count, elapsed time, and transcript.
- `A-D:restore-snapshot`: sampled UI/Station cursor, DOM transcripts, and Engine message IDs/sequences while exact equality is false.
- `A-D:restore-timeout`: final sampled state, also persisted into the Gate Evidence Store.

## Verification Conclusion
Instrumentation run `20260828T102206795386Z-a963385206049f636f97ab58cd1fe719`
passed the full Gate with the complete five-row transcript restored. Hypotheses A-D
remain inconclusive because the mismatch did not reproduce. The next run removes
all pre-restore reporting latency and records the first exact predicate observation.

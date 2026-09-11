# Debug Session: incompatible-capability-cleanup
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation Gate reaches `BASE-INCOMPATIBLE_CAPABILITY / browser / en / single` but the Harness reports `agent.acceptance.foundationIncompatibleCapabilityCleanupFailed`.
- **Debug Server**: `http://127.0.0.1:7787/event`
- **Log File**: `.dbg/trae-debug-log-incompatible-capability-cleanup.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile.
2. Verify local and live Station source identity at `795b063e294c834f5a5f902f32b118455c8029f3`.
3. Run C08 and require `DONE / PROVEN`.
4. Run the unchanged `agent-v2-kernel-foundation-e2e` Gate.
5. Observe Browser `BASE-INCOMPATIBLE_CAPABILITY / en / single / sample-001`.

Pre-fix evidence:
- Gate run: `20260911T144617919957Z-488bd7f90445a030728100fb38fc6611`
- Aggregate run: `20260911T144617762479Z-489613d497b02ead168adbf4af8b84b7`
- Failure: `agent.acceptance.foundationIncompatibleCapabilityCleanupFailed`
- Provisioner cleanup and secret scan: passed

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Scenario cleanup reaches an already-absent conversation or Agent and misclassifies canonical `NOT_FOUND` as failure. | High | Low | Pending: record each cleanup operation outcome and normalized error code. |
| B | The capability binding is already tombstoned or removed, but cleanup repeats deletion with stale revision state. | Medium | Low | Pending: record active binding presence and delete outcome without identifiers. |
| C | Fixture provider restoration succeeds partially but the final version/credential assertion throws. | Medium | Low | Pending: record provider delete/readback phase and final safe booleans. |
| D | Restoring the prior selected Agent fails after disposable Agent deletion or navigation reset. | Medium | Low | Pending: record selection-presence and restoration phase outcomes. |

## Log Evidence
Pending pre-fix cleanup instrumentation run.

## Instrumentation
- `A-D`: records whether the scenario had already failed and which cleanup
  resources were created.
- `A`: records conversation and Agent deletion boundaries.
- `B`: records active-binding presence and binding deletion completion.
- `C`: records fixture-provider readback and deletion completion.
- `D`: records prior-selection restoration.
- `A-D`: records the exact cleanup stage and normalized error code on failure,
  or all final safe cleanup booleans on success.

## Verification Conclusion
Pending.

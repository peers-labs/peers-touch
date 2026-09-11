# Debug Session: forbidden-actor-cleanup
- **Status**: [OPEN]
- **Issue**: `BASE-FORBIDDEN-ACTOR` completes rejection and owner readback but Bob's owner fixture cleanup fails twice.
- **Debug Server**: pending
- **Log File**: `.dbg/trae-debug-log-forbidden-actor-cleanup.ndjson`

## Reproduction Steps
1. Activate `chat-native-disposable`.
2. Use exact source `c93bc4a35acf94c821c41be29cf5d1376209045b`.
3. Run the unchanged Foundation Gate with reset, disposable, approved-profile,
   and Station-restart authorization.
4. Observe Browser English `BASE-FORBIDDEN-ACTOR` reach owner cleanup and fail
   both the primary call and coordinator retry.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | Conversation deletion succeeds initially, but retry misclassifies `CONVERSATION_DELETED` as failure | High | Low | Retry records `deletionCode=CONVERSATION_DELETED` and `resourceDeleted=false` |
| B | Agent deletion succeeds but readback exposes a soft-deleted entity | Medium | Low | Delete returns success while `getAgent` still resolves |
| C | Agent deletion changes local selection and prior selection restoration fails | Medium | Low | Resource and Agent deletion pass while `priorSelectionRestored=false` |
| D | Agent deletion is rejected by an active conversation dependency | Medium | Low | Delete records a non-not-found dependency error |
| E | Primary and retry cleanup fail at different stages | Medium | Low | First and second cleanup summaries differ |

## Log Evidence
- Foundation run `20260911T055153986412Z-d8d8bae13c5182ec6d49fcbd74dc01b0`
  reached `BASE-FORBIDDEN-ACTOR`.
- Owner readback completed before cleanup.
- `cleanupFoundationForbiddenActorOwner` failed, and the coordinator retry of
  the same cleanup failed again.
- Outer Provisioner cleanup completed `DONE / PROVEN`.

## Verification Conclusion
Pending cleanup-stage instrumentation.

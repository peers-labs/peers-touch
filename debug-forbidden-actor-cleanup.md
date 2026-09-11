# Debug Session: forbidden-actor-cleanup
- **Status**: [OPEN]
- **Issue**: `BASE-FORBIDDEN-ACTOR` completes rejection and owner readback but Bob's owner fixture cleanup fails twice.
- **Debug Server**: `http://127.0.0.1:7784/event`
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
| A | Conversation deletion succeeds initially, but retry misclassifies `CONVERSATION_DELETED` as failure | Confirmed | Low | Retry records `deletionCode=CONVERSATION_DELETED` and `resourceDeleted=false` |
| B | Agent deletion succeeds but readback exposes a soft-deleted entity | Rejected | Low | Station records Agent delete `200` followed by Agent get `404`; the row is absent from PostgreSQL |
| C | Agent deletion changes local selection and prior selection restoration fails | Rejected | Low | Both cleanup attempts record `priorSelectionRestored=true` |
| D | Agent deletion is rejected by an active conversation dependency | Rejected | Low | The first Agent delete returns HTTP `200`; the retry returns canonical HTTP `404` because the Agent is already absent |
| E | Primary and retry cleanup fail at different stages | Confirmed | Low | First cleanup misclassifies Agent get `404`; retry misclassifies both deleted resources |

## Log Evidence
- Foundation run `20260911T055153986412Z-d8d8bae13c5182ec6d49fcbd74dc01b0`
  reached `BASE-FORBIDDEN-ACTOR`.
- Owner readback completed before cleanup.
- `cleanupFoundationForbiddenActorOwner` failed, and the coordinator retry of
  the same cleanup failed again.
- Outer Provisioner cleanup completed `DONE / PROVEN`.
- Exact-source run
  `20260911T113248603126Z-06d037f93b8d390b5619d30808c87fa8`
  on `3aabb516bae3a69a4c8de8dde6951557a4a6e937` reproduced the
  cleanup failure after crossing AS-F07, `BASE-APPROVAL_EXPIRED`,
  `BASE-ATTACHMENT_REJECTED`, and `BASE-EXECUTOR_UNAVAILABLE`.
- Debug lines 1-4 show the first cleanup deleted the conversation, received no
  Agent delete error, restored selection, but classified the Agent as present.
  Station logs show `/agent/delete` returned `200` and the immediate
  `/agent/get` returned `404`.
- Debug lines 5-8 show the coordinator retry received
  `CONVERSATION_DELETED`, then a second Agent delete returned `404`; both
  already-absent resources were classified as cleanup failures.
- Direct PostgreSQL readback after the run finds the conversation in
  `deleted` status and no row for the fixture Agent.

## Verification Conclusion
The Station deletion is correct. The Acceptance Harness cleanup is not
idempotent because it recognizes only an embedded `AGENT_4004` string, while
the Desktop API exposes canonical absence as `RustCommandException.code =
NOT_FOUND`; it also fails to treat `CONVERSATION_DELETED` as success. The fix
belongs only in the Harness cleanup classifier.

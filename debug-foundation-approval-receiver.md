# Debug Session: foundation-approval-receiver
- **Status**: [OPEN]
- **Issue**: Browser BASE-APPROVAL-DENIED observes a Tool approval event but times out waiting for the corresponding ToolCall receiver.
- **Debug Server**: `http://127.0.0.1:7782/event`
- **Log File**: `.dbg/trae-debug-log-foundation-approval-receiver.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile with its local provider overlay.
2. Verify the Station is remote, healthy, and source-matched.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable reset and Station restart envelope.
4. Observe Browser `BASE-APPROVAL-DENIED / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Selecting the new conversation after the Turn starts drops the earlier ToolCall event from the Chat store. | High | Low | Pending: compare ToolCall membership before selection, after selection, and after approval observation. |
| B | Periodic authoritative message refresh removes a pending ToolCall-only local projection before Station persists an equivalent message. | High | Low | Pending: record refresh entry/exit and pending ToolCall membership. |
| C | The tool runtime receives the approval proposal while the Chat message projection does not. | Medium | Low | Pending: compare tool-runtime status with Chat-store ToolCall membership. |
| D | The matching ToolCall exists in the DOM but is hidden or collapsed. | Low | Low | Pending: record matching DOM count and visibility. |
| E | The approval event and rendered ToolCall use different IDs. | Low | Medium | Pending: compare only equality booleans between expected IDs and projected entries. |

## Log Evidence
- Exact-source run `20260904T171932940301Z-1ffb7349f89aa4d4977ac5235a458a6d`
  on `7562b002327821c70296cba42214f4eedb0f5291` passed the earlier
  Foundation core path and failed at Browser
  `BASE-APPROVAL-DENIED / en / single / sample-001` while waiting for the
  receiver ToolCall element.
- Provisioning reached `FIXTURE_READY`; source identity matched; provisioner
  cleanup completed `DONE / PROVEN / passed`.

## Instrumentation
- Conversation selection records current-session equality plus Chat-store
  message and ToolCall counts.
- Approval observation records Chat-store, Tool runtime, Station message, and
  DOM membership as booleans/counts without persisting IDs or content.
- Receiver timeout records the same bounded snapshot for comparison.
- Authoritative `syncMessages` records message, ToolCall, and pending ToolCall
  counts before and after cache replacement.

## Verification Conclusion
Pending pre-fix runtime evidence.

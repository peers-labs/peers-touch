# Debug Session: foundation-f12-projection
- **Status**: [OPEN]
- **Issue**: Browser AS-F12 Simplified Chinese times out waiting for the selected branch message to appear in the active conversation projection.
- **Debug Server**: `http://127.0.0.1:7781/event`
- **Log File**: `.dbg/trae-debug-log-foundation-f12-projection.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile.
2. Verify Station source identity equals the current clean worktree HEAD.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable reset and Station restart envelope.
4. Observe Browser `AS-F12 / zh-CN / single / sample-001` preparation.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `selectSession` or `syncMessages` leaves the target branch message absent from the Chat store. | High | Low | Pending: compare selected-session state and message membership after both calls. |
| B | Station readback does not project the branch selected by the preceding revision command. | Medium | Low | Pending: compare expected branch membership with the synchronized store. |
| C | The Chat store contains the selected branch but React has not rendered it before the timeout. | Medium | Low | Pending: compare store membership with DOM membership and visibility. |
| D | Navigation leaves the Agent page hidden while the correct conversation is selected. | Medium | Low | Pending: record matching DOM nodes and their visibility without content. |
| E | `syncMessages` encounters a transport error that its projection-preserving contract intentionally absorbs. | Medium | Low | Pending: record the post-sync store state and correlate with runtime logs. |

## Log Evidence
- Exact-source Gate run `20260904T150505739160Z-7d9babb401f1240950f77893ac962634` on `686dc32f7a953071ae460b6fcecacc7583883dd4` passed the prior AS-F03 boundary and Browser AS-F12 English.
- Browser AS-F12 Simplified Chinese then timed out waiting for one conversation projection.
- The Gate completed provisioner and client cleanup successfully, but the existing timeout message does not identify which store or DOM predicate stayed false.

## Instrumentation
- `A`: selected-session equality, session registration, and synchronized store message count.
- `B`: selected-branch membership in the synchronized store and independent Station readback.
- `C`: selected-branch DOM membership and visibility.
- `D`: rendered message count and selected message role/status.
- `E`: readback error code when the post-timeout Station diagnostic cannot complete.

## Verification Conclusion
Pending post-instrumentation exact-source evidence.

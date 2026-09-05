# Debug Session: approval-retry-cancellation
- **Status**: [OPEN]
- **Issue**: Browser BASE-APPROVAL_EXPIRED creates exactly one retry attempt and distinct approval, but the scenario times out waiting for the retried Turn and ToolCall to become cancelled.
- **Debug Server**: `http://127.0.0.1:7779/event`
- **Log File**: `.dbg/trae-debug-log-approval-retry-cancellation.ndjson`

## Reproduction Steps
1. Use the approved `chat-native-disposable` profile.
2. Verify the remote Station at `10.37.94.156:18132` is healthy and source-matched.
3. Run `agent-v2-kernel-foundation-e2e` with disposable reset and Station restart authorization.
4. Observe Browser `BASE-APPROVAL_EXPIRED / en / single / sample-001` after `Request again` creates the retry attempt.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | `CancelTurn` does not return a cancelled Turn for the retried attempt. | Medium | Low | The cancellation response status is not `cancelled`. | Pending |
| B | `CancelTurn` cancels the Turn but leaves the new approval ToolCall unresolved. | High | Low | Turn replay is cancelled while the retry ToolCall remains approval-required or expired. | Pending |
| C | Station state is correct but the diagnostic replay readback remains stale. | Medium | Medium | Cancellation response is cancelled while repeated readback never changes or changes only after the timeout. | Pending |
| D | The cancellation targets a different Turn than the retry attempt. | Low | Low | The retry response or cancellation response does not preserve the source Turn identity. | Pending |
| E | The Gate compares a valid cancellation using the wrong enum/status representation. | Low | Low | Raw readback reports cancellation while the normalized predicate remains false. | Pending |

## Log Evidence
- Exact-source run
  `20260905T113943783383Z-00250439a82b1ea43a5390c7353d5ea5`
  on `372e646e7242a72cbe4f0ebf4428708fcf260e6e` crossed Browser AS-F06.
- Approval-expiry post-fix events prove both clicks reached `retryMessage`, the
  matching `recovery_failed` guard allowed retry, the second click reused the
  pending promise, and one RetryTurn response contained Turn, Attempt, and
  Conversation payloads.
- The first failure advanced to `timed out waiting for: approval-expired retry
  cancellation`.
- Provisioner cleanup completed `DONE / PROVEN / passed`.

## Instrumentation
- The Harness records the retry attempt count, retry ToolCall status, and
  approval presence immediately before cancellation.
- The Harness records the `CancelTurn` response status without persisting Turn
  identity.
- If settlement times out, the Harness performs one final diagnostic replay
  read and records the numeric Turn status, both ToolCall statuses, attempt
  count, and approval presence.
- Records exclude actor, conversation, Turn, message, ToolCall, credential,
  content, and endpoint values.

## Verification Conclusion
Pending runtime instrumentation.

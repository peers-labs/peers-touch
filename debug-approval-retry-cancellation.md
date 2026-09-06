# Debug Session: approval-retry-cancellation
- **Status**: [OPEN]
- **Issue**: Browser BASE-APPROVAL_EXPIRED creates exactly one retry attempt and distinct approval, but the scenario times out waiting for the retried Turn and ToolCall to become cancelled.
- **Debug Server**: `http://127.0.0.1:7781/event`
- **Log File**: `.dbg/trae-debug-log-approval-retry-cancellation.ndjson`

## Reproduction Steps
1. Use the approved `chat-native-disposable` profile.
2. Verify the remote Station at `10.37.94.156:18132` is healthy and source-matched.
3. Run `agent-v2-kernel-foundation-e2e` with disposable reset and Station restart authorization.
4. Observe Browser `BASE-APPROVAL_EXPIRED / en / single / sample-001` after `Request again` creates the retry attempt.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | `CancelTurn` does not return a cancelled Turn for the retried attempt. | Confirmed | Low | The cancellation response returned `interrupted`, matching the already-terminal Station Turn. |
| B | `CancelTurn` cancels the Turn but leaves the new approval ToolCall unresolved. | Rejected | Low | The Turn was already interrupted before cancellation; both ToolCalls later settled as expired. |
| C | Station state is correct but the diagnostic replay readback remains stale. | Rejected | Medium | Cancellation response and repeated replay both reported the interrupted Turn state. |
| D | The cancellation targets a different Turn than the retry attempt. | Rejected | Low | Retry uses the source Turn ID by contract, and the cancellation response contained that Turn identity. |
| E | The Gate compares a valid cancellation using the wrong enum/status representation. | Rejected | Low | Raw replay status `14` is `INTERRUPTED`, while the required cancelled status is `13`. |
| F | A blocked ToolBatch from the prior attempt interrupts the new retry because settlement is joined only by Turn ID. | Confirmed | Low | Source inspection found `settleBlockedToolBatches` and reconciliation settlement joined prior work to a waiting Turn without matching the current attempt; the runtime replay showed attempt count `2`, Turn `INTERRUPTED`, and both ToolCalls `EXPIRED`. |

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
- Post-fix exact-source aggregate
  `20260905T144656500100Z-697d09085b429dbe9832fe2545120f4e`
  on `cdf50ddc8b0c4f2f3d6c3d87c8bbc83907dcce87` was interrupted by a
  host reboot at `2026-09-05T23:09:05+08:00` before this probe emitted any
  event. No candidate, run manifest, or cleanup receipt exists, so all five
  hypotheses remain pending.
- Exact-source run
  `20260906T162356921705Z-bd8243d2bcba6f391d2fc537322daad3`
  (aggregate
  `20260906T162356812903Z-a889c51cfaec94beb5738fc35450454f`)
  on `56a46d078c8adfa80c7a55d59792ad8e8e481c6d` passed AS-F01 through
  AS-F12 and advanced to Browser `BASE-APPROVAL-EXPIRED`.
- The retry created exactly one new attempt and one approval-required ToolCall.
  Immediately before cancellation, replay status was
  `WAITING_LOCAL_TOOL`; cancellation returned `interrupted`. At the bounded
  timeout, replay contained two attempts, Turn status `INTERRUPTED`, and both
  the original and retry ToolCalls were `EXPIRED`.
- Source inspection confirmed that blocked ToolBatch and
  reconciliation-required continuation workers selected rows by Turn status
  without requiring the batch's owning attempt to be the latest live attempt.
  A prior attempt's blocked batch could therefore terminalize a newly reopened
  retry that reused the same Turn ID.
- Inner and outer cleanup completed `DONE / PROVEN / passed`.

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
Hypothesis F is confirmed. The failure belongs to Station attempt ownership,
not the Desktop retry action or the Gate oracle. Settlement must operate only
on work owned by the latest open attempt. The local correction joins blocked
batches and reconciliation-required continuations to their owning attempt and
requires that attempt to be open, waiting for a local tool, and latest by
`attempt_index`.

## Local Fix Verification
- Station Agent service tests: PASS.
- Focused Foundation tests: `205/205` PASS.
- Agent native static tests: `69/69` PASS.
- `git diff --check`: PASS.
- Exact-source runtime comparison remains pending.

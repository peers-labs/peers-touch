# Debug Session: approval-expiry-retry
- **Status**: [OPEN]
- **Issue**: Browser BASE-APPROVAL_EXPIRED renders the expired ToolCall recovery action, but Request again does not produce the required single new approval attempt within 120 seconds.
- **Debug Server**: `http://127.0.0.1:7777/event`
- **Log File**: `.dbg/trae-debug-log-approval-expiry-retry.ndjson`

## Reproduction Steps
1. Use the approved `chat-native-disposable` profile.
2. Verify the remote Station at `10.37.94.156:18132` is healthy and source-matched.
3. Run `agent-v2-kernel-foundation-e2e` with disposable reset and Station restart authorization.
4. Observe Browser `BASE-APPROVAL_EXPIRED / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | `retryMessage` silently exits because the Chat store still reports an active stream. | High | Low | Handler entry records `isStreaming=true`; no API-start event follows. | Confirmed: lines 2-3 and 5-6 record `isStreaming=true`, matching `recovery_failed`, then `retry-skipped-streaming`. |
| B | The rendered message is absent from the current Chat store or has no Turn identity. | Medium | Low | Handler entry records no matching message or an empty `turnId`; no API-start event follows. | Rejected: lines 2 and 5 record both source and Turn identity as present. |
| C | RetryTurn is invoked but rejected by conversation-version or source-state validation. | High | Low | API-start is followed by a typed rejection and no new attempt. | Rejected for this run: no `retry-api-start` event was emitted. |
| D | RetryTurn creates one attempt, but the provider does not emit a distinct approval ToolCall. | Medium | Medium | Attempt count increases by one while the new approval count remains zero. | Inconclusive: the client guard prevented the command. |
| E | Both clicks escape the single-flight boundary and create more than one attempt. | Low | Low | Two API-start events or an attempt delta greater than one share the same recovery action. | Rejected for this run: neither click crossed the guard; post-fix evidence must still prove one attempt. |

## Log Evidence
- Exact-source run `20260905T002051494143Z-6a08d7addb66cbb98e56f068d5f3d69f` on `e74e47a2cdc3c5e43264464ffc4c28380f8d2141` failed at Browser `BASE-APPROVAL_EXPIRED / en / single / sample-001`.
- Failure: `timed out waiting for: approval-expired request-again attempt`.
- Inner runtime cleanup and outer Provisioner cleanup both passed; all Native and Browser ports and storage were released.
- Exact-source run
  `20260905T033944336847Z-d9b58bb4bfa09720bc427db17300bb25`
  on `229af39233369388dd729a30e1917416e59f7092` crossed Browser AS-F06
  and reproduced the same `BASE-APPROVAL_EXPIRED` timeout.
- Log lines 1 and 4 prove both recovery clicks reached `ToolCallCard`.
- Log lines 2 and 5 prove the source message and Turn identity were present,
  the matching operation was `recovery_failed`, no retry was already pending,
  and the coarse `isStreaming` projection was still true.
- Log lines 3 and 6 prove both clicks returned at the streaming guard. No
  `retry-api-start`, API result, or typed API error was emitted.
- The aggregate remained `PARTIAL / UNPROVEN`; Provisioner cleanup completed
  `DONE / PROVEN / passed`.

## Instrumentation
- `ToolCallCard.tsx` records entry into the `Request again` click handler.
- `chat.ts` records retry state lookup, guard selection, single-flight reuse, and the typed shape of RetryTurn success or failure.
- Pre-fix records use `runId=pre-fix`; the retained post-fix emitters now use
  `runId=post-fix`. Both exclude actor, conversation, Turn, message, ToolCall,
  credential, content, and endpoint values.

## Fix
- `retryMessage` now keeps the streaming guard for every active operation
  except a `recovery_failed` operation whose Turn identity matches the source
  message.
- The Station remains responsible for validating that the source Turn is
  terminal and retryable.
- The existing `(conversation, message)` single-flight map remains responsible
  for collapsing duplicate clicks into one command.
- Desktop typecheck, 568 tests with one unrelated skip, production build, 198
  focused Foundation/static tests, and `git diff --check` pass.

## Verification Conclusion
Hypothesis A is confirmed. The client-side `retryMessage` guard conflates an
actively executing provider stream with the user-recoverable
`recovery_failed` operation state. The Station remains the authority for
whether the source Turn is terminal and retryable, and the existing
single-flight map remains the duplicate-click fence. The minimal fix is to
allow retry only when the current operation is `recovery_failed` and belongs to
the same source Turn; all other active operations remain blocked. Post-fix
runtime evidence must still prove exactly one attempt and one distinct approval
identity.

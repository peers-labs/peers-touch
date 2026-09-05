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
| A | `retryMessage` silently exits because the Chat store still reports an active stream. | High | Low | Handler entry records `isStreaming=true`; no API-start event follows. | Pending |
| B | The rendered message is absent from the current Chat store or has no Turn identity. | Medium | Low | Handler entry records no matching message or an empty `turnId`; no API-start event follows. | Pending |
| C | RetryTurn is invoked but rejected by conversation-version or source-state validation. | High | Low | API-start is followed by a typed rejection and no new attempt. | Pending |
| D | RetryTurn creates one attempt, but the provider does not emit a distinct approval ToolCall. | Medium | Medium | Attempt count increases by one while the new approval count remains zero. | Pending |
| E | Both clicks escape the single-flight boundary and create more than one attempt. | Low | Low | Two API-start events or an attempt delta greater than one share the same recovery action. | Pending |

## Log Evidence
- Exact-source run `20260905T002051494143Z-6a08d7addb66cbb98e56f068d5f3d69f` on `e74e47a2cdc3c5e43264464ffc4c28380f8d2141` failed at Browser `BASE-APPROVAL_EXPIRED / en / single / sample-001`.
- Failure: `timed out waiting for: approval-expired request-again attempt`.
- Inner runtime cleanup and outer Provisioner cleanup both passed; all Native and Browser ports and storage were released.

## Instrumentation
- `ToolCallCard.tsx` records entry into the `Request again` click handler.
- `chat.ts` records retry state lookup, guard selection, single-flight reuse, and the typed shape of RetryTurn success or failure.
- All records use `runId=pre-fix` and exclude actor, conversation, Turn, message, ToolCall, credential, content, and endpoint values.

## Verification Conclusion
Pending runtime instrumentation.

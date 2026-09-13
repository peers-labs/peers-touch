# Debug Session: revision-retry-cancellation
- **Status**: [OPEN]
- **Issue**: Foundation Browser/en AS-F07 rejects retry because the source revision is not observed as cancelled.
- **Debug Server**: http://127.0.0.1:7783/event
- **Log File**: .dbg/trae-debug-log-revision-retry-cancellation.ndjson

## Reproduction Steps
1. Verify the bound worktree at commit `c3f810b71402003b77f5609093a64e8afbf9d06e`.
2. Use the approved `chat-native-disposable` profile and exact-source Station deployment.
3. Run the unchanged `agent-v2-kernel-foundation-e2e` Gate.
4. Observe Browser/en AS-F07 fail with `agent.acceptance.foundationRevisionRetrySourceNotCancelled`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Retry creates a new revision without sending a real cancellation for the source Turn. | High | Low | Pending |
| B | Cancellation targets the retry Turn or another stale Turn instead of the source Turn. | High | Low | Pending |
| C | Cancellation is requested but retry/readback races durable cancellation persistence. | High | Medium | Pending |
| D | Station cancellation is durable, but Desktop store/DOM retains a stale non-cancelled projection. | Medium | Medium | Pending |
| E | Earlier scenario state causes AS-F07 to select the wrong source branch. | Low | Medium | Pending |

## Log Evidence
- Exact-source Foundation run `20260913T042142348444Z-eb87e91f49f4bd1a69e307b459c7441c` failed first at Browser/en AS-F07.
- Source commit was `c3f810b71402003b77f5609093a64e8afbf9d06e`; cleanup was `DONE / PROVEN / passed`.
- The same run crossed all AS-F06 Browser/Desktop and en/zh-CN tuples before AS-F07.

## Instrumentation
- `scenario-started`: verifies a clean AS-F07 tuple entered the producer.
- `retry-source-cancel-requested`: records provider admission and cancel dispatch.
- `retry-source-cancel-response`: records canonical status/type, response shape,
  and whether the returned Turn matches the requested source Turn.
- Existing downstream checkpoints retain stream terminal, durable attempt,
  retry, regenerate, edit, branch, and cleanup evidence when cancellation is
  canonical.

## Verification Conclusion
Pending pre-fix instrumentation.

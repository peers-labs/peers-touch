# Debug Session: foundation-queue-capacity
- **Status**: [OPEN]
- **Issue**: Exact-source Foundation Browser AS-F02 zh-CN fails with `agent.acceptance.queueCapacitySnapshotMismatch` before the eight-entry Station queue snapshot is captured.
- **Debug Server**: http://127.0.0.1:7786/event
- **Log File**: `.dbg/trae-debug-log-foundation-queue-capacity.ndjson`

## Reproduction Steps
1. Verify the immutable `peers-ai-agent` worktree binding at checkpoint `3965d47da1bc3e8a80715dd1840a069847d9f1cd`.
2. Use the authorized `chat-native-disposable` profile and exact-source Station at `http://10.37.94.156:18132`.
3. Run the complete serial Foundation Gate without changing assertions or timeouts.
4. Observe Browser `AS-F02 / zh-CN / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The active Turn becomes terminal before the capacity snapshot, allowing Station to drain the queue below eight. | High | Low | Confirmed for the failing zh-CN tuple: `done` preceded queued submission, the first read was seven, and the queue drained to zero. |
| B | Awaiting queued stream results delays the snapshot until after queue drain begins. | High | Low | Confirmed at the earlier duplicate-result await boundary: the fast active Turn completed before the eight follow-ups were started. |
| C | Station reports a queue capacity other than eight for this conversation. | Medium | Low | Rejected: both tuples reported authoritative capacity eight. |
| D | One or more queued submissions are rejected before admission. | Medium | Low | Rejected: all eight submissions succeeded; one became active after the original Turn completed. |
| E | Conversation cleanup or selection drift makes the readback target differ from the created queue conversation. | Low | Low | Rejected: both tuples retained the selected conversation. |

## Log Evidence
- Existing exact-source Gate evidence:
  - Aggregate run `20260905T204138299751Z-0c94dd3d4794901925923f99259fe4a2`.
  - Gate run `20260905T204138408664Z-69dcf0a120403deccd4ba66aefe1c9a0`.
  - Source and live Station both identify `3965d47da1bc3e8a80715dd1840a069847d9f1cd` with clean workspace digests.
  - Browser `AS-F02 / zh-CN / single / sample-001` failed with `agent.acceptance.queueCapacitySnapshotMismatch`.
  - Inner and outer cleanup passed.
- Pre-fix instrumentation points:
  - `active-first-event`: active-stream phase and selected-conversation equality.
  - `queued-submissions-started`: submission count and events already observed.
  - `queued-results-settled`: settlement status, safe error codes, event types, and queue positions.
  - `queue-capacity-sampled`: authoritative queue size/capacity/positions, bounded poll statistics, active event types, overflow result, and selected-conversation equality.
- Pre-fix run `20260905T214027259590Z-8a11e2ddc9dccfce48c4e62d723e2e35`:
  - English AS-F02 sampled `8/8` while the active Turn had no terminal event.
  - Simplified Chinese AS-F02 observed the active Turn `done` before queued submissions started.
  - All eight submissions succeeded, but one was executed immediately; the first queue read was seven and the queue drained to zero during the unchanged 30-second window.
  - The supposed overflow request also executed successfully because capacity was no longer full.
  - Station capacity remained eight and the selected conversation remained correct.

## Verification Conclusion
The Harness awaited duplicate stream completion before it launched the queue workload. A fast provider response could therefore finish the active Turn and release dequeue before the eight queue requests existed. The queue and oracle behaved correctly; the Acceptance action ordering was nondeterministic. The minimal correction is to launch the duplicate and all eight queue requests while the original Turn is active, capture the strict Station `8/8` snapshot, and only then submit the overflow request and await stream completion.

## Fix
- Capture the empty queue baseline before starting duplicate replay.
- Start duplicate replay and all eight unique queue submissions without awaiting duplicate completion.
- Poll the authoritative Station queue to the unchanged strict `8/8` condition.
- Submit the overflow request only after the full-capacity snapshot exists.
- Await duplicate, queued, and overflow results after their ordering-sensitive actions have been issued.
- Preserve the existing queue-capacity, FIFO, overflow, cancellation, DOM, and lifecycle assertions.

## Local Verification
- `python3 -m unittest tooling.acceptance.gates.agent.agent_native_static_test`: 69/69 passed.
- `cd apps/desktop && pnpm run check`: passed.
- `cd apps/desktop && pnpm run test`: 569 passed, one unrelated environment-dependent test skipped.
- `git diff --check`: passed.
- Post-fix exact-source runtime comparison: pending.

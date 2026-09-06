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
| A | The active Turn becomes terminal before the capacity snapshot, allowing Station to drain the queue below eight. | High | Low | Confirmed again for the post-fix zh-CN tuple: the first read was seven, `done` arrived while polling, and the queue drained to zero. |
| B | Starting eight queue streams concurrently does not prove that all eight admissions have completed before queue readback. | High | Low | Confirmed: the post-fix zh-CN tuple started all eight with zero observed events, but the first Station readback contained only seven entries and never reached eight. |
| C | Station reports a queue capacity other than eight for this conversation. | Medium | Low | Rejected: both tuples reported authoritative capacity eight. |
| D | One queued request is delayed in Browser dispatch, Gateway forwarding, or Station admission until the active Turn completes. | High | Medium | Pending: record each queue index's first event/result and Gateway stream-proxy arrival/admission timing. Existing Gateway command diagnostics reject general worker-pool saturation because queue-list had zero worker wait. |
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
- First post-fix run
  `20260905T234558072900Z-17f15e201c317c1bb83b69190eab7734`
  (aggregate
  `20260905T234557952732Z-40da1f8ecf9e59e5ded0fae1a0840974`)
  on `b10bb73e41aa6069ef707f6f2b6698a7d0e964de`:
  - English AS-F02 sampled `8/8` in 689 ms with FIFO positions `1..8`;
    duplicate replay returned `admission_replayed`, and the overflow request
    returned `ADMISSION_QUEUE_FULL`.
  - Simplified Chinese AS-F02 started all eight submissions with zero observed
    events, but the first queue read returned seven. The unchanged 30-second
    poll never observed eight, the active Turn emitted `done`, and the queue
    drained to zero.
  - Gateway command diagnostics recorded zero queue wait for every
    `agent_turn_queue_list` dispatch, rejecting a saturated Rust worker pool.
  - The remaining unknown is which queue index is delayed and whether it
    reaches the Gateway before the active Turn finishes.
  - Outer Provisioner cleanup completed `DONE / PROVEN / passed`, but inner
    Browser logout timed out. Ports, storage, and actor identity were still
    released. Cleanup is therefore not globally passed.

## Verification Conclusion
The original duplicate-result wait was one race, but removing it was
insufficient. Concurrent stream construction still does not establish eight
completed admissions before readback. The next evidence pass must identify the
delayed queue index and its Browser -> Gateway -> Station boundary before a
second behavioral correction.

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
- First post-fix exact-source runtime comparison: English passed the queue
  boundary; Simplified Chinese remained `7/8`; further instrumentation is
  required before another fix.

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
| A | The active Turn becomes terminal before the capacity snapshot, allowing Station to drain the queue below eight. | High | Low | Confirmed again on `3d6435d82`: the active stream completed 142 ms after queue launch, the first read was seven, and the queue drained to zero. |
| B | Waiting for the active Turn's first provider event consumes the admission window before the eight queue requests are launched. | High | Low | Confirmed on `3d6435d82`: upstream admission completed at 132 ms, the first provider event arrived at 1,404 ms, and queue launch followed at 1,511 ms. |
| C | Station reports a queue capacity other than eight for this conversation. | Medium | Low | Rejected: both tuples reported authoritative capacity eight. |
| D | Gateway worker queueing is the primary delay. | Medium | Medium | Rejected: all queue requests entered the Gateway together with `queueWaitMs=0`; the active Turn's remaining provider lifetime was already only 142 ms. |
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
- Post-instrumentation exact-source run
  `20260906T023932273619Z-9996d0d9df800ffb67685cc1635aabb3`
  (aggregate
  `20260906T023932171556Z-a13d704b7b75842d85ce918b4e0da535`)
  on `7f7fc29de455905285fb688c830a0b7a17130cd1`:
  - Both English and Simplified Chinese Browser tuples sampled strict `8/8`
    with authoritative capacity eight and FIFO positions `1..8`.
  - Every queue index reached the Gateway, completed Station admission, and
    returned `queued` while the active Turn remained non-terminal.
  - Both overflow requests returned `ADMISSION_QUEUE_FULL`.
  - Inner runtime cleanup was `clean`; outer Provisioner cleanup completed
    `DONE / PROVEN / passed`.
  - The Gate advanced to Browser AS-F06, so no remaining AS-F02 failure was
    observed in this exact-source comparison.
- Exact-source run
  `20260906T072618510941Z-4a3cd80ddc3239e5ea0f06069f471c48`
  (aggregate
  `20260906T072618388474Z-42e1e9e034d39801f131a1c21c175fc0`)
  on `3d6435d825ff389f754b51cacede41df025928fa`:
  - Runtime and Station source identity matched and both runtime clients
    launched.
  - Browser AS-F02 started its active request at `1788680447555`; Gateway
    completed upstream admission 132 ms later.
  - The Harness waited until the first provider event at
    `1788680448959`, then launched the duplicate and eight queue requests
    at `1788680449066`.
  - The active stream completed at `1788680449208`, only 142 ms after queue
    launch. Later admissions therefore ran immediately instead of remaining
    queued.
  - The authoritative queue reached only `7/8` and drained to zero during the
    unchanged 30-second observation window.
  - Inner runtime cleanup and outer Provisioner cleanup both passed.

## Verification Conclusion
The original duplicate-result wait exposed one action-ordering race, but the
subsequent correction still waited for the provider's first SSE event before
launching queue admissions. Provider output duration is not a valid queue-hold
primitive: on `3d6435d82` that wait consumed all but 142 ms of the active
Turn's lifetime. The admission requests must be issued immediately after the
active stream request is initiated, before awaiting provider output. The
session remains `[OPEN]` because post-fix exact-source comparison and explicit
cleanup confirmation are still required.

## Fix
- Capture the empty queue baseline before starting the active request.
- Start the active request, duplicate replay, and all eight unique queue
  submissions without first awaiting provider output.
- Await the active first event only after all admission requests are in flight.
- Poll the authoritative Station queue to the unchanged strict `8/8` condition.
- Submit the overflow request only after the full-capacity snapshot exists.
- Await duplicate, queued, and overflow results after their ordering-sensitive actions have been issued.
- Preserve the existing queue-capacity, FIFO, overflow, cancellation, DOM, and lifecycle assertions.

## Local Verification
- `python3 -m unittest tooling.acceptance.gates.agent.agent_native_static_test`: 69/69 passed.
- `python3 -m unittest tooling.acceptance.gates.agent.agent_native_static_test tooling.acceptance.gates.agent.foundation_group_one_probe_test`: 82/82 passed after moving queue launch ahead of the first-provider-event wait.
- `cd apps/desktop && pnpm run check`: passed.
- `cd apps/desktop && pnpm run test`: 569 passed, one unrelated environment-dependent test skipped.
- `git diff --check`: passed.
- Post-instrumentation exact-source runtime comparison: English and Simplified
  Chinese both passed strict `8/8`, FIFO `1..8`, and
  `ADMISSION_QUEUE_FULL`; the Gate advanced to AS-F06.
- The revised admission ordering has local verification only; exact-source
  runtime comparison is pending.

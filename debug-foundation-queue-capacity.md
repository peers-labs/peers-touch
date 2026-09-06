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
| F | Launching the duplicate before the original request has a Station admission can let the duplicate win the shared idempotency key. | High | Low | Confirmed on `abc010684`: the second locale reached strict `8/8`, but the designated active observer received only `admission_replayed` while the duplicate observer carried the real active stream. |
| G | A queued Turn is admitted during post-cancellation cleanup and mutates the conversation between the source and replay readbacks. | High | Low | Consistent with the `6de266738` failure; the next run records only readback hashes, versions, message counts/statuses, and final queue size to confirm or reject it. |

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
- Exact-source run
  `20260906T075340212678Z-e65b29d46b4b615d3c557af76475a37b`
  (aggregate
  `20260906T075340099875Z-da9fc494b2a14391f7e00ca19e7f1f40`)
  on `abc0106849d2f1d65fcd6991d13a3e659ed342ab`:
  - Both Browser locale tuples reached strict `8/8` with FIFO positions
    `1..8`, and both overflow requests returned `ADMISSION_QUEUE_FULL`.
  - The second tuple launched the original and duplicate requests in the same
    scheduling turn. The designated active observer received
    `admission_replayed` at 159 ms while the duplicate observer owned the live
    provider stream.
  - The Gate therefore failed at
    `agent.acceptance.foundationActiveTurnCancelMissing`; this is a deterministic
    idempotency-owner race, not a queue-capacity failure.
  - Inner runtime cleanup and outer Provisioner cleanup both passed.
- Exact-source run
  `20260906T084510093935Z-79cae3d5fd697244387d637f16143fac`
  (aggregate
  `20260906T084509966139Z-9044fe74d9918f36e41ec42b35f99c01`)
  on `b799410e00d0ce0bcc40a0bb02f101bf8670fa3a`:
  - The Station admission barrier completed at 137 ms and the original active
    observer received the live `progress` event.
  - Browser AS-F02 reached strict `8/8`, FIFO positions `1..8`, duplicate
    `admission_replayed`, and overflow `ADMISSION_QUEUE_FULL`.
  - The active provider stream completed naturally at 1,240 ms while the
    Harness performed receiver/dependency checks and cancelled the entire
    pending queue before requesting active cancellation.
  - The Gate failed closed with
    `agent.acceptance.foundationActiveTurnCancelRejected`.
  - Inner runtime cleanup and outer Provisioner cleanup both passed.
- Exact-source run
  `20260906T092327804315Z-110a210664701b15a8495ad6120ea9c2`
  (aggregate
  `20260906T092327677006Z-ede0d99faab81d07650e89953bea06a7`)
  on `6de2667380f7dc9096be5433f8adf1ab46d09b2f`:
  - The admission barrier completed at 572 ms and the queue reached strict
    `8/8` with FIFO positions `1..8`.
  - Overflow returned `ADMISSION_QUEUE_FULL`.
  - Active cancellation was requested at 1,429 ms and returned authoritative
    `cancelled` at 1,566 ms; the observed stream ended with one `cancelled`
    terminal event.
  - The Gate advanced past all AS-F02 production assertions but failed the
    generic replay equality check with `AS-F02: replay differs from source`.
  - Inner runtime cleanup and outer Provisioner cleanup both passed.
- Exact-source run
  `20260906T084510093935Z-79cae3d5fd697244387d637f16143fac`
  (aggregate
  `20260906T084509966139Z-9044fe74d9918f36e41ec42b35f99c01`)
  on `b799410e00d0ce0bcc40a0bb02f101bf8670fa3a`:
  - The Station conversation-version barrier observed the original active
    admission in 137 ms before any duplicate or queue request was launched.
  - Browser AS-F02 reached strict `8/8`, FIFO positions `1..8`, and
    `ADMISSION_QUEUE_FULL`; the duplicate correctly returned
    `admission_replayed`.
  - The active stream nevertheless completed naturally at 1,240 ms while the
    Harness performed receiver/dependency checks and cancelled the full queue
    before requesting active cancellation. The cancellation response was no
    longer `cancelled`, so the Harness failed closed with
    `agent.acceptance.foundationActiveTurnCancelRejected`.
  - Inner runtime cleanup and outer Provisioner cleanup both passed.

## Verification Conclusion
The admission barrier removed the idempotency-owner race and kept the strict
queue proof intact. The remaining failure was caused by doing all residual
queue cleanup before active cancellation, allowing a fast real provider to
finish naturally. Queue visibility, overflow, and active-dependency checks can
run concurrently after the capacity snapshot. The Harness can then cancel one
queued entry for the required queue-control assertion, cancel the active Turn,
and only afterward clean the residual queue. That ordering now succeeds, but
the final two readbacks differ, consistent with one residual queued Turn being
admitted during cleanup. The next run records bounded readback versions,
message counts/statuses, hashes, and final queue size to identify the changing
source without exposing content or identifiers. The session remains `[OPEN]`
because post-fix exact-source comparison and explicit cleanup confirmation are
still required.

## Fix
- Capture the empty queue baseline before starting the active request.
- Start the active request and wait only for the Station-authored conversation
  version to advance, proving that request owns the active admission.
- Start duplicate replay and all eight unique queue submissions immediately
  after that admission barrier, without first awaiting provider output.
- Await the active first event only after all admission requests are in flight.
- Poll the authoritative Station queue to the unchanged strict `8/8` condition.
- Submit the overflow request only after the full-capacity snapshot exists.
- Capture receiver visibility, overflow rejection, and active-dependency
  rejection concurrently while the queue is full.
- Cancel one queued entry for the queue-control assertion, cancel the active
  Turn immediately, then clean the residual queue.
- Record a bounded final readback comparison to distinguish residual Turn
  settlement from hash normalization without changing the equality predicate.
- Await active, duplicate, queued, and overflow results after their
  ordering-sensitive actions have been issued.
- Preserve the existing queue-capacity, FIFO, overflow, cancellation, DOM, and lifecycle assertions.

## Local Verification
- `python3 -m unittest tooling.acceptance.gates.agent.agent_native_static_test`: 69/69 passed.
- `python3 -m unittest tooling.acceptance.gates.agent.agent_native_static_test tooling.acceptance.gates.agent.foundation_group_one_probe_test`: 82/82 passed after adding the admission barrier and moving active cancellation ahead of residual queue cleanup.
- `cd apps/desktop && pnpm run check`: passed.
- `cd apps/desktop && pnpm run test`: 569 passed, one unrelated environment-dependent test skipped.
- `git diff --check`: passed.
- Post-instrumentation exact-source runtime comparison: English and Simplified
  Chinese both passed strict `8/8`, FIFO `1..8`, and
  `ADMISSION_QUEUE_FULL`; the Gate advanced to AS-F06.
- The revised admission and cancellation ordering has local verification only;
  exact-source runtime comparison is pending.

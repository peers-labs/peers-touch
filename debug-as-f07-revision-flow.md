# Debug Session: as-f07-revision-flow
- **Status**: [OPEN]
- **Issue**: The first exact-source AS-F07 production scenario times out with
  `agent.acceptance.turnSubmissionTimeout` before emitting independently
  evaluated revision evidence.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-as-f07-revision-flow.ndjson

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`, profile `two`.
2. Deploy Station and build the Acceptance Desktop binary from the same clean
   source commit.
3. Run `agent-v2-kernel-foundation-e2e` with
   `PT_AGENT_V2_ALLOW_STATION_RESTART=1`.
4. Observe the first Browser AS-F07 tuple.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | The cancellable retry-source turn never emits a text event before its 120-second deadline | High | Low | The last checkpoint is `retry-source-started`, with no `retry-source-cancel-requested` |
| B | The retry-source cancellation is acknowledged but its stream never emits terminal cancellation | Medium | Low | Cancellation response is recorded, but `retry-source-finished` is absent |
| C | The completed baseline turn exceeds the generic 120-second turn deadline | Medium | Low | Retry completes and the last checkpoint is `baseline-started` |
| D | A synchronous retry/regenerate/edit command blocks while executing its provider turn | Medium | Low | The last checkpoint is immediately before one revision command |
| E | Branch selection or receiver projection blocks after all revision commands complete | Low | Low | Edit completes and the last checkpoint is branch-selection or DOM wait |

## Instrumentation
- Record one redacted stage checkpoint before and after each AS-F07 production
  action.
- Record only stage name, elapsed time, terminal event type, sequence, and
  presence/count facts. Do not record content, actor identity, credentials, or
  tokens.

## Log Evidence
- Exact-source run
  `20260830T085407159167Z-7d59eb27f0e0e3b9a727cdbc9fa93c95`
  reached Browser AS-F07 after all AS-F06 tuples passed, then failed with
  `agent.acceptance.turnSubmissionTimeout`.
- The failure did not identify which of the two observed turns timed out.
- Exact-source run
  `20260830T092128791528Z-9a9c827e6d32f6b854cb103f7e29d6d8`
  used clean source, deployed Station, and Desktop commit
  `4fc6bcd5645c6c3a8587f822e4ea8a0fbf6ba4b7`.
- `.dbg/trae-debug-log-as-f07-revision-flow.ndjson` lines 1-3 show that
  Browser AS-F07 started, requested cancellation after the first text event
  at 2361 ms / sequence 3, and observed a `cancelled` terminal event at
  3092 ms.
- The immutable Gate log then failed at `agent_retry_turn failed`; no
  `retry-finished` checkpoint was emitted.
- Exact-source rerun
  `20260830T105006501570Z-9ea71a2d66bc221db156d1ea3dc3c69d`
  passed AS-F05 and AS-F06, entered Browser AS-F07, and emitted only
  `scenario-started` before `agent.acceptance.turnSubmissionTimeout`.
  No `retry-source-cancel-requested` event was emitted.

## Verification Conclusion
- Hypothesis A is confirmed as nondeterministic: one run emitted cancellable
  text in 2361 ms, while the next source-matched run emitted no text within
  120 seconds.
- Hypothesis B is rejected: cancellation reached a terminal `cancelled` event.
- Hypothesis C is not reached.
- Hypothesis D is confirmed at the first retry command, but its owning
  Station/transport error is not yet identified.
- Hypothesis E is not reached.
- The fixture must not use external provider first-token latency as the
  cancellation boundary. The next implementation cancels on the durable
  `provider_call_started` progress event, which is emitted after source user
  message persistence, while preserving the real provider, cancellation, and
  retry paths. Typed retry error instrumentation remains active.

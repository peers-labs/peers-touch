# Debug Session: incompatible-capability-turn-count
- **Status**: [OPEN]
- **Issue**: Browser BASE-INCOMPATIBLE_CAPABILITY receives a source-bound typed rejection, but the independent oracle rejects `station.turnDelta=0` where the accepted plan requires one failed Turn.
- **Debug Server**: `http://10.4.55.179:7791/event`
- **Log File**: `.dbg/trae-debug-log-incompatible-capability-turn-count.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile and exact-source Station.
2. Run C08 and require `DONE / PROVEN`.
3. Run the unchanged `agent-v2-kernel-foundation-e2e`.
4. Observe Browser `BASE-INCOMPATIBLE_CAPABILITY / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | Station persists the rejected Turn, but `listAgentTurnTraces` excludes it because no trace row exists. | High | Low | Source SSE has a Turn ID and diagnostic replay is available while trace total remains unchanged. | Pending |
| B | Station emits the typed pre-admission error without persisting the plan-required failed Turn. | Medium | Low | Source SSE has a Turn ID, diagnostic replay is unavailable, and trace total remains unchanged. | Pending |
| C | The trace row exists but the Agent/conversation filters or pagination exclude it. | Medium | Low | Unfiltered or direct diagnostic readback finds the trace while the filtered snapshot count stays unchanged. | Pending |
| D | The after snapshot races asynchronous trace persistence. | Medium | Low | Immediate count is unchanged, then a bounded diagnostic/readback shows the row without any retry or new command. | Pending |

## Instrumentation Plan
- Record before/after trace totals and entry counts.
- Record whether the source Turn has direct diagnostic replay, a persisted
  status, attempt count, runtime snapshot, and trace payload.
- Record no actor, Agent, conversation, Turn, message, provider credential, or
  payload identifiers.

## Instrumentation
- `runFoundationIncompatibleCapabilityScenario` performs read-only
  `getAgentTurnTrace` and diagnostic-export calls after the rejected response.
- The reporter records before/after trace counts, direct trace/Turn/payload
  presence, diagnostic replay status, attempt count, runtime-snapshot
  presence, and normalized read errors.
- These observations do not feed scenario facts or change the strict
  `turnDelta === 1` assertion.

## Log Evidence
- Exact-source C08 run
  `20260911T200746805524Z-bbc4c4a8ae77900f39b01ab5a8d7c737`
  on `08804b583c033f3405eb9496d24a85545e270cc9` is
  `DONE / PROVEN`, 19/19, with clean cleanup.
- Foundation run
  `20260911T200947839067Z-84a957de981a94b0b2fc02210b09fe67`
  reached Browser `BASE-INCOMPATIBLE_CAPABILITY / en / single / sample-001`
  and failed because `turnDelta` was not positive.
- Existing telemetry proves stale-provider reset, provider precondition,
  conversation/binding/Agent/provider cleanup, selection restore, and outer
  Provisioner cleanup all completed.

## Verification Conclusion
Pending pre-fix instrumentation.

## Local Verification
- Desktop strict check: PASS.
- Focused Foundation static/oracle tests: `234/234` PASS.
- `git diff --check`: PASS.

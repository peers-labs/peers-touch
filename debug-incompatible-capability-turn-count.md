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
| A | Station persists the rejected Turn, but `listAgentTurnTraces` excludes it because no trace row exists. | High | Low | Source SSE has a Turn ID and diagnostic replay is available while trace total remains unchanged. | Confirmed. |
| B | Station emits the typed pre-admission error without persisting the plan-required failed Turn. | Medium | Low | Source SSE has a Turn ID, diagnostic replay is unavailable, and trace total remains unchanged. | Rejected. |
| C | The trace row exists but the Agent/conversation filters or pagination exclude it. | Medium | Low | Unfiltered or direct diagnostic readback finds the trace while the filtered snapshot count stays unchanged. | Rejected: direct trace lookup is unavailable. |
| D | The after snapshot races asynchronous trace persistence. | Medium | Low | Immediate count is unchanged, then a bounded diagnostic/readback shows the row without any retry or new command. | Rejected by the persisted contract and direct replay shape. |

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
- Diagnostic exact-source Foundation run
  `20260911T205909121513Z-22bd370b1d423b0fd40e435aca4200d2`
  on `8d798aa8e49455566972a34070eac94b532c2b7d` reproduced the same
  Browser English failure.
- The turn-count boundary recorded trace totals `0 -> 0`. Direct trace lookup
  was unavailable, while source-bound diagnostic replay was available with
  status `FAILED(12)`, exactly one Attempt, and a persisted runtime snapshot.
- Station's focused runtime-authority regression already requires one failed
  `AgentTurn`, one failed `TurnAttempt`, one typed error event, one readiness
  snapshot, zero messages, zero ToolCalls/ToolBatches, and no TurnTrace row for
  this pre-provider rejection.

## Verification Conclusion
Hypothesis A is confirmed. Station persists the accepted failed-Turn contract,
and diagnostic export reconstructs it without requiring an
`agent_turn_traces` row. The Acceptance producer incorrectly equates trace-list
membership with Turn existence. The minimal correction must count the strict
union of trace-list Turns and the source-bound diagnostic Turn, while retaining
the exact-one Turn assertion and zero provider/tool/side-effect assertions.

## Fix
- The producer keeps the trace-list delta unchanged.
- It contributes one diagnostic Turn only when the source-bound replay is
  `FAILED`, has exactly one Attempt, and that Attempt retains its runtime
  snapshot.
- `Math.max(traceDelta, diagnosticRejectedTurnCount)` models the strict union:
  a future trace row does not double count the same rejected Turn, while extra
  trace rows still make the exact-one oracle fail.
- The post-fix reporter records both source counts and the projected delta.

## Local Verification
- Desktop strict check: PASS.
- Focused Foundation static/oracle tests: `234/234` PASS.
- `git diff --check`: PASS.
- Exact-source C08 run
  `20260911T214403167521Z-884c868de07aec4a5a91ad6c44d8cbc6`
  on `040912bcabad6eb67db15fda2d37c5d7066da0dc` passed
  `DONE / PROVEN` with 19/19 assertions and clean cleanup.
- Foundation run
  `20260911T214508595389Z-0e79b626b70d9158805ecc8382e7e54e`
  crossed BASE-INCOMPATIBLE_CAPABILITY and failed later at Browser
  Simplified Chinese BASE-CONTEXT-OVERFLOW. This runtime progression confirms
  the strict Turn-union correction without weakening the independent oracle.
- Exact-source run
  `20260911T231733779911Z-ca94e3b2c6d9c4870f95d3ddabee4c02`
  on `43f94f5ef0838dd51ea458857e4f025ce135559a` again recorded
  `tracedTurnDelta=0`, `diagnosticRejectedTurnCount=1`, and
  `projectedTurnDelta=1`. The only failed assertions were the separate
  readiness and cleanup contracts, so the Turn-union correction remains
  runtime-proven.

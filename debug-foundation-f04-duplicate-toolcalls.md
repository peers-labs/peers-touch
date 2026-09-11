# Debug Session: foundation-f04-duplicate-toolcalls
- **Status**: [OPEN]
- **Issue**: Browser AS-F04 auto policy requests one `skills_list` ToolCall, but the exact-source Foundation run persists two same-batch ToolCalls and times out on the strict exact-one settlement predicate.
- **Debug Server**: `http://10.4.55.179:7790/event`
- **Log File**: `.dbg/trae-debug-log-foundation-f04-duplicate-toolcalls.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile with the canonical Ark model and internal `/api/v3` endpoint.
2. Verify local source, deployed Station, and the dedicated Acceptance binary are source-matched.
3. Run C08, then the unchanged `agent-v2-kernel-foundation-e2e`.
4. Observe Browser `AS-F04 / zh-CN / single / sample-001` auto-policy settlement.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | The OpenAI-compatible request omits `parallel_tool_calls`, so Ark may legally return multiple calls despite prompt-only “exactly once” steering. | High | Low | Request evidence reports tools present and no explicit parallel policy; response reports two ToolCall indices. | Confirmed for the request omission; the two-call response did not recur. |
| B | The Ark stream emits one logical ToolCall, but the stream assembler incorrectly creates two calls from repeated fragments. | Medium | Low | Raw safe index sequence contains one index while the assembled response count is two. | Rejected for every observed response; prior failing response remains unobserved at this boundary. |
| C | The pinned runtime snapshot already contains a sequential policy that is lost before provider dispatch. | Medium | Low | Runtime policy reports parallel disabled while request evidence reports the field omitted or enabled. | Rejected: the pinned model capability is `parallelTools=true`. |
| D | The provider returns two valid independent calls because the pinned model advertises parallel ToolCalls, exposing a missing per-turn sequential-tool contract for AS-F04. | High | Medium | Snapshot reports parallel support, request uses provider default/parallel enabled, raw indices are distinct, and both calls persist. | Supported by the prior two-row Station evidence and current request facts; exact two-index response has not recurred. |

## Instrumentation Plan
- Record whether a tool-bearing OpenAI-compatible request includes an explicit
  `parallel_tool_calls` field and its boolean value.
- Record only the distinct provider ToolCall indices and assembled ToolCall
  count at stream completion.
- Record the pinned runtime parallel capability at the Turn/provider boundary.
- Do not record prompts, arguments, ToolCall IDs, actor identity, credentials,
  or endpoint secrets.

## Instrumentation
- `turn_service.go:callProviderWithRuntimeAuthority` records the pinned
  `native_tools` and `parallel_tools` capability booleans for Ark requests
  carrying Tool definitions.
- `provider_service.go:callOpenAIStream` records Tool-definition count and
  whether the Ark request contains an explicit `parallel_tool_calls` policy.
- The stream assembler records distinct ToolCall indices, fragment counts per
  index, assembled ToolCall count, and finish reason.
- The reporter is limited to the canonical internal Ark endpoint and excludes
  prompts, arguments, IDs, identity, credentials, and response content.

## Log Evidence
- Exact-source C08 run
  `20260911T193922706008Z-2ba9a5841230120cf3b3a7f8051ff14a`
  on `546b6058c312adefd3f646cda152ef81bb91e1f9` passed
  `DONE / PROVEN` with 19/19 assertions and clean cleanup.
- The unchanged Foundation run
  `20260911T194053654495Z-418a8fadbb819a6c415d575dbc98c314`
  failed first at Browser `AS-F04 / zh-CN / single / sample-001`.
- Station readback showed one completed Turn, one provider attempt, one
  ToolBatch, two different ToolCall rows for `skills_list`, one execution per
  row, two persisted results, and one batch continuation.
- The strict `facts.length === 1` predicate is unchanged and must not be
  weakened.
- Instrumented exact-source Foundation run
  `20260911T200947839067Z-84a957de981a94b0b2fc02210b09fe67`
  on `08804b583c033f3405eb9496d24a85545e270cc9` crossed AS-F04.
- The retained log contains 28 pinned-authority observations, 28 request
  observations, and 26 completed response observations. Every request had one
  Tool definition, `parallelTools=true`, and no explicit
  `parallel_tool_calls` policy. Twenty-two responses assembled exactly one
  ToolCall at provider index `0`; four continuation responses assembled zero.
  No response assembled two calls in this run.
- The Gate later failed independently at Browser
  `BASE-INCOMPATIBLE_CAPABILITY / en / single / sample-001`; outer cleanup
  passed.

## Verification Conclusion
The current stream assembler preserves one logical provider index as one
ToolCall and did not duplicate repeated fragments. The request-policy omission
is confirmed, and the runtime advertises parallel ToolCall support, so a
blanket `parallel_tool_calls=false` would contradict the accepted multi-call
path. The prior two-call failure therefore exposes nondeterministic provider
cardinality plus a missing explicit per-turn sequential-tool control. No
runtime or Gate behavior is changed from this evidence alone.

## Local Verification
- Focused Station provider/runtime-authority tests: PASS.
- `git diff --check`: PASS.

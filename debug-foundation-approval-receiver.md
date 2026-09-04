# Debug Session: foundation-approval-receiver
- **Status**: [OPEN]
- **Issue**: Browser BASE-APPROVAL-DENIED observes a Tool approval event but times out waiting for the corresponding ToolCall receiver.
- **Debug Server**: `http://127.0.0.1:7782/event`
- **Log File**: `.dbg/trae-debug-log-foundation-approval-receiver.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile with its local provider overlay.
2. Verify the Station is remote, healthy, and source-matched.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable reset and Station restart envelope.
4. Observe Browser `BASE-APPROVAL-DENIED / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Selecting the new conversation after the Turn starts drops the earlier ToolCall event from the Chat store. | High | Low | Confirmed as the initial condition, but not the terminal failure: approval observation found Station membership while the Chat store was still missing the ToolCall; authoritative sync later repaired Chat-store membership. |
| B | Periodic authoritative message refresh removes a pending ToolCall-only local projection before Station persists an equivalent message. | High | Low | Rejected: the timeout snapshot retained the expected ToolCall in the Chat store after authoritative sync. |
| C | The tool runtime receives the approval proposal while the Chat message projection does not. | Medium | Low | Rejected as stated. The inverse occurred: Chat-store membership became true while `toolRuntime` remained missing. This confirms the missing Station-snapshot reconciliation path in the `agent-tool` runtime. |
| D | The matching ToolCall exists in the DOM but is hidden or collapsed. | Low | Low | Confirmed as a receiver-surface contributor: the ToolCall group remained collapsed, so no `[data-pt-agent-tool-call]` row was mounted even after Chat-store membership became true. |
| E | The approval event and rendered ToolCall use different IDs. | Low | Medium | Rejected: the expected ToolCall matched both Station and Chat-store records at timeout. |

## Log Evidence
- Exact-source run `20260904T171932940301Z-1ffb7349f89aa4d4977ac5235a458a6d`
  on `7562b002327821c70296cba42214f4eedb0f5291` passed the earlier
  Foundation core path and failed at Browser
  `BASE-APPROVAL-DENIED / en / single / sample-001` while waiting for the
  receiver ToolCall element.
- Provisioning reached `FIXTURE_READY`; source identity matched; provisioner
  cleanup completed `DONE / PROVEN / passed`.
- Exact-source diagnostic run
  `20260904T181345411289Z-d1a3ea858238237e0e5fa14bbfa31d58`
  on `490d758a6dbdd447880fc78e3e70efb3500ab824` reproduced the same
  Browser receiver timeout.
- At approval observation, log line 228 recorded:
  `currentSessionMatches=true`, `expectedToolCallInStation=true`,
  `expectedToolCallInStore=false`, `runtimeProjectionPresent=false`, and
  `expectedToolCallInDom=false`.
- At receiver timeout, log line 234 recorded:
  `expectedToolCallInStation=true`, `expectedToolCallInStore=true`,
  `runtimeProjectionPresent=false`, `renderedToolCallCount=0`, and
  `expectedToolCallInDom=false`.
- The run therefore proves that authoritative message reconciliation repairs
  Chat-store membership but does not reconcile the `agent-tool` runtime, while
  the collapsed ToolCall block keeps the actionable receiver row unmounted.
- Provisioner cleanup completed `DONE / PROVEN / passed`; all Native/Browser
  gateway, renderer, and WebDriver ports were released.

## Instrumentation
- Conversation selection records current-session equality plus Chat-store
  message and ToolCall counts.
- Approval observation records Chat-store, Tool runtime, Station message, and
  DOM membership as booleans/counts without persisting IDs or content.
- Receiver timeout records the same bounded snapshot for comparison.
- Authoritative `syncMessages` records message, ToolCall, and pending ToolCall
  counts before and after cache replacement.

## Verification Conclusion
Pre-fix evidence confirms two owner-layer gaps:

1. `toolRuntime` has an immediate event-consumption path but no reconciliation
   path from authoritative Station message snapshots.
2. A ToolCall requiring approval remains inside a collapsed block, so the
   required receiver action is not visible when the persisted projection
   arrives.

The fix must reconcile persisted ToolCalls into `toolRuntime` without
regressing newer event revisions and automatically expose an actionable
approval. Post-fix runtime evidence remains pending.

## Local Fix Verification
- `toolRuntime.reconcileMessages` now hydrates missing Station-authored
  ToolCalls and rejects snapshots older than the current decision revision or
  lifecycle status.
- Every cached, incremental, and authoritative message load reconciles the
  `agent-tool` runtime before publishing Chat-store messages.
- `ToolCallsBlock` automatically expands when a persisted ToolCall requires an
  actionable approval.
- Focused Desktop tests: 21 passed.
- Full Desktop tests: 560 passed, 1 unrelated environment-dependent test
  skipped.
- Desktop typecheck/build: passed.
- Agent native static tests: 66 passed.
- `git diff --check`: passed.
- Exact-source post-fix runtime evidence: pending.

## First Fix Iteration
- Exact-source run
  `20260904T191316480393Z-131f3a55b3b3095dc64bd3589b01a044`
  on `a938938c2a87cb2ae729c1a48b28cc2db657c0c1` showed the first
  correction was incomplete.
- At timeout, the exact ToolCall was present in Station and the Chat store, and
  a `toolRuntime` projection existed, but that projection was incorrectly
  `success` and the receiver DOM remained empty.
- Source inspection confirmed `AgentMessage.tool_calls_json` is provider-format
  data containing ToolCall ID and nested function data, not governed
  ToolCall status or approval identity. Defaulting that record to `success`
  was invalid.
- The corrected implementation uses the existing Station
  `TurnDiagnosticReplay.tool_calls` contract for status, approval ID, decision
  revision, and error state. Provider-format message JSON supplies only the
  visible call identity and arguments. The ToolCall group subscribes to
  `agent-tool`, so a reconciled actionable approval becomes visible without a
  page-level refresh or Harness shortcut.
- Exact-source runtime comparison for this corrected implementation remains
  pending.

## Second Fix Iteration
- Exact-source run
  `20260904T195645915962Z-2685115f2ec7084d62ae2bc0f79ca78f`
  on `8dd31dd4d330f8d47722c5f36ece19874c7b94c3` reached Browser
  `BASE-APPROVAL-DENIED / en / single / sample-001` and advanced past the
  previously missing ToolCall receiver.
- At approval observation, debug line 229 still recorded the expected
  Station ToolCall before the asynchronous Chat/runtime reconciliation.
  Lines 233 and 236-239 then recorded authoritative ToolCall recovery, ending
  with three projected ToolCalls and one pending call.
- The receiver selected
  `[data-pt-agent-tool-recovery="continue-without-tool"]`, but source inspection
  showed that selector was attached to the approve button. The button whose
  localized label is `agent.recovery.continueWithoutTool` submitted
  `approved=false` but had no selector.
- The Gate therefore approved the ToolCall and continued the tool loop, then
  correctly timed out waiting for a denied typed outcome. This confirms that
  governed diagnostic reconciliation made the receiver actionable and exposes
  a separate selector-to-intent binding defect.
- The local correction moves the recovery selector to the `approved=false`
  button and adds component/native static guards that require the selector to
  occur between the approve and deny handlers.
- Focused Desktop tests passed 8 tests. The full Desktop suite passed 560 tests
  with one unrelated environment-dependent skip. Desktop typecheck and
  production build passed, 66 native static tests passed, and
  `git diff --check` passed.
- Exact-source runtime comparison for the selector correction remains pending.
- Provisioner cleanup for the failed run completed
  `DONE / PROVEN / passed`; the debug session remains `[OPEN]`.

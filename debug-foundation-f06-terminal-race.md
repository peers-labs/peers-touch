# Debug Session: foundation-f06-terminal-race
- **Status**: [OPEN]
- **Issue**: The final Native AS-F06 preparation can reach a terminal Turn before the fault boundary, and partial cleanup then fails with an active conversation dependency.
- **Debug Server**: http://127.0.0.1:7780/event
- **Log File**: `.dbg/trae-debug-log-foundation-f06-terminal-race.ndjson`

## Reproduction Steps
1. Verify the bound `peers-ai-agent` worktree and exact deployed source.
2. Run the complete G-F Gate with cached ChromeDriver resolution and both AS-F06 authorization flags.
3. Allow Browser AS-F06 tuples and the first Native tuple to complete.
4. Observe the final Native AS-F06 preparation from Turn submission through recovery registration, fault request, fault acknowledgement, and terminal settlement.
5. Compare the primary preparation failure with partial-scenario cleanup.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | The repeated provider prompt completes before the client reaches the fault-request boundary | High | Low | A terminal event arrives before `fault-cut-requested`, with no cut acknowledgement |
| B | Native delivery batches text and terminal events so the Harness first observes the Turn only after completion | Medium | Low | The first actionable callback already contains a terminal event and multiple durable events |
| C | The fault request is sent, but terminal settlement wins before the TCP cut is acknowledged and reflected in recovery state | Medium | Low | `fault-cut-requested` precedes terminal settlement, but `fault-cut-acknowledged` is absent or recovery state is already missing |
| D | Partial cleanup uses an empty or stale Turn locator after terminal settlement and therefore cannot drain the active dependency | High | Low | Cleanup records a conversation but no current Turn locator, followed by cancel/archive failure |

## Instrumentation Plan
- `runFoundationF06Prepare`: record scenario scope, cleanup-locator presence, and primary/cleanup failure categories.
- `prepareFoundationF06Conversation`: record first actionable event, terminal-before-cut, recovery registration, fault request, fault acknowledgement, and result-before-boundary.
- `cleanupFoundationF06Scenario`: record locator selection, cancellation/queue/deletion stage outcomes, and final cleanup status.

## Log Evidence
- Exact-source Gate run
  `20260909T133755333609Z-65d759fb2ca566804c1947eb43ecb4c9`
  completed both Browser AS-F06 restarts and the first Native restart.
- The next Native preparation failed with
  `agent.acceptance.foundationRecoveryTurnAlreadyTerminal`.
- Its inline cleanup failed with `agent.turnCancelFailed` and an active
  conversation dependency. Provisioner cleanup still completed
  `DONE / PROVEN / passed`.
- Branch-level instrumentation is installed for preparation start/failure,
  terminal-before-cut, cut request/acknowledgement, result-before-boundary,
  cleanup locator selection, cleanup action failure, and cleanup result.
- Desktop typecheck passes. The focused runtime, coordinator, and Agent static
  suites pass 144 tests; `git diff --check` passes.
- Exact-source Gate run
  `20260909T141502294542Z-5a3fca9b8d25c0a8f7ac1582a5b320b7`
  on `9a3bb6c7919feb36c080df1a1ce082db69855497` did not reproduce the
  terminal-before-fault race. Every tuple requested and acknowledged its fault
  boundary before terminal settlement:
  - Browser English: request at 3107 ms, acknowledgement at 3112 ms.
  - Browser Simplified Chinese: request at 3684 ms, acknowledgement at 3715 ms.
  - Desktop English: request at 2636 ms, acknowledgement at 2649 ms.
  - Desktop Simplified Chinese: request at 3829 ms, acknowledgement at 3833 ms.
- All four AS-F06 scenario cleanups completed with the conversation deleted,
  handoff cleared, recovery record cleared, and no cleanup error. The run
  crossed every AS-F06 tuple and later stopped at the independent planned gap
  `BASE-EXECUTOR-UNAVAILABLE: direct-runtime group is not implemented`.
- Outer Provisioner cleanup completed `DONE / PROVEN / passed`, source identity
  matched the clean deployed commit, and evidence redaction passed.
- Exact-source Gate run
  `20260910T174705841217Z-b9f6cba8654841d5a809bc1953da3f1f`
  on `0db2aff8201ef1d2b0fb1117b99d132f44b00d4b` again crossed all
  four AS-F06 tuples. The retained `pre-fix` trace records:
  - Browser English: request at 5677 ms, acknowledgement at 5680 ms.
  - Browser Simplified Chinese: request at 2464 ms, acknowledgement at
    2480 ms.
  - Desktop English: request at 2876 ms, acknowledgement at 2920 ms.
  - Desktop Simplified Chinese: request at 1529 ms, acknowledgement at
    1567 ms.
- Every tuple had one text event and three durable events at the request
  boundary. No terminal-before-cut event or cleanup-locator failure was
  emitted. The run later failed independently during Browser AS-F07.
- Post-fix run
  `20260910T190158567694Z-34c18f11a6fe5ecfb85225d8e5125909`
  on `d18a40cb48dce01f97285e581eb1409a422417a9` again crossed all
  four tuples:
  - Browser English: request at 1977 ms, acknowledgement at 1980 ms.
  - Browser Simplified Chinese: request at 1871 ms, acknowledgement at
    1889 ms.
  - Desktop English: request at 1346 ms, acknowledgement at 1406 ms.
  - Desktop Simplified Chinese: request at 2150 ms, acknowledgement at
    2190 ms.
- All four scenario cleanups deleted their conversation, cleared handoff and
  recovery state, and reported `cleanupComplete=true`. Final runtime cleanup
  released both clients, both fault transports, all six client ports, storage,
  and actor identity.

## Verification Conclusion
The exact-source run rejected hypotheses A through D as current owner-layer
defects: no terminal event won before the fault boundary, every cut was
acknowledged, all recovery records remained available at the boundary, and
every scenario cleanup completed. No behavior change is justified. Keep the
instrumentation until explicit debug-session closure confirmation.

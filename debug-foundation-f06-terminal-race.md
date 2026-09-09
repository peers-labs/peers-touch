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

## Verification Conclusion
Pending source-bound reproduction with branch-level timing instrumentation. No behavior change is authorized before one hypothesis is confirmed.

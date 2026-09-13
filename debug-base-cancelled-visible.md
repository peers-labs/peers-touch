# Debug Session: base-cancelled-visible
- **Status**: [OPEN]
- **Issue**: The exact-source 419-cell Foundation run fails first at Browser/en `BASE-CANCELLED` because `localizedCancellationVisible` is false after the production cancellation path.
- **Debug Server**: http://127.0.0.1:7788/event
- **Log File**: .dbg/trae-debug-log-base-cancelled-localization.ndjson

## Reproduction Steps
1. Verify the bound worktree at `84c27515cbf7334234f9fac943ef52cc7ee48fbd`.
2. Deploy that exact source to the approved `chat-native-disposable-station`.
3. Run the complete `agent-v2-kernel-foundation-e2e` Gate with the approved profile, disposable, and Station-restart inputs.
4. Observe the first failing tuple:
   `foundation-browser-direct / browser / direct_model / BASE-CANCELLED / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | One live/reload/replay receiver phase has the wrong canonical message identity or cancellation detail. | High | Low | Pending exact phase snapshot instrumentation. |
| B | The localized error surface exists but is hidden or sampled before the UI commits the cancellation projection. | High | Low | Pending element presence, visibility, and projection state instrumentation. |
| C | The expected localized text and rendered text diverge despite a correct typed cancellation payload. | Medium | Low | Pending hashed rendered/expected text comparison. |
| D | Terminal reconciliation applies the authoritative snapshot and then a stale projection overwrites a required cancellation field. | Medium | Medium | Pending before/after reconciliation message snapshots. |
| E | Prior Foundation scenarios leave a stale current-session or duplicate message projection that the selector samples. | Low | Medium | Pending current session, matching surface count, and candidate message identity evidence. |

## Log Evidence
- Exact-source outer run:
  `20260913T064242368499Z-8da4ab40a654603b901916f65c5c420b`.
- First failure:
  `BASE-CANCELLED production facts failed assertions: ['localizedCancellationVisible']`.
- Source, remote Station, and cleanup evidence are clean/proven.
- AS-F06 post-fix evidence shows proxy cut ACK precedes terminal settlement in all four tuples.
- `BASE-INTERRUPTED` retry instrumentation shows the UI handler is admitted and Station returns a new Turn/Attempt.
- Existing `[OPEN]` session `debug-base-cancelled-localization.md` already owns
  the phase-level reporter in `harness.ts`; its collector was not running
  during the failed Gate, so the current failure has no live/reload/replay
  breakdown yet.
- A direct Browser-only reproduction was rejected before the target because
  the required capability session was unavailable. A second direct
  two-client reproduction reached the same precondition failure. Both
  diagnostics released all processes, ports, and storage and are not product
  evidence because they did not use the complete Provisioner lifecycle.

## Verification Conclusion
Pending phase-level `BASE-CANCELLED` receiver evidence from a formally
provisioned Gate run with the existing 7788 collector active. No behavior
change is justified yet.

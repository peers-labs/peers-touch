# Debug Session: browser-renderer-closed
- **Status**: [OPEN]
- **Issue**: The exact-source 419-cell Foundation Gate reaches `BASE-APPROVAL_EXPIRED` and then loses the Browser WebDriver session because the browser renderer connection closes.
- **Debug Server**: http://127.0.0.1:7786/event
- **Log File**: `.dbg/trae-debug-log-browser-renderer-closed.ndjson`

## Reproduction Steps
1. Verify `chat-native-disposable` resolves the canonical Ark provider and model.
2. Deploy and attest exact source `ad04118c27a7c6890638046b9271be5ce01b22e8`.
3. Run C08 and require `DONE / PROVEN`.
4. Run the unchanged `agent-v2-kernel-foundation-e2e` Gate with the approved disposable reset.
5. Observe the Browser direct tuple at `BASE-APPROVAL_EXPIRED`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | The Browser renderer or host process crashes under runtime/resource pressure. | High | Low | Browser/driver logs contain crash, signal, OOM, or abnormal exit evidence before WebDriver reports `invalid session id`. |
| B | A Browser lifetime guard still closes the process during a long Foundation run. | Medium | Low | A bounded lifetime timer or supervisor exit occurs at a stable elapsed duration before the failing probe. |
| C | Application navigation, logout, or window-close behavior destroys the active Browser session. | Medium | Medium | Lifecycle logs show an explicit close/navigation/teardown event immediately before the failed command. |
| D | Tuple cleanup or shared-resource reconciliation closes Browser while `BASE-APPROVAL_EXPIRED` still owns it. | Medium | Medium | Cleanup ownership logs overlap the failing tuple and precede session deletion. |

## Log Evidence
- Pre-fix Gate run: `20260911T103941162463Z-636de10c5006785521980cd5b47864be`.
- First failure: Browser direct `BASE-APPROVAL_EXPIRED`; ChromeDriver reports `invalid session id`, `browser has closed the connection`, and `Unable to receive message from renderer`.
- Outer Provisioner cleanup passed.
- The same run reached and passed earlier AS-F07 branch projections with real Ark responses.
- macOS unified logs show the Browser Chrome process and its Desktop host exiting at the failure boundary, but do not identify whether the exit was initiated by the app, ChromeDriver, cleanup, or a crash.
- Instrumentation is active in
  `tooling/acceptance/gates/agent/foundation_runtime_client.py` for Browser
  session readiness, every Harness call boundary, process/driver-service state,
  and runtime stop boundaries. It reports to this session without changing
  Gate behavior.

## Verification Conclusion
Pre-fix evidence rejects a missing Ark configuration and an AS-F07 branch-selection
regression. Instrument Browser harness calls and runtime lifecycle boundaries to
distinguish hypotheses A-D.

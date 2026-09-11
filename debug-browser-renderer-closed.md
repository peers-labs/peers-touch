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
| A | The Browser renderer or host process crashes under runtime/resource pressure. | Not reproduced | Low | The rerun crossed the same cell with host, Driver service, session, and ports alive. |
| B | A Browser lifetime guard still closes the process during a long Foundation run. | Rejected for the rerun | Low | The Browser survived four restart generations and crossed the prior failure cell. |
| C | Application navigation, logout, or window-close behavior destroys the active Browser session. | Rejected for the rerun | Medium | No session loss occurred before or during `BASE-APPROVAL_EXPIRED`. |
| D | Tuple cleanup or shared-resource reconciliation closes Browser while `BASE-APPROVAL_EXPIRED` still owns it. | Rejected for the rerun | Medium | Browser cleanup began only after the later `BASE-FORBIDDEN_ACTOR` failure. |

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
- Exact-source run
  `20260911T113248603126Z-06d037f93b8d390b5619d30808c87fa8`
  on `3aabb516bae3a69a4c8de8dde6951557a4a6e937` crossed
  `BASE-APPROVAL_EXPIRED`. Its lifecycle trace kept the Browser host,
  ChromeDriver service, WebDriver session, Gateway, renderer, and WebDriver
  port live through the cell. Browser cleanup started only after the later
  `BASE-FORBIDDEN_ACTOR` failure and completed cleanly.

## Verification Conclusion
The prior Browser session deletion is not deterministic and none of hypotheses
A-D reproduced on the next exact-source run. No Browser recovery or timeout
change is justified. Keep instrumentation until the full Gate is proven or the
user confirms that this debug session may be closed.

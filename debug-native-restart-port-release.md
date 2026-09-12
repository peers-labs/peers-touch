# Debug Session: native-restart-port-release
- **Status**: [OPEN]
- **Issue**: Native Tauri restart cleanup reports the renderer port still listening after the retained process group is considered terminated.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-native-restart-port-release.ndjson`

## Reproduction Steps
1. Build the dedicated Acceptance binary from the exact checkpoint source.
2. Deploy the same source to the disposable Station profile.
3. Run C08 first and require `DONE / PROVEN`.
4. Run the unchanged Foundation Gate until native `AS-F06 / en / single / sample-001` restarts the native runtime.
5. Capture stop-entry, signal/wait, and per-port owner evidence.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The root process group exits while a detached renderer child survives and retains the renderer port. | High | Low | Pending: compare saved PGID with the renderer owner PID/PPID/PGID after group exit. |
| B | Process-group wait completion precedes actual renderer listener release. | High | Low | Pending: compare group wait completion timestamp with repeated owner snapshots without changing the cleanup deadline. |
| C | The renderer port is owned by a stale or parallel runtime generation. | Medium | Low | Pending: compare the listener owner command and ancestry with the current root PID and generation. |
| D | The runtime client has lost or retained an incorrect root PID/PGID, so stop signals do not cover the renderer owner. | Medium | Low | Pending: compare stored process identity with live process and listener ancestry at stop entry. |
| E | A foreign renderer takeover invalidates the Native page, and a later restart reports readiness before that damage is fully recovered. | High | Low | Pending: compare post-start DOM identity with the first locale-call DOM identity after the observed takeover. |
| F | The Native process or embedded WebDriver exits between `harness_ready` and `setFoundationLocale`. | Medium | Low | Pending: compare process return code and Gateway/WebDriver listeners at both boundaries. |
| G | A Vite reload occurs after the one-shot readiness check, temporarily removing `window.__PT_ACCEPTANCE__`. | Medium | Low | Pending: compare URL, `document.readyState`, root, harness root, and Agent namespace before and after the locale call. |
| H | The WebDriver session switches to a different window or document after restart. | Low | Low | Pending: compare current URL and window-count snapshots across startup and locale dispatch. |

## Log Evidence
Instrumentation added in
`tooling/acceptance/gates/agent/foundation_runtime_client.py`:

- native stop entry: retained root PID/PGID/session plus all three listeners;
- native Driver shutdown completion: process identity and listener ownership;
- TERM/KILL wait outcomes: retained in memory without changing deadlines;
- existing final port evaluation: original result plus immediate listener
  PID/PPID/PGID/command snapshots.

The existing port result is computed before the `lsof` diagnostic snapshot, so
instrumentation cannot turn a failing immediate release check into a pass.

Focused pre-reproduction checks:

- `python3 -m py_compile tooling/acceptance/gates/agent/foundation_runtime_client.py`: PASS
- `python3 -m unittest tooling.acceptance.gates.agent.foundation_runtime_client_test`: PASS (18 tests)
- `python3 tooling/scripts/acceptance-infra-boundary-test.py`: PASS (8 tests)
- `git diff --check`: PASS

Pending pre-fix runtime reproduction.

Pre-fix exact-source reproduction:

- C08 `20260912T012820159809Z-4ce386dda8bc33cd50afb936234a01e5`
  passed `DONE / PROVEN` on `24c7e3e04330d8c0968cf99cd6cb5bcd603af21e`.
- During Foundation run startup, the expected Native Gateway and WebDriver
  belonged to root PGID `55568`, while renderer port `3410` was replaced by a
  later `peers-group-chat` Acceptance runtime in PGID `59637`.
- Native restart generations 1 and 2 then stopped cleanly. TERM completed in
  `535ms` and `490ms`; no KILL was needed and every final listener snapshot was
  empty.
- Foundation run
  `20260912T012949927697Z-6d3190d85eefa6885987842e0bc08383`
  failed at Browser English AS-F06 when the Native executor's
  `setFoundationLocale` call reported `acceptance harness not mounted`.
  Final cleanup released all client and fault-transport ports and storage.
- Hypothesis A: REJECTED for the observed clean restarts.
- Hypothesis B: REJECTED for the observed clean restarts.
- Hypothesis C: CONFIRMED.
- Hypothesis D: REJECTED for the observed clean restarts.

## Verification Conclusion
The original renderer-port cleanup failure was caused by a foreign worktree
listener, not a surviving child of the retained Native process group. The
subsequent harness-loss failure may be downstream damage from that takeover or
an independent post-readiness lifecycle race. Hypotheses E-H require one
instrumented exact-source run without concurrent port ownership.

Post-instrumentation exact-source comparison:

- C08 `20260912T023434831395Z-dc4a3d0ab9740c4baa9b3b64419957a4`
  passed `DONE / PROVEN` on `98631c455267c53c003b3b0096b0e3c1ad30102c`.
- Foundation
  `20260912T023608539671Z-044de305ad05ee857f80db5d636c939b`
  ran without a concurrent listener owner and crossed AS-F06.
- Initial startup and both Native restarts retained one window at
  `http://localhost:3410/#/agent`, `document.readyState=complete`, and live
  root, Acceptance, Agent namespace, and locale method.
- Every locale call completed with all three listeners owned by the retained
  Native PGID. Both restart stops released all three ports after TERM without
  KILL.
- Hypotheses E-H are REJECTED under isolated runtime ownership. The prior
  `acceptance harness not mounted` failure is attributable to the observed
  cross-worktree renderer takeover rather than a stable Native startup defect.
- The Gate advanced to Browser English `BASE-CANCELLED`, where a separate
  projection-merge defect was reproduced. This session remains `[OPEN]`; no
  instrumentation or debug artifact cleanup is authorized yet.

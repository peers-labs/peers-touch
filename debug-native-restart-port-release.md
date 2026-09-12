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

## Verification Conclusion
Pending.

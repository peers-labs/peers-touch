# Debug Session: foundation-browser-f06-timeout
- **Status**: [OPEN]
- **Issue**: Browser AS-F06 times out while reconnecting Chrome to the renderer after a client restart, then cleanup attempts to restart a fault proxy that the failed startup path already closed.
- **Debug Server**: http://127.0.0.1:7779/event
- **Log File**: `.dbg/trae-debug-log-foundation-browser-f06-timeout.ndjson`

## Reproduction Steps
1. Verify the bound `peers-ai-agent` worktree and exact deployed source.
2. Run the complete G-F Gate with both `PT_AGENT_V2_ALLOW_STATION_RESTART=1` and `PT_ACCEPTANCE_DISPOSABLE=1`.
3. Reach the Browser AS-F06 restart sequence.
4. Observe the Browser launch/navigation phase, Chrome session state, runtime ports, and fault-transport state.
5. Compare the primary restart failure with the subsequent cleanup lifecycle.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | `ChromeDriver.navigate()` blocks on page-load completion after the second Browser restart even though the renderer and gateway processes are listening | High | Low | `chrome-started` is emitted, `navigate-started` is emitted, and `navigate-completed` is absent before a 30-second renderer timeout |
| B | The prior Chrome session or reused profile remains live enough to interfere with the replacement session | Medium | Low | The replacement starts while old Chrome process/session state or the profile lock is still present |
| C | The Browser renderer process becomes unhealthy between port readiness and navigation | Medium | Low | Gateway/renderer ports are initially open but process state or renderer readiness changes before navigation completes |
| D | `start()` closes the run-owned fault proxy after the Browser connection failure, so later cleanup cannot restart the same client | High | Low | Startup rollback records the proxy changing from alive/open to closed before cleanup calls `restart()` |

## Instrumentation Plan
- `FoundationRuntimeClient.start`: record runtime, restart generation, process state, and fault-proxy/controller liveness at entry, after process launch, and on rollback.
- `FoundationRuntimeClient._connect_driver`: record Browser port readiness, Chrome start duration, navigation start/completion/error, and bounded driver/session state.
- `FoundationRuntimeClient.restart`: record stage boundaries around stop, start, and failure.
- `FoundationRuntimeClient._close_fault_transport`: record why closure was requested and whether the transport was already closed.

## Log Evidence
- Exact-source G-F run `20260909T123426489178Z-740d9c16e979e04dca72740926bc5136` failed with Chrome renderer timeout `30.000`.
- The same run then reported `TCP fault proxy cannot restart after close`, cleanup authentication failure, and disconnected Browser cleanup scenarios.
- Existing lifecycle events show Browser restart generation 2 completed runtime stop before the primary failure, but no Harness failure event followed. This places the timeout before `FoundationRuntimeClient.harness()`.
- Provisioner cleanup still released client storage, source lease, and profile lease.
- Pre-fix instrumentation is installed at Browser runtime start, process launch,
  port readiness, Chrome start, navigation start/completion/error, restart
  completion/error, startup rollback, and fault-transport closure.
- Focused runtime/coordinator verification passes 63 tests; Python compilation
  and `git diff --check` pass.

## Verification Conclusion
Pending source-bound reproduction with operation-level instrumentation. No behavior change is authorized before one hypothesis is confirmed.

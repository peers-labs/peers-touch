# Debug Session: native-replay-timeout
- **Status**: [OPEN]
- **Issue**: Native AS-F06 durable snapshot reload receives a fast Station replay response but its WebDriver async Harness call does not complete within 120 seconds.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-native-replay-timeout.ndjson`

## Reproduction Steps
1. Deploy the exact clean source commit to profile `two`.
2. Run `PT_ACCEPTANCE_APPROVED_PROFILE=two PT_AGENT_V2_ALLOW_STATION_RESTART=1 python3 tooling/scripts/acceptance-run.py --gate agent-v2-kernel-foundation-e2e`.
3. Observe Browser AS-F06 complete, followed by a timeout in Native `foundationF06DurableReload`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | A long-running WebDriver async script prevents the Native renderer from delivering the replay completion | High | Medium | Pending: compare Rust emit and renderer receipt events |
| B | Rust emits the snapshot to a stale or missing Tauri window label | Medium | Low | Pending: Rust emit result and window label |
| C | Cancellation of the prior recovery subscription races registration of the explicit reload stream | Medium | Medium | Pending: stream IDs and cancellation ordering |
| D | Station responds but Rust does not parse or emit the snapshot frame | Medium | Low | Station HTTP response is confirmed; Rust response/emit milestones pending |
| E | Selenium transport timeout ratcheting amplifies teardown after the primary hang | High | Low | Confirmed by 120-second primary timeout and cleanup timeout |

## Log Evidence
- Pre-fix run `20260830T032243491098Z-a82a32290139d61b284621d525d3e9d2`: `native-tauri harness foundationF06DurableReload` timed out on WebDriver port `4445`.
- Station request log: `/sub-agent/agent/conversation/events` returned HTTP 200 in about 8 ms during the failed operation.
- Candidate cleanup `20260830T032249225036Z-1e39427660f5b7348beedab77dfebcec`: Native logout timed out; all runtime ports and storage were released.
- Instrumentation points report Native replay start, renderer event receipt, completion, Station response acceptance, and Tauri `emit_to` success.

## Verification Conclusion
Pending instrumentation.

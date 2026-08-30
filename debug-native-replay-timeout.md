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
| A | A long-running WebDriver async script prevents the Native renderer from delivering the replay completion | High | Medium | Rejected: renderer received replay events while the async Harness call was pending |
| B | Rust emits the snapshot to a stale or missing Tauri window label | Medium | Low | Rejected: `emit_to(main)` returned success for snapshot and control events |
| C | Cancellation of the prior recovery subscription races registration of the explicit reload stream | Medium | Medium | Rejected as primary: the explicit listener received reconnecting, replaying, and terminal error |
| D | Station responds but Rust does not parse or emit the snapshot frame | Medium | Low | Rejected: Station returned 200 and Rust emitted snapshot successfully |
| E | Selenium transport timeout ratcheting amplifies teardown after the primary hang | High | Low | Confirmed by 120-second primary timeout and cleanup timeout |
| F | Native replay listener unsubscribes on a persisted terminal event before the authoritative snapshot arrives | High | Low | Confirmed: renderer received terminal `error(119)`, then Rust emitted snapshot successfully with no renderer receipt |

## Log Evidence
- Pre-fix run `20260830T032243491098Z-a82a32290139d61b284621d525d3e9d2`: `native-tauri harness foundationF06DurableReload` timed out on WebDriver port `4445`.
- Station request log: `/sub-agent/agent/conversation/events` returned HTTP 200 in about 8 ms during the failed operation.
- Candidate cleanup `20260830T032249225036Z-1e39427660f5b7348beedab77dfebcec`: Native logout timed out; all runtime ports and storage were released.
- Instrumentation points report Native replay start, renderer event receipt, completion, Station response acceptance, and Tauri `emit_to` success.
- Instrumentation compile checks: Desktop TypeScript PASS, Rust binary check PASS, 106 Foundation tests PASS.
- Instrumented run `20260830T041506584113Z-c92a4e5e551c6733eab5ec808d79f70f`: `.dbg/trae-debug-log-native-replay-timeout.ndjson` lines 46-55 show Native reload start, renderer receipt through terminal `error(119)`, Station 200, and successful Rust emission of `snapshot`; the renderer has no snapshot receipt or completion after it unsubscribes on the earlier terminal row.

## Verification Conclusion
Confirmed root cause: the Native `streamAgentTurnReplay` listener treats every
terminal replay row as stream completion. During catch-up it receives a
persisted terminal `error` before Station's authoritative `snapshot`, removes
the listener, and leaves `loadAuthoritativeTurnSnapshot` unresolved.

The fix keeps the Native listener through catch-up terminal rows and closes it
only for a terminal snapshot or a terminal event after `catchup_done`. The
shared catch-up deadline also remains active until `catchup_done` or a terminal
snapshot.

Post-fix run
`20260830T045331900639Z-ba7ca0c20d20f858b8424ba9e07c9713`
confirmed Native renderer receipt and completion through snapshot sequence
`119`, so the original timeout is fixed. The run then exposed a separate
evidence-handoff defect: the coordinator had validated `sourceDelivery` before
client restart, but the final renderer read a stale localStorage copy without
that field. The follow-up passes the already validated immutable reload
evidence across the restart boundary and merges it with the synchronized
post-restart handoff. Runtime verification of that follow-up is pending.

Exact-source run
`20260830T095955356967Z-30fdd0228f48a45a926c97824d5fec35`
confirmed a later evidence-boundary race. The Browser fault was injected at
cursor 3, but the independent global Station event stream advanced the client
cursor to 6 before the Station outage established recovery. Runtime logs show
the accepted recovery entering `REPLAYING` at cursor 6 and consuming 7-159.
The final interrupted projection and hash matched Station, but the evidence
producer still queried Station from the stale injection cursor and obtained
4-159. The product replay path is correct; the Foundation evidence producer
must derive its replay comparison boundary from the first accepted
`REPLAYING` transition while retaining cursor 3 for the earlier duplicate and
out-of-order injection proof.

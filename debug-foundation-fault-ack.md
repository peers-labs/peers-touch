# Debug Session: foundation-fault-ack
- **Status**: [OPEN]
- **Issue**: Foundation AS-F06 fault control returns before the Browser recovery projection leaves CONNECTED; CONNECTION_LOST is observed about 30 seconds after the cut request, racing the existing acknowledgement deadline.
- **Debug Server**: http://127.0.0.1:7779/event
- **Log File**: .dbg/trae-debug-log-foundation-fault-ack.ndjson

## Reproduction Steps
1. Deploy the exact source to the approved disposable Station profile.
2. Start the Foundation Browser runtime through its run-local TCP fault proxy.
3. Prepare AS-F06 until an active Turn has a persisted event prefix.
4. POST the private loopback fault-control URL.
5. Observe the proxy cut, Gateway stream termination, Browser transport callback, and recovery phase transition.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The cut acknowledges with no tracked active SSE socket. | High | Low | Pending active connection counts at cut. |
| B | The proxy closes the active socket but Gateway propagation waits for its own stream boundary. | Medium | Medium | Pending proxy close and Gateway stream completion timestamps. |
| C | Browser transport termination is immediate but recovery projection waits for a 30-second idle watchdog. | Medium | Medium | Pending Browser stream-error and recovery-transition timestamps. |
| D | The AS-F06 active Turn bypasses the run-local proxy. | Low | Medium | Pending connection identity and stream route correlation. |

## Log Evidence
Pre-instrumentation exact-source evidence:

- Source: `7f7fc29de455905285fb688c830a0b7a17130cd1`
- Gate: `20260906T023932273619Z-9996d0d9df800ffb67685cc1635aabb3`
- `fault-cut-requested`: `ts=1788663479451`, phase `CONNECTED`, requested cursor `3`
- `connection_lost`: `ts=1788663509455`, sequence `36`
- Delta: approximately `30,004 ms`
- The recovery store only reports first, phase, and terminal events. Sequence
  advancing from 3 to 36 proves the live stream continued delivering data
  after the cut request; the delayed transition is not a stale store render.

Instrumentation points:

- `proxy-cut-started` / `proxy-cut-completed`: proxy port, generation, tracked
  socket count, file descriptors, and close duration.
- `gateway-stream-started`: AS-F06-only Station route class and port.
- `gateway-upstream-admitted` / `gateway-stream-completed`: upstream admission
  and Browser response completion timing.
- `browser-stream-started` / `browser-upstream-admitted` /
  `browser-sse-consume-*` / `browser-connection-lost-forwarded`: Browser
  transport timing, terminal state, last sequence, and safe error reason.

## Verification Conclusion
Root cause is not yet proven. No timeout or product behavior change is authorized before the fault boundary is instrumented.

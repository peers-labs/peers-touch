# Debug Session: foundation-fault-ack
- **Status**: [OPEN]
- **Issue**: Foundation AS-F06 fault control returns before the Browser recovery projection leaves CONNECTED; CONNECTION_LOST is observed about 30 seconds after the cut request, racing the existing acknowledgement deadline.
- **Debug Server**: http://127.0.0.1:7783/event
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
| A | The cut acknowledges with no tracked active SSE socket. | High | Low | Rejected: both cuts saw four active sockets and closed all four in 0-1 ms. |
| B | The proxy closes the active socket but Gateway propagation waits for its own stream boundary. | Medium | Medium | Rejected as the delay source: Gateway completed with `responseOk=false` within 2-3 ms of each cut. |
| C | Browser transport termination is immediate but recovery projection waits for a 30-second idle watchdog. | Medium | Medium | Confirmed at the Browser-facing response boundary: `reader.read()` remained pending until `agent.error.streamIdleTimeout` 29.7-30.0 seconds after Gateway completion. |
| D | The AS-F06 active Turn bypasses the run-local proxy. | Low | Medium | Rejected: Gateway used loopback port `57504`, matching the cut proxy port. |

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

Instrumented exact-source evidence:

- Source: `8b9790bd42af1747212f9aa662facc0f5ec356b9`
- Aggregate: `20260906T055745312844Z-a0da0927e45879b112f3bfe02f4585b4`
- Gate: `20260906T055745423679Z-780884e75a8131b5a1a0fa38eef5ceb2`
- Candidate: `20260906T055752959671Z-9cf540ebe7db3b9c19f2d240801c1641`
- Both observed cuts targeted loopback port `57504`, tracked four active
  sockets, and closed them in `0-1 ms`.
- Gateway upstream admission completed in `136-171 ms`; the Gateway response
  path returned `responseOk=false` within `2-3 ms` of each cut.
- Browser SSE consumption did not finish at that boundary. It failed only at
  `agent.error.streamIdleTimeout`, `29,717-29,998 ms` after Gateway completion,
  then forwarded `connection_lost`.
- The first failed tuple remained Browser AS-F06 English. Outer cleanup was
  `DONE / PROVEN / passed`.

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
The root cause is the HTTP Gateway's downstream stream framing. An upstream
`Read` error makes `tiny_http::Request::respond` fail, but the Browser-facing
chunked body does not receive an immediate terminal boundary and remains
pending until the independent 30-second idle watchdog expires. The minimal fix
must preserve the upstream warning while translating that transport failure
to downstream EOF so Browser recovery starts immediately. No timeout or
Acceptance oracle change is authorized.

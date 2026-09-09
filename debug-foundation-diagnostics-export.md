# Debug Session: foundation-diagnostics-export
- **Status**: [OPEN]
- **Issue**: Browser AS-F04 intermittently receives "Failed to export agent turn diagnostics" after Station returns HTTP 200.
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: `.dbg/trae-debug-log-foundation-diagnostics-export.ndjson`

## Reproduction Steps
1. Verify the bound `peers-ai-agent` worktree and exact deployed source.
2. Run the complete G-F Gate with `PT_AGENT_V2_ALLOW_STATION_RESTART=1`.
3. Observe Browser `AS-F04` calling `agent_turn_diagnostics_export`.
4. Compare Station HTTP completion with the Rust request/decode result.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Station succeeds but the Browser gateway fails protobuf decoding | High | Low | Rejected in run `pre-fix`: 442/442 responses decoded |
| B | Browser gateway loses or replaces the authenticated session | Medium | Low | Rejected in run `pre-fix`: all requests had an active token and succeeded |
| C | Diagnostics payload exceeds a client or gateway body/decode constraint | Medium | Medium | Rejected in run `pre-fix`: payloads were 2554–4730 bytes |
| D | Telemetry or database pressure causes a post-response gateway failure | Medium | Medium | Rejected in run `pre-fix`: maximum request duration was 972 ms |
| E | Harness supplies a stale or mismatched turn identity | Low | Low | Rejected in run `pre-fix`: zero unmatched request starts |

## Log Evidence
- Pre-instrumentation G-F run `20260909T093249009857Z-8249ea00d31ec1c6803823fd36fa7cf3` failed at Browser AS-F04.
- Station logged HTTP 200 for diagnostics export; the public Rust error hid the underlying request/decode detail.
- Instrumentation points:
  - `agent_turn_diagnostics_export:entry`: hashed turn identity and token presence.
  - `agent_turn_diagnostics_export:success`: duration, encoded bytes, and replay cardinalities.
  - `agent_turn_diagnostics_export:error`: duration, typed error, and sanitized error text.
- Instrumented Rust source passes `cargo check`.
- Pre-fix run `20260909T120527631709Z-e3e7eb64ebef15b561608a84a72d4dbe`
  emitted 884 events: 442 starts, 442 successful decodes, zero errors, and zero
  unmatched starts.
- That run advanced beyond Browser AS-F04 and failed at AS-F06 because
  `PT_ACCEPTANCE_DISPOSABLE=1` was not supplied. Provisioner cleanup passed.
- Fully authorized pre-fix run
  `20260909T123426489178Z-740d9c16e979e04dca72740926bc5136`
  emitted another 878 events: 439 starts, 439 successful decodes, zero errors,
  and zero unmatched starts. Payloads were 2457–4729 bytes and the maximum
  request duration was 1104 ms.
- The fully authorized run failed later at Browser AS-F06 with a 30-second
  Chrome renderer timeout. Its lifecycle cleanup then reported a closed
  fault-proxy restart. This failure is tracked separately by debug session
  `foundation-browser-f06-timeout`.

## Verification Conclusion
The original diagnostics-export failure did not reproduce across two complete
instrumented prefixes: 881/881 calls decoded successfully with no errors or
unmatched requests. All five hypotheses are rejected. The instrumentation
remains active until the user confirmation gate, but diagnostics export is not
the current G-F blocker.

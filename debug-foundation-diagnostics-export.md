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
| A | Station succeeds but the Browser gateway fails protobuf decoding | High | Low | Underlying Rust error contains protobuf/decode failure |
| B | Browser gateway loses or replaces the authenticated session | Medium | Low | Underlying Rust error reports authorization failure despite a prior Station 200 |
| C | Diagnostics payload exceeds a client or gateway body/decode constraint | Medium | Medium | Error reports body/size failure or success reports anomalous encoded byte size |
| D | Telemetry or database pressure causes a post-response gateway failure | Medium | Medium | Request duration is high while Station response status remains successful |
| E | Harness supplies a stale or mismatched turn identity | Low | Low | Turn hash changes unexpectedly or Station returns not-found/actor-scope failure |

## Log Evidence
- Pre-instrumentation G-F run `20260909T093249009857Z-8249ea00d31ec1c6803823fd36fa7cf3` failed at Browser AS-F04.
- Station logged HTTP 200 for diagnostics export; the public Rust error hid the underlying request/decode detail.
- Instrumentation points:
  - `agent_turn_diagnostics_export:entry`: hashed turn identity and token presence.
  - `agent_turn_diagnostics_export:success`: duration, encoded bytes, and replay cardinalities.
  - `agent_turn_diagnostics_export:error`: duration, typed error, and sanitized error text.
- Instrumented Rust source passes `cargo check`.

## Verification Conclusion
Pending exact-source `pre-fix` reproduction.

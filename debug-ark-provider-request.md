# Debug Session: ark-provider-request
- **Status**: [OPEN]
- **Issue**: AS-F07 baseline completes quickly, while the immediately following regenerate request with the same model repeatedly exhausts the provider timeout.
- **Debug Server**: http://10.4.55.179:7784/event
- **Log File**: .dbg/trae-debug-log-ark-provider-request.ndjson

## Reproduction Steps
1. Activate the canonical `chat-native-disposable` profile using the internal Ark base URL.
2. Deploy exact source and prove C08.
3. Run the unchanged `agent-v2-kernel-foundation-e2e`.
4. Observe Browser English AS-F07 through retry, baseline, and first regenerate.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | Regenerate sends a materially different system/message payload from baseline despite both logging one conversation message. | High | Low | Safe request lengths or body hashes differ materially. |
| B | Regenerate unexpectedly enables tools, thinking, or a larger output budget. | Medium | Low | Request metadata differs in tool count, thinking mode, effort, or max tokens. |
| C | Ark accepts the request and emits stream data but never emits a terminal marker before the client timeout. | High | Medium | HTTP headers/first chunk arrive, but no finish reason or `[DONE]` is observed. |
| D | Station is still dispatching the regenerate request to the old public host. | Low | Low | Endpoint host differs from the persisted internal base URL. |
| E | The remote host cannot reliably reach the internal Ark route. | Low | Low | A same-host direct streaming probe also stalls or fails. |

## Instrumentation Plan
- Record a hash and byte length for each request body without recording message content.
- Record endpoint, message roles and lengths, tool count, thinking mode, stream flag, and max tokens.
- Record response-header and first-SSE-data latency.
- Record stream completion, finish marker, parsed chunk counts, or scanner/context failure.

## Log Evidence
- Public Chat Completions timed out after 30 seconds from the local client.
- Internal Chat Completions returned HTTP 200 in 20.681 seconds locally.
- Internal Responses returned HTTP 200 in 14.494 seconds locally.
- Internal streaming Chat Completions returned HTTP 200 with `[DONE]` in 1.988 seconds from the deployment host.
- The Station container can reach the dedicated Debug Server.
- Station database readback records `https://ark-cn-beijing.bytedance.net/api/v3` with protocol `openai-compatible`.
- Exact-source Gate run
  `20260911T020204856489Z-438300f2aa793d7acd4492395eb344da`
  still failed first regenerate after 300 seconds.

## Verification Conclusion
Pending provider request/stream lifecycle instrumentation.

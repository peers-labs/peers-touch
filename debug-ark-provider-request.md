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
- Instrumented exact-source run
  `20260911T023302255347Z-4409f33994d2cf1cdab008f28d017de5`
  on `361c73e0a9cdad58e3ea68e7624631ab1af3b098` reproduced the
  AS-F07 provider failure after all four AS-F06 tuples passed.
- The baseline and regenerate requests both used the internal endpoint,
  `stream=true`, `maxTokens=8192`, zero tools, one system message of 1122
  bytes, and one user message of 61 bytes.
- The baseline request carried `thinking.type=disabled`, received headers and
  first stream data after 2224 ms, and completed with `[DONE]` after 2858 ms.
- Both regenerate requests omitted the thinking field. The first regenerate
  completed after 96448 ms and 912 parsed chunks. The second emitted 952 parsed
  chunks before the 120001 ms HTTP-client timeout; its retry emitted 400
  parsed chunks before the aggregate operation deadline cancelled it.
- Both failed attempts received HTTP 200 headers and first stream data, so the
  failure is not DNS, connection establishment, route selection, or response
  framing startup.

## Verification Conclusion
- A is confirmed only for the thinking-mode field; message roles and lengths,
  tool count, endpoint, stream mode, and max tokens match.
- B is confirmed: revision execution loses the source Turn's explicit
  `thinking_mode=disabled` and falls back to the Agent default `auto`.
- C is confirmed as the resulting symptom: Ark streams long reasoning output
  without reaching a terminal marker inside the unchanged provider and
  operation budgets.
- D and E are rejected.
- The owner-layer fix is for revision execution to carry the source Turn's
  persisted `RuntimeSnapshot.thinking_mode`. Endpoint fallback, timeout
  inflation, prompt steering, and Gate weakening are not justified.
- Source inspection confirms `RevisionService.admitAndExecute` constructed
  retry/regenerate/edit `TurnConfig` values without `ThinkingMode`, causing
  `TurnService.resolveAgentDefaults` to replace the source Turn's explicit
  override with the Agent default `auto`.
- The minimal fix loads the latest source-Turn attempt snapshot inside the
  revision transaction and carries only its normalized thinking mode into the
  new execution config. Current provider/model/readiness authority and optional
  lower requested budgets remain unchanged.
- Post-fix checkpoint
  `48c7065ce97b2442df3c82d17840dd120c44651e` passed C08 in run
  `20260911T031908377408Z-020712763e7168d9fcf4bdefb39ec604`.
- Foundation run
  `20260911T032023594492Z-4af15b4006f3a3fb625e4ba4cc009f30`
  passed all four AS-F06 tuples and both Browser AS-F07 tuples, then advanced
  to the next planned gap `BASE-FORBIDDEN_ACTOR`.
- In the post-fix AS-F07 trace, retry completed in 19.751 seconds and the two
  regenerate calls completed in 3.179 and 3.146 seconds. Every baseline,
  retry, regenerate, and edit provider request carried
  `thinking.type=disabled`, received HTTP 200 streaming headers, and completed
  with `[DONE]`.
- This confirms B as the owner-layer root cause and rejects A/C/D/E for the
  repaired flow. The Debug Server and instrumentation remain until Owner
  confirmation authorizes cleanup.

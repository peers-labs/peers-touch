# Debug Session: foundation-f06-http-502
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation Gate fails while Browser English AS-F06 prepares its source Turn. The Browser receives HTTP 502, and inner cleanup cannot read the conversation or cancel the Turn.
- **Debug Server**: http://127.0.0.1:7783/event (existing retained collector)
- **Log Files**:
  `.dbg/trae-debug-log-ark-provider-request.ndjson`,
  `.dbg/trae-debug-log-foundation-f06-terminal-race-v2.ndjson`,
  `.dbg/trae-debug-log-foundation-fault-ack.ndjson`, and
  `.dbg/trae-debug-log-foundation-recovery-registration.ndjson`

## Reproduction Steps
1. Activate the canonical `chat-native-disposable` profile.
2. Deploy exact source `6afce95271381aa1d0c2ed7a331bf728b3f40e36`.
3. Run C08 with explicit destructive-Fixture authorization and verify `DONE / PROVEN`.
4. Run the unchanged 419-cell Foundation Gate with explicit Station-restart authorization.
5. Observe Browser English `AS-F06` fail in `foundationF06Prepare` with HTTP 502.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | Ark upstream failed during the AS-F06 prepare Turn | High | Low | Provider instrumentation records an upstream status/error before Station emits 502 |
| B | A controlled Station restart left the Browser gateway on a stale connection or session | Medium | Low | Station remains healthy while Browser transport reports connection/session failure immediately after restart |
| C | Fixture reset or restart lost the provider credential/model binding | Medium | Low | Provider/model preflight is absent or credential resolution fails before an upstream request |
| D | Station completed the request but Browser BFF failed while forwarding or decoding it | Low | Medium | Station records a successful terminal Turn while Browser reports 502 |
| E | Cleanup is coupled to the failed primary Turn and cannot independently restore state | High | Low | Primary 502 is followed by conversation read/cancel cleanup failures while outer Provisioner cleanup still passes |

## Log Evidence
- Foundation run `20260911T044824404452Z-1bd6e65bb4094a3cdbc03dd37f0af86a` is `PARTIAL / UNPROVEN`.
- First failed tuple: `foundation-browser-direct / browser / direct_model / AS-F06 / en / single / sample-001`.
- Primary failure: `foundationF06Prepare` received HTTP 502.
- Inner cleanup failed to read the Agent conversation and cancel the Turn.
- Outer Provisioner cleanup is `DONE / PROVEN`; both clients, all ports, storage, and actor identity were released.
- Existing Ark instrumentation records the failing Turn request reaching
  `https://ark-cn-beijing.bytedance.net/api/v3/chat/completions`, receiving
  HTTP 200, receiving its first stream data, and completing the stream in
  about 2.2 seconds.
- Existing fault instrumentation records Browser upstream admission at HTTP
  200, the intentional transport cut, and the expected `connection_lost`
  handoff. A later non-typed HTTP 502 is projected as a terminal `error`
  event, which clears the recovery record before cleanup.
- The regression was introduced by the immediate typed HTTP-error projection:
  `consumeAgentSSE` currently turns every non-2xx response into an SSE
  `error`, even when the response does not carry the complete typed-error
  contract.

## Verification Conclusion
- Hypothesis A is rejected: Ark accepted and completed the relevant request.
- Hypothesis B is confirmed: the expected transport interruption is followed
  by a transient non-typed 502 during Browser recovery.
- Hypothesis C is rejected: provider/model configuration resolved and the
  provider request executed.
- Hypothesis D is rejected: Station provider execution completed; the
  Browser transport misclassified the recovery response.
- Hypothesis E is confirmed: the false terminal event clears recovery state,
  and inner cleanup then cannot read/cancel the active Turn.
- The minimal fix belongs in Browser SSE response classification: only a
  complete typed-error payload may become a terminal error event; an untyped
  non-2xx response remains a transport failure handled by replay retry.

## Fix
- `consumeAgentSSE` now projects a non-2xx response as a terminal SSE error only
  when `projectAgentTypedErrorPayload` accepts the complete typed contract.
- Untyped HTTP failures now throw a transport error, preserving the existing
  replay backoff and retry path.
- Browser HTTP 403 typed rejection and untyped HTTP 502 replay regressions are
  covered in `apps/desktop/src/services/api.test.ts`.

## Post-Fix Verification
- Focused Desktop API tests: `47/47` passed.
- Desktop check: passed.
- Exact-source C08 and unchanged Foundation rerun: pending checkpoint and
  deployment.

# Debug Session: native-hydration-timeout
- **Status**: [OPEN]
- **Issue**: Linux Native MP-W13-F times out while awaiting `chat.hydrateActiveActor` after successful Alice login.
- **Debug Server**: http://127.0.0.1:7777/event (forwarded to Linux runtime as `127.0.0.1:7781`)
- **Log File**: `.dbg/trae-debug-log-native-hydration-timeout.ndjson`

## Reproduction Steps
1. Lease `desktop-linux-native` for `chat-native-product-closure-e2e`.
2. Run `CHAT_ACCEPTANCE_RESET=1 RUNTIME_CELL=desktop-linux-native make acceptance-chat-native-product-closure`.
3. Observe Alice login complete and `hydrateActiveActor` exceed its 30-second script timeout.

## Hypotheses & Verification

| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Concurrent social bootstrap and harness hydration contend on the Messaging Engine store | High | Low | Conversation request starts but does not complete while other runtime bootstrap work continues |
| B | The orchestrator-to-Station reverse tunnel drops during hydration | Medium | Low | Profile completes but the conversation request remains pending across an event-stream disconnect |
| C | Deferred runtime installation or page prewarm blocks the WebKit main thread | Medium | Low | Hydration events stop while renderer/runtime events also stop |
| D | The business Promise completes but WebDriver loses the async callback | Low | Low | Hydration completion is logged before Selenium reports its timeout |

## Log Evidence

- Pre-fix run `20260827T123357675988Z-95ea336a20ea6cc75215f66f6839e45d` timed out in `hydrateActiveActor`.
- Pre-fix run `20260827T123727350082Z-602f6f52feb9f618019c5d3c44743f9b` reproduced the same boundary.
- Both runs completed actor, endpoint, port, process, and storage cleanup.
- Instrumented run `20260827T125926729019Z-10933ceaa74ef35ce03bde3520f33e21`
  showed the runtime bootstrap conversation read completing before the harness
  issued a second conversation read. The second read also completed, and the
  Gate advanced to the Direct search journey.
- The same run then failed because both create and reuse passes attempted to
  register the same `search-result` localization checkpoint.

## Verification Conclusion

- A: Confirmed as duplicate projection hydration across the runtime and harness,
  with highly variable command latency rather than a permanent store deadlock.
- B: Rejected. The first and second conversation reads completed through the
  active endpoint, and cleanup reported no tunnel failures.
- C: Inconclusive as a latency contributor, but the renderer continued emitting
  events while hydration was pending.
- D: Rejected. The completion events preceded successful WebDriver continuation.
- Independent Gate defect: the two required Direct search passes need distinct
  localization checkpoint identities.

## Fix

- Route explicit Acceptance hydration through the runtime-owned,
  single-flight `refreshSocialProjection` path.
- Route authenticated Social bootstrap through that same refresh owner so the
  harness joins in-flight work instead of issuing a competing projection read.
- Give Direct create and Direct reuse localization captures distinct checkpoint
  identities.

Post-fix verification pending.

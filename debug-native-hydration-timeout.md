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

## Verification Conclusion

Pending instrumented reproduction.

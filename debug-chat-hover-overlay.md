# Debug Session: chat-hover-overlay
- **Status**: [OPEN]
- **Issue**: A real Native Tauri hover over a visible message row does not produce the pane-owned message action overlay.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-chat-hover-overlay.ndjson`

## Reproduction Steps
1. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
2. Create the Alice/Bob MLS group through the visible Chat UI.
3. Send a message from Bob and wait until the same message ID is visible in Alice.
4. Move the Native WebDriver pointer to Alice's message row.
5. Observe that `[data-message-action-overlay="toolbar"]` is not found within 15 seconds.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | WebDriver hover does not trigger the row `onMouseEnter` handler | High | Low | Pending |
| B | The action target activates while the portal host is unavailable | Medium | Low | Pending |
| C | Geometry validation dismisses a disconnected anchor or surface | Medium | Low | Pending |
| D | The 140ms leave timer clears the target immediately | High | Low | Pending |
| E | Overlay renders with a different message identity or selector | Low | Low | Pending |

## Log Evidence
Instrumentation points:
- A: `ChatMessageRow.onMouseEnter`
- B: `ChatMessageTimeline.activateActions`
- C: `ChatMessageActionOverlay` layout/disconnect
- D: row leave and close-timer schedule/fire
- E: overlay geometry calculation

Pending pre-fix reproduction.

## Verification Conclusion
Pending.

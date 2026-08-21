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
| A | WebDriver hover does not trigger the row `onMouseEnter` handler | High | Low | Confirmed: no A event after the Native hover |
| B | The action target activates while the portal host is unavailable | Medium | Low | Rejected: no B activation event |
| C | Geometry validation dismisses a disconnected anchor or surface | Medium | Low | Rejected: only normal empty-target mount events, no disconnect |
| D | The 140ms leave timer clears the target immediately | High | Low | Rejected: no leave or timer events |
| E | Overlay renders with a different message identity or selector | Low | Low | Rejected as root cause: no action target or overlay existed |

## Log Evidence
Instrumentation points:
- A: `ChatMessageRow.onMouseEnter`
- B: `ChatMessageTimeline.activateActions`
- C: `ChatMessageActionOverlay` layout/disconnect
- D: row leave and close-timer schedule/fire
- E: overlay geometry calculation

Pre-fix run: `20260821T011327502682Z-499fcc3677e1e24d187dd9dac0505a6b`.

- Lines 1-2: overlay mounted with no target; host and viewport were ready.
- No A event: moving directly to the row did not cross a pointer boundary and did not emit `mouseenter`.
- No B/D/E events: the action target, close timer, and geometry pipeline never started.

## Verification Conclusion
The Native WebDriver pointer can already be inside a row's future bounds. A direct
`move_to_element(row)` then produces no boundary transition and React receives no
`mouseenter`. The Acceptance input must first move to a neutral visible element,
then move to the target row using the same Selenium ActionChains pointer source.

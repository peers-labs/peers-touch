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
| F | WebKit emits `mouseover` or `pointerenter`, but React does not synthesize `mouseenter` | Medium | Low | Pending |
| G | A transparent or adjacent element owns the row-center hit target | High | Low | Pending |
| H | Neutral and row rectangles overlap or change before pointer movement | Medium | Low | Pending |
| I | W3C pointer movement does not update the row's CSS `:hover` state | High | Low | Pending |

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

First post-fix run:
`20260821T012601558653Z-33089642cf17466dbe04f2cdadd74d7c`.

- Source and Station matched commit `47095d40a4b58cbb03d5792080971394b1ded294`.
- The dedicated binary SHA-256 was
  `920c90ca66300a6e3083d2e38aed87a6eeeb151888df68e2e00ed88e2aea7008`.
- Moving `neutral control -> target row` still produced only the two normal C
  empty-target mount events; A/B/D/E remained absent.
- The Gate failed at the same first `hover_message` call and emitted cleanup
  evidence with ports `3330`, `3331`, `4445`, and `4446` released.

## Verification Conclusion
Direct movement and the neutral-control choreography both fail to produce
`mouseenter`, so the original pointer-boundary explanation is insufficient.
The next instrumentation must distinguish raw `mouseover`/`pointerenter`, actual
hit-test ownership, element rectangles, and CSS `:hover` state before changing
the product or the Native input path again.

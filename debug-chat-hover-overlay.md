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
| F | WebKit emits `mouseover` or `pointerenter`, but React does not synthesize `mouseenter` | Medium | Low | Rejected: neither raw event fired |
| G | A transparent or adjacent element owns the row-center hit target | High | Low | Rejected: center hit the target row's `SPAN` descendant |
| H | Neutral and row rectangles overlap or change before pointer movement | Medium | Low | Rejected: rects were separated and stable |
| I | Element-origin W3C pointer movement does not update the row's CSS `:hover` state | High | Low | Confirmed: `:hover` remained false after successful ActionChains |

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

Second post-fix run:
`20260821T013459294184Z-1dd53cbc629969dcc56f068998d0015e`.

- Source and Station matched commit `37b09d5be0eb0236e11a75fb812054fe04a7b12b`.
- Before and after movement, the target row rect remained
  `(406,177)-(591.765625,254)` and its center hit the same message `SPAN`.
- The neutral send rect remained `(1153,722)-(1185,754)`, so the two targets
  were separated and stable.
- After `ActionChains.perform()`, target row `:hover` remained false and neither
  `mouseover` nor `pointerenter` fired.
- Cleanup again released `3330`, `3331`, `4445`, and `4446`.

Third post-fix run:
`20260821T014246527356Z-c0c025ff36d65daeb00ea15648ef75a6`.

- Source and Station matched commit `aae7297dd9792b0bec11339b586e8840e703a516`.
- Selenium viewport-origin `PointerInput(mouse)` completed without error, but
  target row `:hover` again remained false.
- No raw row mouse/pointer event or action-target/geometry event appeared.
- Cleanup again released `3330`, `3331`, `4445`, and `4446`.

First CoreGraphics run:
`20260821T015121128471Z-630f7fe7e190a15059b003ff6f400268`.

- Source and Station matched commit `d98130c947df054a724651a459fddaeccf072927`.
- CoreGraphics posting completed, but the WKWebView exposed unusable browser
  window fields: `outerWidth=0`, `outerHeight=0`, `screenX=0`, `screenY=1117`.
- The derived HID coordinates were therefore outside the actual client window;
  this run does not reject CoreGraphics input.
- An isolated smoke client proved the correct coordinate source:
  Accessibility bounds `264,98,1200,801`, DOM viewport `1200x769`, and a
  32-point title/content offset. WebDriver reported doubled Retina pixels and
  is not used for DOM-to-screen conversion.

## Verification Conclusion
The target geometry and hit-test ownership are correct, but neither Selenium
element-origin nor viewport-origin W3C pointer movement reaches the embedded
WKWebView input layer. macOS native HID posting is available and authorized by
the host. Browser `screenX/screenY/outerWidth/outerHeight` are invalid in this
embedded runtime, so the coordinate mapping must use the exact client PID's
Accessibility front-window position/size plus the DOM viewport. The Native path
then posts real CoreGraphics mouse movement through a neutral point and keeps
Selenium only for DOM geometry and result verification. JS event dispatch,
Store mutation, Harness actions, and fixed business commands remain forbidden.

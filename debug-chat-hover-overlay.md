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
| J | Process activation is sufficient to focus a raw dedicated Tauri window | High | Low | Rejected: exact-PID activation left `document.hasFocus=false` |
| K | Acceptance-only window tiling and topmost ownership can make CoreGraphics input deterministic | High | Medium | Confirmed: two-window probe switched exact `document.hasFocus()` ownership in both directions |
| L | Retina-normalized WebDriver bounds map DOM centers to CoreGraphics coordinates | High | Medium | Confirmed: raw rects were exactly 2x the non-overlapping logical window slots |
| M | The send-button center falls outside the viewport in the narrower actor slot | Medium | Low | Rejected: rect `817,721,32,32` was inside the `864x768` viewport |
| N | An Ant Tooltip or portal surface covers the send-button center | Medium | Low | Confirmed: bottom-right LobeUI success toast owned the center |
| O | React replaces or disconnects the send button after composer input | Low | Low | Rejected: target remained connected and enabled |
| P | A same-layer sibling covers only the center while inset points remain target-owned | Medium | Low | Confirmed: only bottom-right inset remained send-owned; product fix moved the toast |
| Q | CoreGraphics movement reaches the button but Native down never reaches the DOM | High | Low | Rejected: pointerdown and mousedown both arrived |
| R | Native events are delivered out of sequence before WebKit can synthesize `click` | High | Low | Confirmed pre-fix and fixed: paced events arrived down -> up -> click |
| S | React `onClick` runs but `submit` exits before the messaging API | Medium | Low | Rejected post-fix: click entered submit and message delivery completed |
| T | `canSend` becomes false between typing and submit | Low | Low | Rejected: all three submit entries had `canSend=true` |
| U | `onSend` returns without producing a visible projection | Low | Medium | Rejected for root/Bob/reply sends; each returned and rendered in both clients |
| AA | Native `DOMRect` values preserve all edges across the WebDriver script boundary | High | Low | Rejected: adjacent entries reached Python without `left` |
| AB | The pane-owned overlay rect itself is missing an edge | Low | Low | Rejected: overlay used the plain-object serializer and reached collision checks |
| AC | A product overlap was detected before the Gate exception | Low | Low | Rejected: collision evaluation aborted on adjacent deserialization |
| AD | Re-focusing an already-focused actor moves the Native pointer away from a transient overlay and dismisses it before the paced click completes | High | Low | Confirmed: row leave and the 140ms close timer fired after hover but before any Reply handler event |
| AE | A fixed post interval does not prove WKWebView consumed the previous click before the next target move | High | Low | Confirmed: the previous `mouseup` reached Send before the current `pointerdown/mousedown`, and no current `mouseup/click` followed |
| AF | Default 500ms acknowledgement polling holds a transient toolbar press past its 140ms close grace | High | Low | Confirmed: target `mousedown` was acknowledged, the close timer fired, and the subsequent `mouseup` had no target owner |

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

Accessibility-mapped rerun:
`20260821T023546815138Z-4467abd67e84c4886672d70b783c2bc9`.

- Source and Station matched commit
  `b2efe72d50561221eff50429a7f68b172e50d99e`; the dedicated binary SHA-256
  was `09d3ebb0ebef65575bf681ad4a9d3ea42aa19a2a5333b676f59bb3c7316e497b`.
- Alice and Bob launched in overlapping Native windows. The Gate failed during
  `group.create.ui`: Alice's WebDriver click found `[data-chat-new-menu]`, but
  the Ant `[data-chat-create-group-menu]` item remained present and hidden
  because Bob's later-launched window owned macOS focus.
- The run never entered `hover_message`; the debug NDJSON therefore remained
  empty and this run neither confirms nor rejects the Accessibility-mapped
  CoreGraphics input path.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

Exact-PID activation rerun:
`20260821T025017264835Z-8a21d90b63ab1bb5675afe3a715c2f80`.

- Source and Profile Three matched commit
  `ed7a677a5131796899815d461ecf664eda3a5d17`; Driver smoke passed and the
  dedicated binary SHA-256 was
  `1118c8dc619616fa0322d9a18865ce5861712243b0e215a4bec5a1be4551f7bc`.
- Provisioning reached `FIXTURE_READY`, but the first Alice UI action failed in
  `activate_actor_window`: exact-PID process activation did not make the raw
  dedicated WebView focused, and `document.hasFocus()` remained false.
- Bounded probes showed the Tauri window onscreen at `264,98,1200,801`, while
  LaunchServices exposed no bundle identity and the host IDE retained
  foreground ownership. Web-layer `setAlwaysOnTop` was denied by Tauri
  capability policy.
- The failure is owned by the Acceptance-only native host lifecycle, not Chat
  business behavior. The next comparison uses feature-gated host window slots,
  topmost ownership, and CoreGraphics click/hover with Retina-normalized
  WebDriver bounds.
- Cleanup released `3330`, `3331`, `4445`, and `4446`; no hover instrumentation
  ran, so the debug NDJSON remained empty.

Acceptance-only two-window probe:

- The rebuilt dedicated binary SHA-256 was
  `2c901c9c111ee472b1ff7ceadfbe17d9cbe93e81614e55b928007a6fcd67da94`.
- Alice occupied logical rect `0,33,864,800`; Bob occupied
  `864,33,864,800`. Their raw WebDriver rects were exactly 2x at Retina scale
  and did not overlap.
- A CoreGraphics title-bar click changed focus to
  `Alice=true, Bob=false`; the inverse click changed it to
  `Alice=false, Bob=true`.
- Probe ports `3340`, `3341`, `4455`, and `4456` were all free after reverse
  cleanup.
- This confirms the generic host lifecycle and coordinate normalization. It
  does not yet prove the Chat menu, hover overlay, or later product assertions;
  those remain for the source-bound product-closure Gate.

Source-bound product-closure rerun:
`20260821T064607367400Z-7459e447bcdc8a61d972b5c951690e19`.

- Source, rebuilt binary, and Profile Three matched clean commit
  `b7bf54ffbeaf88852981918c615f5038f386db62`; provisioning reached
  `FIXTURE_READY`. The dedicated binary SHA-256 was
  `ba6d4b41890cb08e5e7b1b5f59f75a02bb3a920581e9d7c107a753f086fc8685`.
- Group creation and actor-window focus passed. The first failure moved into
  `prove_transcript_thread`, after Alice typed the root message and before
  submission: `[data-chat-send]` failed the center ownership check with
  `Native click target center is occluded`.
- Hover was not reached, so the debug NDJSON remained empty. This run confirms
  the foreground lifecycle repair but does not prove hover or later product
  assertions.
- Cleanup evidence reported `3330`, `3331`, `4445`, and `4446` released.

Click-occlusion diagnostic run:
`20260821T065132580799Z-f95f32441418b54d29732ee3352a933e`.

- M and O were rejected: the send button rect was inside the viewport,
  `connected=true`, and `disabled=false`.
- N was confirmed: the center hit stack was led by a bottom-right LobeUI toast
  `DIV` with `role=dialog`; only the send button's bottom-right inset remained
  target-owned.
- The owner was `CreateGroupModal`'s success toast. Its placement was moved to
  `top` so completion feedback no longer covers the conversation primary
  action; the center ownership check remained unchanged.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

Post-toast-placement diagnostic run:
`20260821T065737113531Z-d0633f9032f75cbdd7580ca288d51073`.

- The M-P occlusion event disappeared, proving the send-button center became
  target-owned.
- The run timed out waiting for Alice's root message. Alice's app log recorded
  typing true/false but no `messaging_submit_message` request and no composer
  send failure, so the next comparison must distinguish Native event delivery
  from React click/submit entry.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

Native event-order diagnostic run:
`20260821T070426261276Z-52d2eb651bfafbea6fbd08080e0087df`.

- Q was rejected: the send button received `pointerdown` and `mousedown`.
- R was confirmed: Debug Server line 1 recorded `mouseup` before lines 2-3
  recorded `pointerdown` and `mousedown`; no later `mouseup`, `click`, submit
  entry, or messaging request appeared.
- The focus title-bar down/up and target move/down/up events were posted without
  a delivery interval. WindowServer/WKWebView therefore observed cross-location
  event reordering and could not synthesize a click.
- The generic Native mouse primitive must pace each posted event before any
  business action can rely on it. JS click, retry, and alternate-point
  workarounds remain forbidden.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

Paced Native input diagnostic run:
`20260821T071102527504Z-fd178f22b871fddd827c3bfbac14b2da`.

- A fixed 50ms interval after every CoreGraphics post restored ordered
  `pointerdown/mousedown -> mouseup -> click -> submit -> onSend return`.
- Alice root send, Bob root send, and Alice reply send all completed through
  the real button and rendered cross-client.
- The first real hover produced F/A/B/C/E events, `:hover=true`, connected
  anchor/surface ownership, and a `191x36` overlay geometry calculation.
- The Driver/foreground/Native-input lifecycle is therefore closed by runtime
  evidence. The next first failure is product-owned: the reply rendered, but
  the root row's thread summary projection did not reach count `1` within
  120 seconds.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

Clean source-bound handoff run:
`20260821T072034901028Z-51dcc08fd5f6a338f4253ddc8f940ba4`.

- Source, rebuilt binary, and Profile Three matched clean commit
  `3d1256c948ec0bad6d3b2cfeecc09d1dccacea32`; the dedicated binary SHA-256
  was `a069a5992510b6ad4c017d5bb2c0a51bf34cb6e45966c696427c9c603f638f9f`.
- The immutable report preserved ordered pointer/down/up/click/submit/onSend
  evidence for all three sends and F/A/B/C/E hover evidence with
  `:hover=true` and a `191x36` overlay.
- The Gate failed at the same next product boundary:
  `timed out waiting for thread summary projection`. This clean comparison
  closes the Driver foreground/Native-input diagnosis without proving the
  product closure.
- The durable report SHA-256 is
  `7ce236a0fe7fb5949fb1bdad89d4924ae19185ff69513abea245f31f7e0bb5e1`;
  cleanup evidence and an independent `lsof` check confirmed ports `3330`,
  `3331`, `4445`, and `4446` were released.

Adjacent geometry serialization run:
`20260821T085747312015Z-8ee1be3046571316504a0988f1cb3746`.

- `thread_exact=PASS` and `transcript_exact=PASS`.
- The Gate reached `overlay_geometry` and failed before a product collision
  judgment with `KeyError: 'left'`.
- AA was rejected: adjacent message content returned raw native `DOMRect`
  objects, while overlay, selected content, and pane used explicit plain
  objects. WebDriver did not preserve the raw adjacent edge fields.
- AB and AC were rejected: the overlay rect was valid and no overlap assertion
  ran.
- The Gate now serializes every adjacent rect through the same `rect()` helper;
  collision conditions remain unchanged.
- Cleanup evidence and direct `lsof` verification show ports
  `3330/3331/4445/4446` released.

Transient action refocus run:
`20260821T092456697805Z-9eb5cdac84a4179ccaf983c3fd3d3893`.

- The actor was already focused and the Reply overlay was visible after the
  real hover at timestamp `1787304449456`.
- `click_element` unconditionally posted another title-bar focus click. The
  row emitted `mouseleave` at `1787304449586`, and the 140ms overlay close
  timer fired at `1787304449727`.
- No Reply button handler, callback, reply-state commit, or inline-reply intent
  event followed. The next Composer send completed as an ordinary top-level
  message, so the Gate later timed out at thread summary projection.
- AD is confirmed: resolving a transient element before an unnecessary focus
  action invalidates the user target during paced Native delivery.
- The Driver fix must make focus idempotent and resolve selector targets only
  after focus ownership is established. Product Reply and thread projection
  behavior remain unchanged.
- Cleanup evidence and direct `lsof` verification show ports
  `3330/3331/4445/4446` released.

Idempotent-focus verification run:
`20260821T093354484080Z-7f080a8e2ca1c7ca4f44c3b9c7534a18`.

- The Reply overlay remained actionable long enough for the real Native click
  to enter the React handler.
- Reply handler, callback, state commit, send intent, immutable relation,
  summary, preview, and panel all converged; `thread_exact=PASS`.
- The same run also recorded `transcript_exact=PASS`,
  `toolbar_geometry=PASS`, and `reaction_picker_success=PASS`.
- AD is fixed in dirty runtime evidence: focus ownership is now idempotent and
  selector-based transient targets are resolved after focus.
- The next failure returned to the independent Reaction recovery path.
- Cleanup evidence and direct `lsof` verification show ports
  `3330/3331/4445/4446` released.

Clean source-bound verification:
`20260821T101103621394Z-083d69ddf9bbc5bdd1b97026df475f9d`.

- Source and Profile Three Station matched commit
  `04fe5680128ac008c350a264e5e9ac20c7000e1f`.
- `thread_exact`, `transcript_exact`, `toolbar_geometry`, and the later
  Reaction/identity assertions passed, confirming the Driver focus and
  transient action lifecycle on clean source.
- The first failure was the independent Mute projection.
- Actor and fault-proxy ports were released.

Native acknowledgement recurrence:
`20260821T103108217486Z-e695d7ae3893ecd1e2b33097cd853564`.

- Source, dedicated binary, and Profile Three Station matched commit
  `5d5606bd75784722d5c7647de7be88f2e9d59b87`; provisioning reached
  `FIXTURE_READY`.
- The real Reply handler, callback, and `replyToUlid` commit entered for Bob's
  exact root.
- The next Composer click did not reach `click`, `submit`, or `handleSend`.
  The DOM first received a prior `mouseup` on Send, then the current
  `pointerdown/mousedown`, with no matching current `mouseup/click`.
- The Gate therefore timed out waiting for Alice's visible reply before Mute.
  This does not reopen the Thread relation owner; the send intent was never
  constructed.
- AE is confirmed: fixed posting delay is not a consumption acknowledgement.
  The Driver must synchronize each Native event against passive DOM capture
  evidence instead of relying on a fixed sleep or retrying a business action.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

First acknowledgement run:
`20260821T104530388449Z-7aff353c561e04d3faa9fb86cb2428a5`.

- Alice and Bob root sends both completed with ordered
  `pointerdown/mousedown -> mouseup -> click -> submit -> onSend return`.
- The Reply toolbar target acknowledged `mousedown`, proving geometry, focus,
  movement, and target ownership.
- The Driver's default 500ms WebDriver poll held the press beyond the overlay's
  140ms close grace. The row-leave timer removed the toolbar before Driver
  posted `mouseup`, which then had no target owner.
- AF is confirmed. The acknowledgement loop must poll below the transient
  target grace while remaining event-driven; changing the product timer or
  retrying Reply would be a test workaround.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

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
Before the next comparison run, every actor-specific click and hover must target
a non-overlapping acceptance-only window slot, require `document.hasFocus()`,
and use Retina-normalized Native coordinates. Process activation alone is
rejected by the latest run and must not remain as a fallback.

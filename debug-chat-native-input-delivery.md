# Debug Session: chat-native-input-delivery
- **Status**: [OPEN]
- **Issue**: After verified actor foreground ownership, the first real CoreGraphics product click times out waiting for its `mousemove` DOM acknowledgement.
- **Debug Server**: http://127.0.0.1:7785/event
- **Log File**: `.dbg/trae-debug-log-chat-native-input-delivery.ndjson`

## Reproduction Steps
1. Deploy Profile Three from the same commit as the group-chat worktree.
2. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
3. Launch isolated Alice and Bob dedicated Acceptance clients.
4. Foreground Alice through the verified Accessibility owner path.
5. Attempt the first product click on `[data-chat-subpage="chats"]`.
6. Observe `wait_native_input_event(..., "mousemove")` time out.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|---|---|---|---|---|
| R | The cursor is already at the requested element center, so macOS suppresses a zero-distance move event | High | Low | Pre-move cursor coordinates equal the posted point and the DOM probe remains empty |
| S | The WebDriver-derived screen point does not hit Alice's live Native window after foreground switching | Medium | Low | WebView `elementFromPoint` identifies the target, but Native cursor/window ownership disagrees after the post |
| T | Alice loses foreground or document focus between actor activation and the product pointer post | Medium | Low | Pre/post move snapshots change from `frontmost=true/documentFocused=true` to false |
| U | The move reaches Alice but lands outside the target subtree, so the scoped DOM probe rejects it | Medium | Low | Document-level hit target differs from the requested element while unscoped pointer state changes |
| V | CoreGraphics posts the move but macOS coalesces or routes it without a WebView mouse event | Low | Medium | Cursor coordinates change to the requested point, actor remains focused, hit target is correct, and the DOM event list remains empty |
| W | Mouse events created with a null source are not tracked in the login session's combined event state | Medium | Low | Explicit `CGEventSourceCreate(kCGEventSourceStateCombinedSessionState)` restores WebView delivery |
| X | Requiring a staging `mousemove` before a zero-distance click invents an input precondition that a real stationary click does not have | High | Low | The cursor and target center already match; skipping movement still yields target-owned `mousedown -> mouseup -> click` acknowledgements |
| Y | A move-only event is not required to prove a Native click; target-coordinate down/up can establish click routing after verified actor activation | High | Low | Without a preliminary move wait, the target DOM receives `mousedown -> mouseup -> click` from the real CoreGraphics sequence |
| Z | The explicit combined-session source changes routing compared with the null-source primitive used by the last clean Native click PASS | High | Low | Restoring `CGEventCreateMouseEvent(None, ...)` makes target-owned `mousedown -> mouseup -> click` observable again |
| AA | Alice is process-frontmost but its Native window is not AXMain/AXFocused | High | Low | Process `frontmost=true` while front-window `AXMain` or `AXFocused` is false |
| AB | A higher WindowServer surface owns the target screen point above Alice | High | Medium | CGWindow z-order at `[81.5,95]` lists a different visible owner before Alice |
| AC | Alice is the key/main and topmost target-point window, but WindowServer still drops synthesized input | Medium | Medium | AXMain/AXFocused and z-order all identify Alice while no DOM event arrives |
| AD | The focused fast path inherits a combined-session left-button-down state because normalization only runs after `focus_actor_window` decides activation is required | High | Low | `before-click.mouseButtonDown=true` while document focus and WindowServer ownership already pass |
| AE | The button state starts released but the posted down is intermittently absent from both combined-session state and the target DOM | Medium | Low | `before-click.mouseButtonDown=false`, timeout remains false, and the scoped probe is empty |
| AF | The posted down reaches combined-session state but not the target DOM despite stable WindowServer ownership | Medium | Low | `before-click.mouseButtonDown=false`, timeout becomes true, target remains hit-owned, and the scoped probe is empty |
| AG | Reaction picker focus/leave handling closes the transient overlay after target-owned down but before Native up | High | Low | Picker focus/blur or leave schedules the 140 ms close timer between emoji down and unowned up |
| AH | The emoji action runs before click and intentionally replaces the target before Native up | Low | Low | Reaction mutation begins before any target-owned mouseup/click event |

## Log Evidence
Source-bound run:
`20260821T133210237489Z-37fbfe45307c3d14fefdc5dcbf9830e5`.

- Source, dedicated binary, and live Station matched at `050043ed9`.
- Foreground debug lines prove Alice reached
  `frontmost=true/documentFocused=true/AXWebArea`.
- The first product action then failed with
  `Native mousemove was not acknowledged by the target DOM`.
- Cleanup released ports `3330/3331/4445/4446/61634`.

Input-delivery instrumentation run:
`20260821T133833878316Z-25147cc3ddbb0eeb700f78496c0daf91`.

- Source, dedicated binary, and live Station matched at `36a98f452`.
- Debug line 1 captured cursor `[81.5,95]` exactly equal to the requested screen
  point `[81.5,95]`.
- Alice was `frontmost=true`, `documentFocused=true`, and focused on
  `AXWebArea`; the WebView center hit was connected, enabled, and owned by the
  requested Chats element.
- Debug line 2 retained the same cursor/point and an empty scoped event list
  after timeout.
- Cleanup released ports `3330/3331/4445/4446/62813`.

| ID | Status | Evidence |
|---|---|---|
| R | Confirmed | Cursor and requested point were exactly equal before and after the posted move, so macOS emitted no movement |
| S | Rejected | WebView geometry and Native cursor both resolved to `[81.5,95]` inside Alice's live window |
| T | Rejected as the trigger | Alice was frontmost and document-focused before the move |
| U | Rejected | Center and all alternate probes were owned by the requested element subtree |
| V | Rejected | The cursor never changed; no routed/coalesced movement existed to deliver |

## Verification Conclusion
The Driver incorrectly requires a `mousemove` acknowledgement even when the
cursor is already at the requested target point. macOS suppresses zero-distance
mouse movement, so the scoped probe remains empty. The minimal fix must first
move to a different, already verified owned probe point when the cursor equals
the center, require that real movement acknowledgement, then move back to the
center and continue the existing down/up/click sequence. Post-fix source-bound
verification is pending.

First staging source-bound run:
`20260821T134416643171Z-4d64ff333c8e21460d0ff508e3edf033`.

- Source, dedicated binary, and live Station matched at `2dab48e2f`.
- The selected alternate point `[67.5,81]` differed from center `[81.5,95]`
  and came from a target-owned DOM probe.
- The Gate failed waiting for the staging move acknowledgement before posting
  the center move.
- The current instrumentation only reports center-move timeout, so it did not
  capture the Native cursor/focus state after the staging post.
- Cleanup released ports `3330/3331/4445/4446/63919`.

The next instrumentation run must capture `staging-timeout` before changing
CoreGraphics event-source or activation behavior.

Staging-timeout source-bound run:
`20260821T135059847646Z-31c63fd76c11542ad3f8aefe00f05dbf`.

- Source, dedicated binary, and live Station matched at `09d4e800a`.
- The inherited cursor started at the prior staging point `[67.5,81]`, so this
  run correctly skipped staging and posted a real move to center `[81.5,95]`.
- The timeout snapshot proved the Native cursor reached `[81.5,95]`, while the
  scoped WebView probe remained empty.
- Alice was frontmost and document-focused before the post; document focus was
  lost only during the unacknowledged global-event wait.
- Cleanup released all actor ports.

This confirms V for the global event path: CoreGraphics moves the system cursor,
but the globally posted event is consumed outside the intended actor WebView.
The next experiment routes product pointer events with
`CGEventPostToPid(actor_pid, event)` to determine whether process-directed
delivery is supported by the WKWebView path.

PID-directed source-bound run:
`20260821T140156042704Z-412fb03495dd1540aedadbf9441c97e5`.

- Source, dedicated binary, and live Station matched at `e95945727`.
- PID-directed movement left the global cursor at center and produced no
  WebView event, while Alice remained `frontmost=true`,
  `documentFocused=true`, and focused on `AXWebArea`.
- Cleanup released ports `3330/3331/4445/4446/50534`.

`CGEventPostToPid` is rejected for this WKWebView pointer path. The local macOS
SDK specifies that events posted from a login session must use an explicit
`CGEventSourceCreate(kCGEventSourceStateCombinedSessionState)` source. The next
repair restores global posting with combined-session source state `0`, matching
the state table used by `CGEventSourceButtonState`.

Combined-session source-bound run:
`20260821T140930898866Z-70a6c0737f1e5fc4586be3fd498a52e2`.

- Source, dedicated binary, and live Station matched clean commit
  `ac741606a04536019980b204edc116c9c86561b0`.
- The explicit combined-session source moved the Native cursor from center
  `[81.5,95]` to the target-owned staging point `[67.5,81]`, but the DOM probe
  remained empty and the WebView lost document focus.
- `CGPreflightPostEventAccess`, `CGPreflightListenEventAccess`, and
  `AXIsProcessTrusted` all returned true for the runner process.
- Cleanup evidence and direct `lsof` verification proved actor ports
  `3330/3331/4445/4446` were released.

W is rejected: source state and TCC authorization do not explain the missing
staging acknowledgement. The remaining defect is the Driver's invented
precondition. A physical click does not require mouse movement when the cursor
already occupies the target center. The next comparison preserves movement
acknowledgement for non-zero-distance actions, but for a stationary click it
must proceed directly to the real CoreGraphics down/up sequence and require
target-owned `mousedown`, `mouseup`, and `click` acknowledgements.

Conditional-movement source-bound run:
`20260821T142028343355Z-c819251376fb096b4465f6bbf55f3333`.

- Source, dedicated binary, and live Station matched clean commit
  `098433b214100932dae13c409439b5df61befc85`.
- The inherited cursor started at `[67.5,81]`, so the stationary-click branch
  correctly did not apply. The Driver posted a real move to target center
  `[81.5,95]`; the cursor moved, the scoped DOM probe remained empty, and the
  WebView lost document focus.
- The run therefore neither confirms nor rejects X. It confirms that requiring
  move-only acknowledgement before every click still prevents the actual
  CoreGraphics down/up sequence from being exercised.
- Cleanup evidence and direct `lsof` verification proved actor ports
  `3330/3331/4445/4446` were released.

The next comparison removes `mousemove` as a click precondition entirely while
retaining the exact target hit test and real CoreGraphics down/up events.
`mousedown`, `mouseup`, and `click` remain mandatory DOM acknowledgements.
Actual hover remains a separate movement-owned product assertion and is not
weakened by this click correction.

Direct-click source-bound run:
`20260821T142850753410Z-872dd45dc83adaf056bf346fcf4b6409`.

- Source, dedicated binary, and live Station matched clean commit
  `87ed95366b8e70575cc8bd2c5256228c0f72d86b`.
- Before the first click, Alice was frontmost, document-focused, and focused on
  `AXWebArea`; cursor and target center both equaled `[81.5,95]`.
- The explicit combined-session source posted `leftMouseDown`, but the scoped
  DOM probe remained empty. Alice stayed frontmost and document-focused.
- Failure recovery returned combined-session left-button state to `false`.
- Cleanup evidence and direct `lsof` verification proved actor ports
  `3330/3331/4445/4446` were released.

Y is rejected for the explicit combined-session source. The next minimal
comparison restores the null event source used by historical clean run
`20260821T101103621394Z-083d69ddf9bbc5bdd1b97026df475f9d` at `04fe56801`,
while retaining direct down/up/click acknowledgement and button-state recovery.

Null-source direct-click run:
`20260821T143736652553Z-a70d426890b88b2c0ab859631292097f`.

- Source, dedicated binary, and live Station matched clean commit
  `66c021d80c103fd520e7aaf15e056c00f2a60ed2`.
- Null-source `leftMouseDown` produced the same empty DOM probe while Alice
  remained `frontmost=true`, document-focused, and focused on `AXWebArea`.
- Failure recovery left combined-session button state false.
- Cleanup evidence and direct `lsof` verification proved actor ports
  `3330/3331/4445/4446` were released.

Z is rejected. Event construction is no longer a live hypothesis. A read-only
WindowServer snapshot outside the actor run shows higher-layer full-screen
surfaces above normal application windows, so the next instrumentation must
capture target-point z-order and Alice front-window `AXMain/AXFocused` during
the failed click. No input behavior changes are authorized before that evidence.

Window-ownership source-bound run:
`20260821T144649005191Z-b0240d40e3baa76cfd52be14904589d0`.

- Source, dedicated binary, and live Station matched clean commit
  `d95aded90f6ff8993e8332012b6b6b310c05e708`.
- Alice's process was the actual frontmost PID and its front window was
  `AXMain=true`, but the front window remained `AXFocused=false` both before
  the click and after `mousedown` timeout.
- Alice's window occupied layer `5` at the target point. Higher-layer
  full-screen Lark Helper and Dock surfaces were present, but did not change
  while Alice remained the actual frontmost process.
- The DOM target, cursor, and screen point all matched `[81.5,95]`; no scoped
  event arrived.
- Failure recovery left combined-session button state false, and cleanup
  released ports `3330/3331/4445/4446`.

AA is confirmed and AC is rejected as the current trigger: process foreground,
DOM focus, and AXWebArea focus did not imply front-window ownership. The
Acceptance-only activation path must explicitly set and verify front-window
`AXFocused=true` before any product input. AB remains an observed environmental
surface but is not yet the selected cause because Alice never acquired focused
window ownership.

Isolated event-routing probe:

- A fresh dedicated Acceptance binary was launched on isolated ports
  `3340/4455`; both ports were released after the probe.
- System Events activation and
  `NSRunningApplication.activateWithOptions(ActivateAllWindows |
  IgnoringOtherApps)` both produced the same stable Tauri state:
  process frontmost, `AXMain=true`, and `AXFocused=false`.
- A passive `kCGAnnotatedSessionEventTap` observed the real CoreGraphics
  `leftMouseDown` at `[200,265]`. WindowServer annotated
  `targetPid=92990` (`Lark Helper`), while the dedicated app PID was `33796`.
- The dedicated DOM received no `mousedown`.

This retracts AA as the root cause: `AXFocused=false` is stable for this Tauri
window even after both supported activation paths. AB is confirmed by direct
event routing, not only z-order: the higher layer-100 full-screen Lark Helper
surface owns the synthesized click. The correct Acceptance-only host repair is
to raise dedicated windows above that surface for the Gate lifetime, without
hiding or terminating the user's external application.

Acceptance-window-level post-fix verification:

- The first `run_on_main_thread` implementation was insufficient. A 10 ms
  startup timeline observed the dedicated window at layer `1000` around
  `848.9 ms`, followed by a deterministic fallback to layer `5` around
  `894.1 ms` while the queued window layout completed.
- Tao `0.34.8` source confirmed that macOS `set_always_on_top(true)` enqueues
  `setLevel(NSFloatingWindowLevel)` on the serial main dispatch queue, while
  Tauri `run_on_main_thread` executes immediately when called from setup on the
  main thread.
- The corrected Acceptance-only host path enqueues
  `setLevel(NSScreenSaverWindowLevel)` on that same serial dispatch queue after
  Tauri's request. The rebuilt dedicated binary SHA-256 is
  `ebb0b855e50253a40657c8c5cd0b4f2c41cbefef2a53b6c8f73304bb072844c5`.
- The post-fix startup timeline observed only layers `0` and `1000`; after the
  layout completed, the window remained at layer `1000` with no layer-5
  regression.
- The isolated annotated-session event-tap probe observed app PID `2990` at
  layer `1000`, above Lark Helper PID `92990` at layer `100`. WindowServer
  annotated the real CoreGraphics `leftMouseDown` with `targetPid=2990`, and
  the dedicated WebView received `mousedown` at screen point `[200,298]`.
- `make acceptance-driver-smoke` passed. Probe and smoke teardown released
  ports `3340/3350/4445/4455/4465`.

AB is confirmed as the pre-fix cause and closed by source-bound post-fix
evidence. The input-routing blocker is removed; MP-W13 remains unproven until
the complete Native product-closure Gate passes.

Two later clean-source runs exposed a second input-lifecycle failure family:

- `20260821T171341782516Z-5d658323078dc72992c3648df9dd36a9`
  reached the Thread Reply action, delivered target-owned `pointerdown` and
  `mousedown`, then failed because `pointerup`, `mouseup`, and `click` never
  arrived.
- `20260821T171744923762Z-dec764d855f89c531cd462e2cea44b12`
  crossed Thread Reply and the first reaction add/remove/retry setup, then
  failed on the reaction retry because the target-owned probe remained empty
  after posting `leftMouseDown`.
- In the second run Alice remained `documentFocused=true`, WindowServer index
  `0` belonged to Alice PID `89064`, and the retry target remained connected,
  enabled, and hit-owned before and after timeout.
- Cleanup passed and direct `lsof` checks found no listeners on
  `3330/3331/4445/4446`.

The repeated down/up loss rejects an isolated product target defect. Existing
snapshots do not record combined-session button state, so AD-AF remain
inconclusive. The next pre-fix comparison adds that state to the existing
snapshot without changing event delivery.

Button-state instrumentation run:
`20260821T173208817021Z-afe37eed1d1306e5f45db0c67b41f010`.

- Source, dedicated binary, and Profile Three Station matched clean commit
  `b43307773f219449e2149e25e655b82ae009be14`.
- Thirty real Native product clicks crossed Thread, Reaction, Mute, Pin, and
  the first Background chooser without a down/up acknowledgement failure.
- Every `before-click` snapshot recorded `mouseButtonDown=false`.
- The first failure moved to the Background chooser state machine, not Native
  pointer delivery; cleanup released all actor ports.

| ID | Status | Evidence |
|---|---|---|
| AD | Rejected | No click inherited a combined-session left-button-down state |
| AE | Inconclusive | This run did not reproduce a missing down event |
| AF | Inconclusive | This run did not reproduce a routed-without-DOM down event |

The instrumentation remains active because the intermittent down/up loss is
not closed by one non-reproducing run. The current dependency-ready defect is
the source-backed Background chooser false terminal documented in
`debug-chat-background-picker.md`.

Reply-mouseup recurrence:
`20260821T204928275912Z-77be15179988c07ddb06439608387545`.

- Source, dedicated binary, and live Station matched clean commit
  `5f3e426a4a14cbbca8ee33ae547873e19913fa98`; the rebuilt binary SHA-256 was
  `dd28a2b59e6e2e8f05110b2e459fea8c76a48c9693f39ac9d40ffe1a7fa758a8`.
- Alice received target-owned `pointerdown` and `mousedown` on the reply
  button. The target remained connected, enabled, and hit-owned; Alice
  remained document-focused, frontmost, and WindowServer index `0`.
- After the timeout, combined-session button state was `false`, proving the OS
  no longer considered the button pressed, but the target-scoped probe had no
  `pointerup`, `mouseup`, or `click`.
- The Gate failed before the chooser, and cleanup released
  `3330/3331/4445/4446/52946`.

This recurrence rejects actor ownership, target occlusion, and a stuck OS
button as the immediate cause. The current probe discards document-capture
events whose target is outside the intended element, so it cannot distinguish
an entirely missing mouseup from a mouseup delivered to a shifted/different DOM
target. The next instrumentation records all document-capture pointer/mouse
events with an `owned` marker while preserving `owned=true` as the Gate success
condition.

Unowned-event comparison:
`20260821T205757910720Z-36270d1b46171b153e98c066065e7c77`.

- Source, dedicated binary, and live Station matched clean commit
  `f1cc4235788a3ae1445062ab488442b990abb74e`; the rebuilt binary SHA-256 was
  `fc3d3c68b3e522be6fab76e95c62272ffd3c202552969e9a507e87302d265e2b`.
- The Gate crossed Thread/Transcript, toolbar geometry, and Reaction success,
  then reached the real Reaction failure retry button.
- Immediately before event delivery, the retry button was connected, enabled,
  and owned its center. The actual `pointerdown` and `mousedown` reached the
  same document and coordinates but targeted an unowned `DIV`.
- Alice remained frontmost and WindowServer index `0`; cleanup released
  `3330/3331/4445/4446/54720`.

This confirms a preflight-to-post race inside `click_element`: target geometry
can change after the expensive diagnostic snapshot but before CoreGraphics
posts the event. The correction keeps the failure snapshots, removes the
blocking pre-click report, and performs a final connected/enabled/hit-owned
geometry read immediately before `leftMouseDown`. The Gate still rejects any
event whose actual DOM target is not owned by the intended element.

Reaction-picker mouseup recurrence:
`20260822T011615401653Z-6b0dc83ae55bc3aa3e19f5faa39bce61`.

- Clean source, dedicated binary, and live Station matched `d67a48a0d`.
- Thread exactness, transcript exactness, and toolbar geometry passed.
- The reaction emoji was connected, enabled, and center-owned before input.
- Its probe recorded target-owned `pointerdown/mousedown`, followed by
  `pointerup/mouseup` at the same coordinates on an unowned message-row `DIV`.
- Alice remained document-focused and WindowServer index `0`; combined-session
  button state returned to released.

This rejects a lost Native up event for this run. The picker target was removed
between down and up. Existing logs do not identify whether focus/leave close
logic or an early reaction mutation caused the teardown, so AG and AH remain
inconclusive. The next instrumentation records picker focus, pointer boundary,
and emoji press/click order without changing behavior.

Reaction-picker lifecycle instrumentation run:
`20260822T013542398002Z-baa3ad2dbb0fd615b5eda703d4393ba2`.

- Source, dedicated binary, and live Station matched clean commit `eec57c834`.
- The complete Native product-closure Gate passed with `DONE/PROVEN`.
- For both successful picker selections, the emoji received
  `pointerdown`, then the picker emitted `blur` with
  `relatedTarget=null` and `pointerInside=true`.
- Native `mouseup` and `click` followed 7-16 ms later, before the 140 ms
  action-close timer could remove the picker.
- Reaction mutation started only from `click`, after the target-owned up.

| ID | Status | Evidence |
|---|---|---|
| AG | Confirmed | WebKit clears focus to `BODY` during an in-surface mouse press; the current blur handler schedules dismissal even though the pointer remains inside |
| AH | Rejected | The reaction action begins from `click`, after `mouseup`; it does not remove the target early |

The previous failure is therefore a real hold-duration race: if Native
acknowledgement or a user's press exceeds the close grace, the blur-scheduled
timer removes the picker before release. The minimal product fix records
pointer containment and ignores blur dismissal while the pointer remains
inside. Pointer-leave and true keyboard-focus departure continue to use the
existing close path. Instrumentation remains active for post-fix comparison.

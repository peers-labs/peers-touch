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

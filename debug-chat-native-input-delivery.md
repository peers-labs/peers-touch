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

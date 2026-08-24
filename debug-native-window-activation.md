# Debug Session: native-window-activation
- **Status**: [OPEN]
- **Issue**: The source-bound Native Chat Gate times out while establishing
  cooperative focus even though macOS is unlocked and the target client emits a
  real window-focus lifecycle event.
- **Debug Server**: http://127.0.0.1:7781/event
- **Log File**: `.dbg/trae-debug-log-native-window-activation.ndjson`

## Reproduction Steps
1. Verify exact source, Station, and dedicated Acceptance binary identity.
2. Verify the macOS console has no `CGSSessionScreenIsLocked` marker.
3. Run `CHAT_ACCEPTANCE_RESET=1 CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 make acceptance-chat-native-product-closure`.
4. Observe the first `group.create.ui` action entering `focus_actor_window()`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | Cooperative activation reaches the target process but WKWebView never reports `document.hasFocus()`. | High | Low | Target PID owns the sampled point while `document.hasFocus()` remains false. | Pending |
| B | The title-bar sample point does not belong to the target Native window after activation. | High | Low | `document.hasFocus()` is true or a focus event fires, but the window stack reports another owner PID at the sampled point. | Pending |
| C | The requested process identity or frontmost application changes during activation. | Medium | Low | Requested PID differs from the frontmost PID or the target process disappears/relaunches. | Pending |

## Instrumentation
- Pending: emit bounded predicate snapshots before activation, after cooperative
  activation, and on timeout.
- Evidence must be persisted by the Gate report and the debug server without
  changing focus behavior or weakening the Native interaction contract.

## Verification Conclusion
Run `20260824T014750099197Z-47e3f53fb567f303db17e5708f24a31a`
produced the first immutable `native-activation-diagnostics` artifact:

- Before activation, Alice had `documentFocused=false`, AX `windowCount=0`,
  `pointOwned=false`, and actual frontmost PID `64981` (`WeChat`).
- The sampled point was occupied by the full-screen WeChat window and its Dock
  fullscreen backdrop.
- No `after-cooperative-request` snapshot was emitted, so cooperative activation
  was unavailable and the runner selected the AppKit fallback.
- The timeout occurred in the subsequent point-ownership wait. The first probe
  did not capture post-fallback state, so hypotheses B and C remain
  inconclusive and require one bounded instrumentation iteration.

Run `20260824T015227003626Z-acf922f1d95eb52797070976b3148b37`
captured the complete fallback boundary:

- Before fallback, Alice had no current-Space window and WeChat owned the
  sampled point.
- Immediately after fallback, Alice became the actual frontmost process and
  `documentFocused=true`, but Alice still had no current-Space WindowServer
  entry and `pointOwned=false`.
- Five seconds later, frontmost and document focus returned to full-screen
  WeChat while Alice remained absent from the current Space.

| ID | Status | Evidence |
|----|--------|----------|
| A | Rejected as root cause | Alice reported `documentFocused=true` immediately after fallback activation. |
| B | Confirmed | Alice never owned the sampled point because its window was absent from the current full-screen Space. |
| C | Consequence, not root cause | Frontmost moved to Alice transiently, then returned to WeChat after the target window failed to join the active Space. |

## Fix
- Keep the immutable activation diagnostic artifact and its static contract.
- Configure only the `acceptance-webdriver` macOS window with
  `CanJoinAllSpaces | FullScreenAuxiliary` in addition to its existing
  screen-saver level.
- Preserve the real CoreGraphics input path and all focus/point-ownership
  assertions.

## Post-Fix Evidence
Exact-HEAD run `20260824T020842025058Z-dff949138ed1919b0a9b946d8b7cd55c`
ran with full-screen WeChat still frontmost at preflight and crossed every
recorded Alice/Bob activation handoff. Its 14 activation snapshots contain no
timeout phase; every post-request snapshot records
`documentFocused=true`, `pointOwned=true`, AX `windowCount=1`, and the expected
actor at WindowServer layer 1000. The Gate continued through transcript,
thread, toolbar, reaction, identity, settings/background, failed-attachment,
and attachment-only assertions before failing at the later text input boundary.

# Debug Session: linux-native-file-picker-timeout
- **Status**: [OPEN]
- **Issue**: Linux Native Acceptance intermittently times out while transitioning from the attachment button to a native file chooser or browser fallback.
- **Debug Server**: http://100.86.255.160:7777/event
- **Log File**: `.dbg/trae-debug-log-linux-native-file-picker-timeout.ndjson`

## Reproduction Steps
1. Prepare the `desktop-linux-native` runtime cell at exact source commit `556d86d97e8b270c9763270fa53eca8211a2eeb4`.
2. Keep the disposable Station at `http://10.37.94.156:18132` healthy.
3. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure RUNTIME_CELL=desktop-linux-native`.
4. Observe the attachment step in `prove_attachments`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| H1 | Missing XDG desktop portal prevents `rfd` from returning and no browser fallback becomes ready. | High | Low | Rejected: Zenity opened as an owned dialog in both observed chooser attempts. |
| H2 | A valid restored Desktop main window is misclassified because its transient AT-SPI role maps to `kind=unknown`. | High | Medium | Confirmed: the failed attempt restored one owned, frontmost, focused main window, but the predicate rejected `kind=unknown`. |
| H3 | Actor focus or point ownership is lost between attachment click and chooser interaction. | Medium | Low | Rejected: the failed attempt retained `frontmost=true`, `mainWindow=true`, `focusedWindow=true`, and the actor PID. |
| H4 | The selected fixture path is not visible as a regular file inside the remote actor namespace. | Low | Low | Rejected: staged paths had the expected empty-file SHA-256 and were pasted verbatim into the chooser. |

## Log Evidence
- Pre-fix run: `20260827T081012505735Z-c310ce00ad57b54ecd122a8df4d430db`.
- Product assertions 1-18 passed before `choose_native_file` timed out.
- Runtime log records `Failed to pick file: ... org.freedesktop.portal.Desktop was not provided by any .service files`.
- Cleanup assertions and resource release all passed.
- Instrumented pre-fix run: `20260827T083649233548Z-28e662b18d7e20ed61325713680b760f`.
- Log lines 9-16 prove the second chooser opened, received the exact staged path, closed, and restored the actor-owned main window.
- Line 16 records the timeout with `windowCount=1`, `dialogCount=0`, `frontmost=true`, `mainWindow=true`, `focusedWindow=true`, `actualFrontmostPid=568`, and `kind=unknown`.

## Verification Conclusion
The selection transition predicate incorrectly treats every `kind=unknown`
snapshot as incomplete before evaluating stable main-window ownership. WebKitGTK
can transiently expose its focused scroll pane as an unknown accessibility kind
after Zenity closes. The fix must recognize the restored actor-owned main
window from EWMH ownership and focus fields while continuing to reject open
dialogs, reduced window counts, and unfocused windows.

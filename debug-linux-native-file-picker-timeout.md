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
| H1 | Missing XDG desktop portal prevents `rfd` from returning and no browser fallback becomes ready. | High | Low | Pre-fix app log records `org.freedesktop.portal.Desktop` missing; transition timeout follows. |
| H2 | A fallback chooser window exists but Linux window detection does not recognize its actual class/title. | Medium | Medium | Pending chooser-window snapshots before and during transition. |
| H3 | Actor focus or point ownership is lost between attachment click and chooser interaction. | Medium | Low | Pending focus and point-owner samples around the click. |
| H4 | The selected fixture path is not visible as a regular file inside the remote actor namespace. | Low | Low | Pending remote path existence/type sample before chooser invocation. |

## Log Evidence
- Pre-fix run: `20260827T081012505735Z-c310ce00ad57b54ecd122a8df4d430db`.
- Product assertions 1-18 passed before `choose_native_file` timed out.
- Runtime log records `Failed to pick file: ... org.freedesktop.portal.Desktop was not provided by any .service files`.
- Cleanup assertions and resource release all passed.

## Verification Conclusion
Pending targeted instrumentation and reproduction.

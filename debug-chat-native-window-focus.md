# Debug Session: chat-native-window-focus
- **Status**: [OPEN]
- **Issue**: The source-bound Native Chat Gate cannot focus Alice before the first visible Chat click after two consecutive clean launches.
- **Debug Server**: http://127.0.0.1:7784/event
- **Log File**: `.dbg/trae-debug-log-chat-native-window-focus.ndjson`

## Reproduction Steps
1. Deploy Profile Three from the same commit as the group-chat worktree.
2. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
3. Launch isolated Alice and Bob dedicated Acceptance clients.
4. Attempt the first Alice click on `[data-chat-subpage="chats"]`.
5. Observe `focus_actor_window` time out waiting for `document.hasFocus()`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|---|---|---|---|---|
| N | macOS completes activation only after mouse-up, while the Driver waits for focus after mouse-down | High | Low | Mouse button state becomes down, document focus remains false, and no mouse-up is posted before timeout |
| O | The computed title-bar point is outside Alice's actual Native window | Medium | Low | Window rect and posted point disagree with the live CG window bounds or no pointer event reaches the process |
| P | The first CG click is swallowed because the app process is not frontmost | Medium | Low | Button state transitions but frontmost PID remains another process and document focus stays false |
| Q | Another Native sheet/window or delayed boot focus owns the process | Low | Medium | AX window/sheet counts or focused control identify another owner while the WebView remains unfocused |

## Log Evidence
Pre-instrumentation source-bound runs:

- `20260821T125041452844Z-375868b2b8148432230f265e01e970eb`
- `20260821T125320259319Z-232b4a25a1b4f62e6472b71d1925a6d6`

Both runs matched source, dedicated binary, and live Station at `0955333fe`,
reached `FIXTURE_READY`, then timed out in `focus_actor_window` before the first
Alice click while waiting for `document.hasFocus()` after Native mouse-down.
Both cleanup artifacts released all actor and proxy ports.

## Verification Conclusion
Pending.

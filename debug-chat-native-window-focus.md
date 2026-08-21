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

Foreground instrumentation run:
`20260821T130858914586Z-e9040dea97615f90b0211321ef75b4f4`.

- Source, dedicated binary, and live Station matched at
  `f74596126ac132ae2b5ce357bc521c089b400fa4`.
- Debug line 1 captured Alice before the focus click with
  `mouseButtonDown=true`, `documentFocused=false`, `frontmost=false`,
  `window=[0,33,864,800]`, point `[432,49]`, and no Native sheet.
- Debug line 2 captured the same state after posting mouse-down.
- The Driver then timed out waiting for `document.hasFocus()` and never reached
  its mouse-up statement.
- Cleanup evidence released ports `3330/3331/4445/4446/57935`.

| ID | Status | Evidence |
|---|---|---|
| N | Confirmed | The Driver waits for focus after mouse-down and cannot post mouse-up on timeout; the next run entered with the global left button already down |
| O | Rejected | `[432,49]` is inside the recorded Alice window `[0,33,864,800]` |
| P | Confirmed | Alice remained `frontmost=false` before and after mouse-down |
| Q | Rejected | Alice had one window, zero sheets, and no competing AX focused control |

## Verification Conclusion
The Acceptance-only foreground lifecycle is the root cause. A failed activation
leaves the global left mouse button down across Gate runs, and macOS does not
activate the application before the Driver's premature focus wait. The minimal
fix normalizes any inherited button-down state, posts a complete move/down/up
sequence, guarantees mouse-up in `finally`, and waits for WebView focus only
after mouse-up.

First post-fix source-bound run:
`20260821T131904118790Z-a683811bb5367b9b497436b8b8968f68`.

- Source, dedicated binary, and live Station matched at `ef43efa52`.
- Debug lines 1-4 prove the inherited mouse state was recovered and the
  activation click completed:
  `down -> recovery-up -> down -> up`.
- Alice remained `frontmost=false` and `documentFocused=false` after mouse-up,
  then the Driver timed out waiting for focus.
- Cleanup released ports `3330/3331/4445/4446/59400`.

This rejects a complete CoreGraphics click as sufficient when another
application window owns the frontmost layer. The remaining repair belongs to
the Acceptance Driver's actor-window ownership: raise and foreground the target
macOS process through Accessibility, verify frontmost ownership, then retain
the real CoreGraphics click for product interaction. Post-fix foreground
ownership verification is pending.

Foreground-owner source-bound run:
`20260821T132551271228Z-51015327c9968c335fcbc0109464599d`.

- Source, dedicated binary, and live Station matched at `0130a00bb`.
- Debug line 2 proved the Accessibility activation worked:
  `frontmost=true`, `documentFocused=true`, focused role `AXWebArea`.
- Debug lines 3-4 proved the subsequent title-bar down/up was redundant; the
  WebView was already focused before it ran, and the delayed post-click state
  then caused the final `document.hasFocus()` wait to time out.
- Cleanup released ports `3330/3331/4445/4446/60512`.

The foreground owner is now correct. The remaining Driver defect is redundant
refocus after successful activation. `focus_actor_window` must return after
verified Accessibility foreground/WebView focus; the subsequent product
element action remains a real CoreGraphics pointer sequence with DOM
acknowledgements.

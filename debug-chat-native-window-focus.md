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

No-refocus source-bound run:
`20260821T133210237489Z-37fbfe45307c3d14fefdc5dcbf9830e5`.

- Source, dedicated binary, and live Station matched at `050043ed9`.
- Foreground debug lines prove Alice transitioned directly from
  `frontmost=false/documentFocused=false` to
  `frontmost=true/documentFocused=true/AXWebArea`.
- The Gate crossed `focus_actor_window` and failed later in the first product
  `click_element` while waiting for its `mousemove` DOM acknowledgement.
- Cleanup released ports `3330/3331/4445/4446/61634`.

The actor-window foreground lifecycle is fixed by source-bound evidence. The
new product-input delivery failure is tracked separately in
`debug-chat-native-input-delivery.md`. This session remains `[OPEN]` until the
full Native product path is verified and the user confirms cleanup.

High-window-level actor-switch run:
`20260821T153201367506Z-7cc4a89bbc0aca7717de6874f256573b`.

- Source, dedicated binary, and live Profile Three Station matched clean commit
  `7c7b63bb89cc2539201d157f98949d9a42b2cf65`.
- Alice completed the Chats, new-group menu, create-group option, Bob member
  selection, and create submit actions through real CoreGraphics clicks.
- After Bob received the new group projection, the Gate timed out in the first
  ownership wait while switching from Alice to Bob. Cleanup released ports
  `3330/3331/4445/4446/63045`.
- An isolated two-window probe showed that both System Events and AppKit
  activation can return success while `NSWorkspace.frontmostApplication`
  remains the last-launched PID. After switching to Alice, Alice's WebView was
  focused and its layer-1000 window was WindowServer index `0`, while the
  reported actual frontmost PID remained Bob.
- A stricter AX comparison showed `frontmost` and `AXMain` can also return false
  after the target WebView and WindowServer ownership have switched. These
  process-wide flags are not stable hard gates for two independent
  screen-saver-level Tauri processes.
- WindowServer target ownership alone was insufficient for the first click on
  an unfocused actor: macOS delivered pointer/mouse movement with
  `buttons=1`, established document focus, and withheld DOM `mousedown`.

Conditional focus-click verification:

- The Driver now treats WindowServer top ownership at the actor's independent
  screen point as the pointer-routing prerequisite.
- When the actor WebView is not focused, it activates/raises the process, posts
  one complete title-bar CoreGraphics down/up sequence with guaranteed mouse-up
  recovery, and waits for `document.hasFocus()` before the product click.
- When the actor WebView is already focused, it skips the title-bar click.
- An isolated real-input sequence `Alice -> Bob -> Alice -> Bob` produced click
  counters `1,1,2,2` through the same `click_element` implementation and
  released ports `3340/3341/4455/4456`.

The actor-switch ownership defect is closed in isolated runtime evidence.
Source-bound product-Gate verification remains pending, and this session stays
`[OPEN]`.

Source-bound recurrence:
`20260821T175501025454Z-2dd1cd8614176a72fb51b1801545175a`.

- Source, dedicated binary, and Profile Three Station matched clean commit
  `e3f550adabd4ec3e43655f77f002c51d2d317d7d`.
- Alice completed five real Native product clicks with released button state.
- On the first Alice-to-Bob switch, Bob had one layer-1000 window at
  WindowServer index `1`, an AXWebArea focused control, no sheet, and
  `documentFocused=false`; Alice remained the actual frontmost PID.
- The ownership wait after activation completed, but the subsequent title-bar
  down/up did not establish Bob `document.hasFocus()` within five seconds.
- Cleanup passed and ports `3330/3331/4445/4446` were released.

Existing evidence does not distinguish whether WindowServer ownership was lost
after the wait or whether the completed focus click was routed without WebView
focus. The next instrumentation records `after-owner` and
`after-focus-click` snapshots without changing activation or pointer behavior.

Focus-boundary source run:
`20260821T180608267628Z-3d94f919d24e15176abbc9c7bd09bce5`.

- Source, dedicated binary, and Profile Three Station matched clean commit
  `172cdc4a2de82d7002d50f940576b1f4bba98da6`.
- Before switching, Alice PID `15907` owned the left target point and held
  `documentFocused=true`.
- Bob PID `15944` already owned the non-overlapping right target point, but
  `actualFrontmostPid` remained Alice before activation, after the ownership
  wait, and after the complete title-bar click.
- Bob retained `documentFocused=false`, `mouseButtonDown=false`, and
  `AXWebArea` after the click. WindowServer point ownership never moved away
  from Bob because Alice does not cover Bob's half of the display.
- The Gate therefore timed out before Bob's product click. Cleanup passed and
  ports `3330/3331/4445/4446` were released.

The evidence confirms that point ownership is necessary but cannot establish
process activation for spatially disjoint high-level windows. The current
activation primitive only uses System Events and AXRaise, while the isolated
comparison already showed AppKit activation can establish target WebView focus
even when NSWorkspace's reported frontmost PID remains stale. The fix makes
`NSRunningApplication.activateWithOptions(AllWindows|IgnoringOtherApps)` a
required first phase of `activate_native_process`, followed by the existing AX
raise and title-bar focus handshake.

AppKit source-bound post-fix run:
`20260821T181636553271Z-9951935716f26f266c7b4ae69fe43935`.

- Source, dedicated binary, and live Profile Three Station matched clean commit
  `1bc508153e728f417cbd295d09c6103d3ac852ce`.
- AppKit plus Accessibility activation moved Alice from
  `documentFocused=false` to `documentFocused=true`, with Alice becoming
  WindowServer index `0` and `actualFrontmostPid`.
- On the first Alice-to-Bob handoff, AppKit returned success and System Events
  reported Bob `frontmost=true`, but `actualFrontmostPid` remained Alice before
  and after the complete title-bar click. Bob remained
  `documentFocused=false`, with a released mouse button and no competing sheet.
- The Gate timed out before Bob's group-row click. Cleanup passed and ports
  `3330/3331/4445/4446` were released.

The AppKit Boolean return only proves that macOS accepted the activation
request; it does not prove that the target became the active application.
System Events `frontmost=true` also conflicts with the observed active PID and
cannot close this boundary. The next instrumentation records the target
activation policy, `isActive`, and `NSWorkspace.frontmostApplication` before
and immediately after the AppKit request, then records the same process
boundary after Accessibility activation. It does not change activation,
pointer, or wait behavior.

AppKit boundary run:
`20260821T182824055814Z-187ea8c44a3d48518bbd13595d91bbef`.

- Source, dedicated binary, and live Profile Three Station matched clean commit
  `816fefddb9eaca66cfc4e04f7be2340250870737`.
- Alice and Bob both reported activation policy `regular(0)`, completed launch,
  and `hidden=false`; activation policy and launch readiness are not the fault.
- For both actors, `activateWithOptions` returned `requestAccepted=true` while
  `targetActiveAfter=false` and `frontmostPidAfter` remained unchanged.
- Accessibility subsequently activated Alice, but returned
  `systemEventsFrontmost=true` for Bob while Alice remained
  `actualFrontmostPid`; Bob never established `documentFocused`.
- Cleanup passed and ports `3330/3331/4445/4446` were released.

Apple's public AppKit contract states that an accepted activation request does
not guarantee activation. A frontmost application must explicitly call
`yieldActivation(to:)`, after which the target requests activation inside its
own process. The repair therefore adds macOS-only,
`acceptance-webdriver`-gated native command for the current actor to yield to a
target PID and for the target actor to activate itself. The Driver invokes
these only for window lifecycle before the existing title-bar and
`document.hasFocus()` confirmation. Product clicks, hover, chooser, send, and
restart actions remain real Native user paths.

Cooperative activation isolation evidence:

- Calling source `yieldActivation(to:)` followed by an external helper's
  `NSRunningApplication.activate(from:)` was rejected by macOS. The target must
  request activation inside its own process.
- Calling source `yieldActivation(to:)` followed by target
  `NSApplication.activate()` was accepted but did not establish focus.
- Alice and Bob have `bundleIdentifier=None` and the same executable identity,
  but actor-specific byte-identical executable paths did not change the
  outcome; executable aliasing is not the cause.
- Calling source `yieldActivation(to:)` followed by target-process
  `NSApplication.activateIgnoringOtherApps(true)` produced the exact sequence
  `Alice -> Bob -> Alice -> Bob`. After every handoff, exactly the target
  WebView had `document.hasFocus()`, the target owned WindowServer index `0`,
  and the non-target WebView was unfocused.
- The probe used the production `focus_actor_window` implementation and
  released ports `3340/3341/4455/4456`.

The source/target commands are compiled and registered only for macOS
`acceptance-webdriver`. They coordinate Native window ownership only and do
not submit Chat business commands or replace any product UI action.

# Native Mousedown Acknowledgement Debug

- **Status**: [OPEN]
- **Debug Server**: `http://127.0.0.1:7777/event`
- **Log File**: `.dbg/trae-debug-log-native-mousedown-ack.ndjson`

## Session

- Session ID: `native-mousedown-ack`
- Formal workstream: `NDR-W7 Linux MP-W13 Product Proof`
- Runtime cell: `desktop-linux-native`
- Source commit: `094c60ff78ba95080aa4236c5f21b2b478e4fb5e`
- Latest failed Gate: `20260824T221611515158Z-cc67f643fb24697c744ce105d878fd1b`

## Problem

The Linux Native Desktop Gate activates Alice's real X11 window and proves that
the activation point belongs to the expected process, but the subsequent XTest
mouse-down is not acknowledged by the target DOM probe.

Expected: the native mouse-down reaches the intended WebKit DOM element and the
probe records the event.

Actual: `wait_native_input_event("mousedown")` times out with
`Native mousedown was not acknowledged by the target DOM`.

## Reproduction

1. Use the exact clean source commit for Station and the Linux runtime cell.
2. Run the MP-W13 Gate with runtime cell `desktop-linux-native`.
3. Allow Alice and Bob to launch and log in.
4. Enter `group.create.ui`.
5. Observe the failure in `_click_focused_element()` after successful native
   activation and point-ownership checks.

## Hypotheses

| ID | Hypothesis | Likelihood | Effort | Confirming signal |
|---|---|---|---|---|
| A | WebDriver element-center coordinates are not converted correctly to X11 root coordinates because of window decoration, viewport origin, or scale | High | Low | Requested root point differs from the live content origin plus DOM point |
| B | XTest injects into the expected process window but outside the WebKit content surface or onto an overlay | High | Low | X11 owner is correct while `elementFromPoint()` resolves to another element or no element |
| C | The DOM input probe is attached to a stale or wrong target element | Medium | Low | Probe target identity/rect differs from the current selector result at injection time |
| D | The mouse-down reaches the page but the probe's capture/composed event path does not observe it | Medium | Medium | Document-level listener observes the event while the target probe remains unchanged |
| E | Focus or window stacking changes between activation verification and XTest injection | Medium | Low | Pre/post injection focused PID, focused window, or point owner changes |

## Instrumentation Plan

- Record target selector identity, element rect, viewport size, scroll, DPR,
  window screen origin, and computed native point.
- Record `elementFromPoint()` and active element before and after injection.
- Record X11 pointer position, point ownership, focused control, and window stack
  immediately before and after `post_mouse`.
- Record document-level and target-level mouse-down observations separately.
- Report all evidence to the TRAE Debug Server with `runId=pre-fix`.

## Evidence

- Pre-fix Gate:
  `20260824T170417492836Z-c1b315822086135ba53eb7e974091f4e`
- Debug log lines 1-2: expected DOM center `(28.5, 134)` and computed native
  point `(29.5, 191)` were owned by Alice; Alice remained frontmost and focused.
- Debug log lines 3-4: the document received `pointerdown` and `mousedown` at
  `(238, 188)`, but both events targeted a different `DIV` and had
  `owned=false`.
- Direct XTest probe:
  `before 239 240`, `after_press 239 240`, `after_motion 29 191`.
- Root cause: XTest ignores the `x`/`y` fields for `ButtonPress` and
  `ButtonRelease`; the Linux adapter posted button actions without first moving
  the pointer to the `post_mouse(..., point)` contract coordinate.
- Post-fix run
  `20260824T171613019355Z-6b8be282d9c6ae1f6897dbaa848a59e2`
  delivered the pointer to the target at DOM point `(29, 139)` with
  `owned=true`, proving the mouse positioning repair.
- That run advanced to Bob activation and exposed a second coordinate-contract
  defect: WebDriver reported Bob at `x=640`, while the X11 bounds probe reported
  `x=-641` and therefore rejected point `(1071, 48)`.
- `python-xlib` runtime source confirms `destination.translate_coords(source,
  ...)`; the adapter passed receiver and argument in reverse order.
- Exact-source Gate
  `20260824T173933858868Z-a146876698c3194448b8f40f97fe15b9`
  passed source/runtime identity, group creation, transcript/thread assertions,
  toolbar geometry, keyboard reachability, and the reaction picker.
- The same run stopped at `reaction.ui`: `mousedown` reached the owned reaction
  `SPAN` at `(561, 257)`, then the separate release call emitted another
  `MotionNotify` while button 1 was held. The transient hover action disappeared
  and `mouseup` reached the message-container `DIV` with `owned=false`.
- Confirmed follow-on root cause: the Linux adapter moves before every action,
  while `_click_focused_element()` submits down and up as separate calls. A
  complete pointer press on a transient action surface must use one initial
  motion followed by ordered down/up events without an intervening motion.
- Post-fix Gate
  `20260824T181406327483Z-0c9bda39eb0761b808c4a4ae5aa9dfad`
  recorded owned `mousedown`, `mouseup`, and `click` on the same transient
  target with no intervening motion, proving the atomic pointer-press repair.
- That run advanced through reaction authority/readback, reaction failure
  recovery, avatar loading, group avatar slots, and Station attribution before
  failing in `settings.ui` because the Linux image provided neither
  `org.freedesktop.portal.Desktop` nor the `zenity` fallback used by `rfd`.
- All actor processes, endpoint leases, ports, and storage were released after
  the file-chooser failure.
- Gate `20260824T184230474776Z-4db992efc1e3d70e0877db63144b0251`
  failed earlier in `reaction.ui` because the retained diagnostic probes spent
  about three to five seconds collecting remote X11/AT-SPI snapshots between
  target discovery and delivery. The transient hover target disappeared and
  the runner correctly failed closed before posting input.
- The diagnostic code remains in source, but expensive snapshots must be
  conditional on `DEBUG_SERVER_URL`; the final product Gate will run without
  debug instrumentation enabled.
- Full post-fix Gate comparison: pending the instrumentation-isolation and
  Linux native chooser verification.
- Exact-source runs
  `20260824T202036300005Z-f360973ec7f9f50e39d699dabbd02ebb` and
  `20260824T202948621666Z-4555ed9d1f77d66120547f6fa367fd36`
  reproduced a later reaction-retry collision without the expensive
  mousedown snapshots enabled. The pointer motion reached the message action
  toolbar, then the retry click was intercepted after that toolbar covered the
  recovery control.
- Diagnostic run
  `20260824T203806612982Z-b8d5dab4b1eea8bcf6f3d8a7c88c7b28`
  confirmed the same ownership boundary: reaction controls received complete
  native down/up/click sequences, while the failed-reaction retry target could
  disappear before delivery when the generic action overlay remained active.
- Root cause for the new boundary: reaction recovery and the generic message
  action overlay competed for the same message-row interaction area. The
  product contract requires retry to remain actionable, so active reaction
  mutations now suppress and dismiss the generic overlay.
- Exact-source run
  `20260824T210747163196Z-405dfb06c0469c5edd11879266059514`
  advanced past reaction recovery and stopped on a transient Reply action.
- Diagnostic rerun
  `20260824T211742109650Z-6e9c3a6eb67c5eff955ed9ce6d22c8cc`
  recorded complete owned `mousedown`, `mouseup`, and `click` events for Reply
  and passed `thread_exact`, `transcript_exact`, toolbar, reaction recovery,
  avatar, and Station attribution assertions. This rejects a persistent Reply
  delivery defect; the next first boundary is the platform-specific native file
  chooser location shortcut.
- Exact-source run
  `20260824T221611515158Z-cc67f643fb24697c744ce105d878fd1b`
  used the corrected GTK/Zenity chooser shortcut but reproduced the native
  acknowledgement failure earlier on reaction retry. The driver installed its
  DOM probe before moving the native pointer onto the hover-sensitive target,
  allowing hover state to replace the target between probe installation and
  button delivery.
- Post-fix static evidence: the driver now moves the pointer first, verifies
  that the target remains connected, enabled, and center-hit, then installs the
  acknowledgement probe and emits one atomic down/up sequence. Chat static
  tests passed 38/38, native adapter tests passed 35/35, and Acceptance Core
  passed 243/243. Exact-source runtime comparison remains pending.
- Exact-source runs
  `20260824T223439676996Z-97981b6bc2410c2cac667db10e15e07b` and
  `20260824T224608835773Z-aeb22edc0ee5588c188d802fff09f099`
  failed closed before Reply delivery because the target changed after native
  pointer positioning.
- Diagnostic run
  `20260825T004500212740Z-52005910ee9e1b2eb756868e31917f9d`
  confirmed the original Reply node became disconnected. Its stale
  `getBoundingClientRect()` collapsed to `(0, 0, 0, 0)`, so the later
  validation inspected the page origin instead of the fixed native pointer
  point.
- Confirmed follow-on root cause: selector-driven native actions treated a
  React replacement node as an invalid target even when the replacement
  represented the same action at the same physical point.
- The input driver now rebinds selector-driven actions at the fixed point and
  accepts acknowledgement only when the event target matches the selector and
  the event coordinates remain within two pixels of that point. Arbitrary
  element clicks retain strict object identity.
- Exact-source Gate
  `20260825T021138371217Z-3c63943ceff80a2a60caf392a85ea231`
  at `c9e1010cd3900a620bf1c0f932593e3d7ce22474` again failed in the second
  pre-delivery validation for Reply. The stale element was disconnected and
  the hit target was a `DIV`, but the error did not include `selectorMatches`
  because that diagnostic existed only in the earlier post-positioning branch.
- The second validation now records every live semantic selector match, its
  rectangle, whether it contains the fixed point, and whether it owns the
  current hit target. This is instrumentation only; native delivery and Gate
  pass conditions are unchanged.
- Exact-source Gate
  `20260825T022534167692Z-e12f329ee7467962c8b1c8bceb197108`
  at `a0c6c61651d709f77e5e22a6a02fbcff8ab246ab` reported
  `selectorMatches=[]` at the second pre-delivery validation. The selector had
  disappeared completely rather than moving or rebinding to another node.
- Confirmed follow-on root cause: the Chat action overlay has a 140ms
  row-to-overlay close bridge, while the runner split one native click into a
  pointer move followed by two WebDriver validation/probe round trips and a
  later down/up call. Remote round-trip latency exhausted the transient
  control's lifetime before input delivery.
- The runner now installs the strict semantic/point-bound probe while the
  target is stable, then submits `MOVE`, `LEFT_DOWN`, and `LEFT_UP` in one
  native adapter call. It keeps selector ownership and two-pixel event
  acknowledgement; no sleep, retry, WebDriver click, or fallback was added.
- Exact-source formal Gate
  `20260825T023938762657Z-1f9ce5b34890a232df8d14b647988af3`
  at `47105ad7b759bd1f48e8ea98963bddc23da27ef9` passed Reply, exact
  thread/transcript, toolbar geometry, keyboard access, and reaction picker,
  then failed on the reaction retry action.
- Diagnostic run
  `20260825T024824294590Z-dbba6dfa080944baafe4aac883f9bb95`
  proved the browser target center `(561.46, 252)` and delivered X11 point
  `(561, 252)` agree. Focus and window ownership remained correct.
- A later source-bound Gate with bounded mutation evidence showed the same
  transition on the thread action: `pointermove` was selector-owned, then the
  toolbar selector disappeared before `pointerdown`. The action surface uses
  message-row `onMouseLeave` to schedule closure but overlay
  `onPointerEnter`/`onPointerLeave` to cancel it, so the cross-portal hover
  bridge uses mismatched React event families.
- The product overlay now uses `onMouseEnter`/`onMouseLeave` consistently with
  the message row while retaining pointer-down capture and keyboard focus
  ownership. Runtime comparison is pending.
- Exact-source run
  `20260825T010726695268Z-e5c1bd602afd340cc84e8de0ff47b4de`
  proved the complete pointer press reached the current Chat navigation button,
  but X11 delivered DOM coordinates `(29, 139)` while the browser target center
  used by the probe was `(28.5, 134)`. The 5px vertical difference is the
  bottom frame extent incorrectly included in the runner's top offset:
  `_NET_FRAME_EXTENTS=(1,1,20,5)` while the frame-inclusive window height minus
  viewport height is 25px.
- Confirmed follow-on root cause: a strict probe cannot bind Linux delivery to
  a browser-computed point before native frame translation. It now anchors to
  the first semantically owned pointer movement emitted by the same atomic
  native press, then requires down/up/click to remain within two pixels of that
  delivered point. A movement that lands outside the semantic target cannot
  establish the anchor. Exact-source runtime verification remains pending.
- Exact-source run
  `20260825T034036388819Z-65a23ccbe9c8b1abb320c37b7406b16c`
  at `1b5883df8f87ec039e9da20bcab6ecf30fff2c13` again reached the
  reaction retry action, but the selector was already absent when the
  acknowledgement probe was installed. The delivered X11 point remained
  `(561, 252)`, document focus remained valid, and all events reached the
  message scroll surface. The empty probe mutation list proves the target
  disappeared before probe installation, not during the atomic native press.
- Follow-on hypotheses:
  - F: the failed reaction mutation converges against a late authoritative
    projection and intentionally removes the retry state before input;
  - G: a message projection or virtual-row replacement drops the retry subtree
    while the mutation remains in `error`;
  - H: native window/content-origin inspection consumes enough time for another
    asynchronous product transition to replace the selector.
- The next diagnostic records the live selector and reaction mutation DOM
  immediately after native window/content-origin inspection and before probe
  installation. It does not change click behavior or acceptance conditions.
- Diagnostic run
  `20260825T035635303785Z-922895a3a2481a0a1b455fdb72f00dfc`
  at `27b33f942110244c75fa9141bd00e4ac8a40399c` confirmed hypothesis F.
  The retry target existed when WebDriver measured it, but both
  `selectorMatches` and `reactionStates` were empty after native window and
  focus inspection. Runtime logs show the Desktop durable command was accepted,
  the first Station submission was unfenced, and the messaging lifecycle then
  recovered. The retry control disappeared because the same durable command
  automatically converged, not because the row was remounted or input missed
  its coordinate.
- MP-S04 and MP-G15 require transport failures after durable admission to stay
  retrying and converge through exact automatic retry. The Gate's manual retry
  click contradicted that product contract and raced the correct lifecycle
  recovery.
- Exact-source formal Gate
  `20260825T135034189912Z-a7da9da96051f5627661068b7ea972e1`
  at `afa0f985eaae4c03cfed96ea3fe9af25fab9c760` passed source/runtime
  identity, transcript/thread, toolbar geometry, keyboard reachability, and the
  first reaction picker. It also ran for 669 seconds with both actor WebDriver
  forwards alive, proving the SSH keepalive repair across the previous
  236-second failure boundary.
- The next reaction action delivered a complete selector-owned
  `pointerdown`/`mousedown`/`pointerup`/`mouseup`/`click` sequence at
  `(432, 151)`. The semantic target then disappeared, but
  `wait_native_input_event("mousedown")` still reported no acknowledgement.
- Follow-on hypotheses:
  - I: the WebDriver event query observed the probe before the native event
    sequence became visible, and the final timeout snapshot saw events that
    arrived after the last poll;
  - J: an intermediate WebDriver query raised an exception that the broad
    acknowledgement wrapper mislabeled as an event timeout;
  - K: the probe registry or page execution context was transiently replaced
    and restored while the semantic target was being removed.
- A diagnostic rerun at the same clean source enables the existing
  `native-mousedown-ack` pre/post press reports. No product behavior,
  acknowledgement condition, timeout, retry, or fallback is changed.
- Exact-source Linux runs
  `20260825T171222491222Z-61668d479d0346035952af45dbd9b634` and
  `20260825T171706029323Z-ecf9fc633cdec865aee744d940daff47`
  at `d5e707f005aa19c4f291345d6a0f3e50cf7d6984` both failed at the
  `group.create.ui` submit acknowledgement. The final timeout snapshot
  contained the complete ordered `pointerdown` / `mousedown` / `pointerup` /
  `mouseup` / `click` sequence with `owned=true` on the target button.
- This confirms hypothesis I: the polling deadline can expire before the
  WebDriver round trip exposes the events, while the immediately following
  final snapshot already contains them. The acknowledgement path now applies
  the same strict event type, ownership, and cursor predicate to that final
  snapshot. It does not extend the timeout, retry input, or accept an
  unowned event.

## Hypothesis Verdicts

| ID | Verdict | Evidence |
|---|---|---|
| A | Rejected as primary cause | Requested root point was inside Alice's window and maps within the 44px target; the injected button event used the old pointer location instead |
| B | Confirmed | The event reached Alice's document at `(238, 188)` and hit a different element |
| C | Rejected | The original element remained connected, enabled, center-hit, and unchanged immediately before injection |
| D | Rejected | Both document-level capture listeners observed `pointerdown` and `mousedown` |
| E | Rejected | Alice remained frontmost, main, and focused before and after injection |
| I | Confirmed | The timeout snapshot contains the exact owned event that the preceding poll did not return |
| J | Rejected | The captured exception is `TimeoutException`, not an intermediate WebDriver command error |
| K | Rejected for this run | The same probe registry retained the complete event sequence through the final snapshot |

---
kind: pitfall
title: Semantic Native qualification must include startup and preserve its operator baseline
status: active
owns:
  - apps/desktop/src-tauri/Cargo.lock
  - apps/desktop/src-tauri/src/main.rs
  - tooling/acceptance/provisioners/native_desktop_macos.py
  - tooling/acceptance/tests/test_native_desktop_macos.py
  - tooling/acceptance/core/runtime_cell.py
  - tooling/acceptance/drivers/native/
  - tooling/acceptance/gates/chat/native_file_picker.py
  - tooling/acceptance/tests/test_file_chooser_qualification.py
related:
  - docs/architecture/engineering/acceptance/decisions.md
referenced-by: []
detected: 2026-10-24
---

# Semantic startup and operator identity

Tauri's macOS builder activates by default. Its initial window focus also
defaults to true, and a later `show()` can make an unfocused window key.
Sampling operator state only after launch can therefore observe the new client
as the operator and report unchanged input while having already stolen focus.

Wry 0.57.0 separately calls `NSApplication.activate()` unconditionally when
attaching WKWebView. Native call-stack instrumentation identifies
`wry::wkwebview::InnerWebView::new_ns_view` as that caller. Changing the window
focus or launch activation flag does not remove this WebView-owned request.
Temporary Prohibited/hidden startup followed by Accessory presentation can
still admit that deferred activation.

Acceptance resolves the official Wry 0.57.1 fix
([upstream #1866](https://github.com/tauri-apps/wry/pull/1866)) through Cargo.
The published constructor gates activation and initial first-responder
assignment on `visible && focused`. Semantic startup sets the initial focus
false before creation, uses Accessory policy and keeps configured visibility.
No delayed presentation, method interception or edited Cargo cache belongs
in the implementation. Diagnostic instrumentation never qualifies a Cell.
A visible process-owned window must be observed; a hidden WebView screenshot
does not prove native presentation. Production and isolated exclusive
activation keep their respective behavior.
The Desktop manifest requires Tauri 2.12.2, which exposes the launch activation
control. Verify the version resolved in the Desktop Cargo lockfile; a different
SDK installed in the global Cargo cache does not establish the compiled API.
Semantic startup sets `activate_ignoring_other_apps(false)` on the Builder and
Accessory policy before the event loop. The initial visible window is unfocused;
setup must not hide it or switch through Prohibited and later presentation.
The native Cell's prelaunch and `launch-ready` samples independently verify
that the compiled startup follows this contract.

The Native Cell freezes the real operator before launch, rejects a baseline
whose PID is the target, and preserves the same baseline through readiness,
actions, screenshots and owned stop. A mismatch remains a mismatch even if a
later sample returns to the original state. No application may be activated to
manufacture an operator baseline.

## How to detect a recurrence

```bash
.local/acceptance/python-venv/bin/python3 -m unittest \
  tooling.acceptance.tests.test_native_desktop_macos
```

The synthetic launch-order and invalid-baseline checks establish framework
regression coverage. Real qualification must separately observe another
frontmost PID, unchanged pointer and keyboard focus throughout the lifecycle,
and clean owned resources. File chooser and physical-input admission still
require their own actual capability and proof under D-22.
Verify the resolved Wry version in the Desktop lockfile before interpreting a
focus-false run. An unclosed diagnostic authorization sheet is not a valid
operator baseline for subsequent qualification.

## Chooser qualification and observation ownership

Requiring exclusive input for an exact-PID AX chooser prevented an otherwise
equipped Profile from completing the real file-selection Journey. Conversely,
removing that guard without a qualification contract would admit unproved
native behavior from a mode flag. The shared picker also contained duplicate
selector code and mixed platform selection with operator activation.

The parent now records a separate closed `nativeAdapter.fileChooser` only
after a real current-binary selection, exact path/file readback, panel closure
and owned stop. The descriptor binds Cell run and source, with ordered samples
against the same prelaunch operator. Driver is the only operator-sampling owner;
Binding consumes qualification and the shared picker uses the same observation
contract for its visible trigger and exact-PID native selection. Permission,
physical focus and HID remain separately guarded.

Run `test_file_chooser_qualification` to reject copied source/Cell identity,
missing/reordered phases, unclosed panels, changed file bytes, invalid pointer
numbers and an intermediate operator mismatch followed by a matching sample.
Run the actual prepared-Cell parent/child chooser Journey separately; synthetic
checks cannot admit the capability or establish product proof.

## Native panel presence is not window cardinality

The real parent qualification delivered the visible trigger's mouse events and
left the Tauri command pending while an AX `OKButton` was present inside the
process-owned window. Both before and during the open panel, `AXWindows` had
one window and `AXSheets` had no sheets. Requiring an increased count therefore
rejected an actual open chooser before the already available selector ran.

Driver read-only observation and native selection now share one AX panel
finder. Parent qualification and the shared picker consume typed exact-PID
panel presence, and Core validates absent/present/absent in `panelPresence`.
The old count-based descriptor is rejected; unavailable AX owner windows or
failed probes remain failures rather than absent-panel evidence.

The parent and shared-picker regression uses unchanged window counts with
actual typed panel transitions. Descriptor checks reject missing, integer,
never-opened and unclosed presence, and Driver checks reject foreign PID,
invalid observation shape and timeout. Real parent/child qualification must
still prove selected-path/file readback and unchanged operator through cleanup.

## Bounded native reads must share initialization

Full-Journey profiling found each operator snapshot starting separate
frontmost, pointer and at least two focus Python/AppKit processes. Five file
selections accumulated 29.257 seconds; 27 operator snapshots accounted for
15.123 seconds, with overlapping profile frames. Repeated framework
initialization consumed the request budget without adding an independent
product assertion.

The macOS Driver now owns one native probe and one AX support implementation.
Every call launches and reaps its own bounded subprocess; that child reads
two consecutive focus samples from the current native state. Focus sampling
rejects a stable result returned after the original one-second deadline.
Operator-only and operator-plus-panel reads share that implementation.
Parent and picker consume the combined reading at each chooser phase, and
every unsuccessful panel-wait sample still checks the frozen operator.
Selection uses the same panel finder and returns its actual control read
within its existing subprocess.
Pointer observation reads CoreGraphics through the shared ctypes boundary
and releases its event, avoiding another Python Quartz module initialization.
Regression must execute the complete probe with its actual mode/PID argument
layout as well as the focus algorithm; testing only the algorithm misses
failures in shared probe initialization.

Verify `test_native_desktop_macos`, `test_file_chooser_qualification`,
`test_resource_diagnostic`, `native_file_picker_test` and
`native_product_closure_static_test`. Reject rebaselining, skipped phases,
late stable focus, foreign panel PIDs, cached native state and unowned workers.
Measure the current-source complete Native Journey separately; synthetic
regressions and profile timings never supply product PASS.

## Probe failures retain their original code origin

The adapter raises a response-decoding `ValueError` when the child reports an
error. Writing that adapter type over the child's `observed.errorType` erased
the original failure and made a failed panel read look like an unexplained
focus error. A separate passing parent qualification did not reproduce it.

The child now emits the actual exception type, last code function and line
without exception messages, private AX values or window titles. The adapter
preserves those fields and records its own exception as `adapterErrorType`.
Neither this diagnostic correction nor a passing replay establishes the
unobserved cause of a historical failure.

Run `test_native_observation_diagnostics` with the existing Native regression
set. The actual child error wrapper must identify its raising function and
exclude private error text; adapter conversion must retain the child type and
location. Malformed JSON keeps its actual decoder type. Original deadlines,
panel phases, non-interference and complete product proof remain required.
The actual AXWindows failure must retain the OS status, returned-value presence
and owner-window count. A failed attribute read and a successful empty array are
distinct observations. The shared AX reader releases any returned value on
failure; a window read failure still cannot become absent-panel evidence.
Run the actual embedded reader against failed, null, empty, absent and present
window cases before using these diagnostics to classify a real Native failure.
An AXWindows refusal retains the measured duration of that attribute read.
The operator-observation owner adds its original chooser phase while preserving
the Driver's diagnostic owner and checks. A later call must raise the same
sticky failure without replacing its phase or sampling again. Phase and timing
are diagnostic facts; neither establishes why the application failed to answer.

The shared control reader also retains `actualControlRequestPid` on the same
AX failure. Operator sampling queries the current frontmost application even
when its caller supplied PID zero or a chooser target. That caller parameter
cannot identify the AX recipient. Run actual control decoding, the child
failure wrapper and adapter conversion for those distinct identities, including
text/boolean refusals and expiry before/after the original read. Preserve the
original status, duration, exception origin and CF release. The PID identifies
the queried process; it does not explain an OS refusal.

## Shared attribute failures cannot become stable empty focus

The shared reader previously mapped every AX status to `None`. Independent
0.5-second attribute waits continued before the focus loop checked its
one-second deadline. An actual first control read consumed 1.523542 seconds
with 0.973033 seconds remaining. That sample did not retain its OS statuses;
a later passing observation cannot supply them.

The same AX owner now preserves attribute/status/value presence/duration and
admits only explicit NoValue or AttributeUnsupported for optional absence.
Required AXWindows cannot accept failed, unsupported or null reads. Every
operator attribute receives the original focus deadline and limits its own
messaging timeout to the lesser of 0.5 seconds and remaining time. Expiry
before or after the native read fails, releases returned CF values and stops
subsequent reads. The shared `macos_ax.AXReadSession` owns bounded transient
read retries; they consume that same original deadline. Mutations remain
one-shot. Cached state or a new deadline cannot supply focus proof.

Run `test_native_observation_diagnostics` for failed status with/without CF
values, required versus optional absence, actual text/boolean decoding, expiry
before/after reads and remaining wait caps. Run the complete Native regression
set to preserve two stable samples, valid probe initialization and original
subprocess limits. The unchanged complete Native Journey must independently
prove current-source operator preservation and product behavior.

## Home selection must respect semantic roles

A real sidebar AXOutline declares AXValue but returns kAXErrorFailure (-25200).
The actual user-directory label is AXStaticText inside that sidebar's row and
cell. Reading AXValue on every traversed node stops before the available label.
The selector first checks AXStaticText and sidebar ancestry, then compares the
text value. It does not classify system failure as optional absence.

Run the embedded Home predicate and shared traversal regression in
`test_native_observation_diagnostics`: structural and foreign-sidebar nodes
must not receive value reads, matching text retains its path, missing text
remains absent, and eligible role/value failures propagate. Real parent
qualification must still prove file readback, panel closure and the original
operator baseline; this semantic lookup correction alone grants no capability.

## Panel controls precede deeper file-list traversal

A real open sheet contained an AXBrowser/AXScrollArea/AXList/AXGroup descendant
whose AXChildren read returned kAXErrorFailure (-25200). Depth-first OKButton
lookup entered that deeper file-list subtree before testing the shallower
native controls. The refusal stopped panel observation before selection.

The shared native path finder checks every node at one depth before expanding
that level. Observation and selection use this same traversal, retain the
original depth limit, and release all copied child arrays on success or failure.
No status becomes optional absence, no subtree is silently skipped, and a
failed read still propagates when no earlier native target exists.

Run the shallow-control, direct-panel, absent, unreadable and predicate-error
cases in `test_native_observation_diagnostics`. Require the actual button path,
the same propagated exception and balanced CF ownership. The complete real
Native Journey must separately prove chooser open/select/close, exact file
readback, unchanged operator and owned cleanup.

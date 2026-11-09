---
kind: pitfall
title: Native startup and chooser proof require scoped AX object identity
status: active
owns:
  - apps/desktop/src-tauri/Cargo.lock
  - apps/desktop/src-tauri/src/main.rs
  - tooling/acceptance/drivers/native/
  - tooling/acceptance/provisioners/native_desktop_macos.py
  - tooling/acceptance/gates/chat/native_file_picker.py
  - tooling/acceptance/runtime-cells/desktop-macos-native.yaml
  - tooling/acceptance/core/runtime_cell.py
  - tooling/acceptance/tests/test_native_desktop_macos.py
  - tooling/acceptance/tests/test_native_observation_diagnostics.py
  - tooling/acceptance/tests/test_macos_operator.py
  - tooling/acceptance/tests/test_file_chooser_qualification.py
related:
  - docs/architecture/engineering/acceptance/decisions.md
  - docs/architecture/engineering/acceptance/integration.md
referenced-by: []
detected: 2026-11-08
---

# Native startup and object identity

## Symptom and root cause

Independent native reads observed changing numeric window titles while the
frontmost PID, pointer and original focus fields remained equal. The original
oracle included that mutable title in its identity and stability comparison.
CFHash equality across short-lived processes could not prove object equality.
Another observed error read window flags from AXWindows[0] instead of the actual
focused window; enumeration order did not represent focus.

These are Driver identity failures. They do not prove the cause of an earlier
unobserved failure or establish Social readiness.

## Mitigation and recurrence constraints

The current contract is [D-22](../../architecture/engineering/acceptance/decisions.md#d-22-desktop-input-separates-non-intrusive-semantics-from-isolated-native-proof).
The original Native Driver retains actual AX control/window references within
one bounded observation scope and uses CFEqual. Every request supplies fresh
reads; a changed object or original identity field fails immediately against
the frozen baseline. Missing objects or role cannot become a stable empty
identity. Title, value, counts and CFHash never substitute for object equality.
All consumers explicitly close the scope, including construction, launch,
staging, selection and cancellation failures. Cleanup failure stays failed.

Startup still resolves the official Wry 0.57.1 fix through Cargo and requires
the supported Tauri launch API. Configure focus before construction, use
Accessory policy and `activate_ignoring_other_apps(false)`, and verify a visible
process-owned window. Hidden/delayed presentation, interception and edited
dependency caches cannot supply proof. The operator is frozen before launch;
its PID must differ from the target, and no app is activated to manufacture it.

Keep the operator pointer on the probe-window display before launch. A native
chooser can cause Window Server to nudge a pointer on another display. Driver
must not warp or restore it. Serialize Native operations in the shared GUI
session; Station leases do not isolate the operator pointer.

The same exact-PID AX panel finder serves observation and selection. Panel
presence is absent/present/absent, independently of window/sheet cardinality.
Traverse controls by depth with the original bounds; release copied arrays and
propagate unreadable subtrees when no earlier target exists. Home lookup requires
sidebar AXStaticText before reading its value. Column-browser mutable selection
can be rejected by the cross-service AX boundary; the original Search field
confirmation, unique filename row through AXSelectedRows and OKButton remain the
semantic selection owner. Unknown action outcomes are never replayed. Parent
still verifies the actual callback path and unchanged file bytes.

The depth walk starts from all exact-PID owner windows together. Completing a
deep walk of the first window before checking the second can exhaust the read
budget or hit an unrelated unreadable subtree before an available OpenPanel
control. The first verified panel path ends the observation; later unrelated
windows cannot invalidate that presence. If no earlier target exists, read
failures still propagate and cannot supply absent-panel evidence.

AXReadSession remains the shared read/status/deadline owner. Only explicit
NoValue/Unsupported represents optional absence; required windows reject null,
empty or failed reads as appropriate. Preserve OS status, returned-value
presence, read duration, original failure function/line and actual queried PID.
All focus attributes use the original one-second deadline, including startup.
The parent binds that deadline separately from the enclosing original
three-second observation deadline. Panel reads use their original AX read cap
and the remaining observation time; they cannot extend focus or scope. General
control/full subprocess limits remain two/three seconds. Checked
one-shot mutations use their original operation deadline rather than inheriting
the short read cap. No budget, cache, exception text or private title is added
to manufacture a successful sample.

The scoped observer starts a panel read observation after focus stabilizes:
focus attribute reads narrow the shared AX session deadline, which must not
leak into the separately bounded panel phase. Regression must use the actual
`AXReadSession.begin_observation`, not a panel stub that ignores its deadline.

The shared focus consumer reads only its actual AX objects, role/subrole,
frontmost PID and window identity flags. It does not request AXTitle, AXValue,
AXWindows or AXSheets for a keyboard-focus comparison. Those incidental reads
can consume the one-second two-sample budget or fail despite available focus
objects. General control observation still reads and validates display fields;
panel observation still requires its own exact-PID native presence. Failures
of any required identity field remain terminal, with the original status,
deadline, sticky baseline and CF ownership.

An explicitly absent focus object retains the actual queried/frontmost PID,
control/window presence, role presence and original window flags in the
Driver's typed failure. Do not export object addresses, titles or values.
A frontmost application with a main window but no focused UI element remains
unqualified. Its absent object is an observed environment boundary; it cannot
be replaced by the main window, an empty identity or a different application.

Binding discovers and proves the reviewed canonical Station origin before a
loopback fault proxy is switched in, and restores that origin before restart.
An early loopback origin cannot satisfy signed discovery.

## How to detect a recurrence

```bash
.local/acceptance/python-venv/bin/python3 -m unittest \
  tooling.acceptance.tests.test_macos_operator \
  tooling.acceptance.tests.test_native_desktop_macos \
  tooling.acceptance.tests.test_native_observation_diagnostics \
  tooling.acceptance.tests.test_file_chooser_qualification \
  tooling.acceptance.drivers.native.macos_test \
  tooling.acceptance.gates.chat.native_file_picker_test
```

Require actual CFEqual discrimination between same-title windows and
same-role controls, stable identity after content changes, unchanged strict
Core comparison, fixed request/scope deadlines, protocol rejection and balanced
reference/process cleanup. The real AppKit test and synthetic protocol tests
are Driver evidence only. Run the exact selected current-source Native
qualification and product Journey separately, preserving every original phase,
callback/file check, source/Cell binding, receiver assertion and owned cleanup.

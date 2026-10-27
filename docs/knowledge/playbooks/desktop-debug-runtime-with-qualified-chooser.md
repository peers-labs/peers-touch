---
kind: playbook
title: Desktop Debug Runtime and Qualified Native Chooser
status: active
owns:
  - AGENTS.md
  - apps/desktop/
  - apps/applets/
  - tooling/scripts/applet-
  - tooling/acceptance/
referenced-by:
  - AGENTS.md
related:
  - docs/client/desktop/runtime-projections.md
  - docs/architecture/engineering/acceptance/decisions.md
detected: 2026-10-24
---

# Desktop Debug Runtime

## When to use

Use for live Desktop behavior, applet and page lifecycle, or Native Acceptance
observations. Packaging is reserved for explicitly requested release,
installer, signing, or package-only validation.

## Steps

1. Start development through `make desktop`; there is no Desktop browser shell.
   Do not use a manual `.app` launch or `tauri build` for ordinary debugging.
   Formal Acceptance uses its declared parent Runtime Cell and the canonical
   source-bound build producer. A prepared child consumes that executable;
   it does not build again or select an installed app.
2. Read the owning runtime/page contract before editing those surfaces.
   Keep the live runtime, logs and current-source identity available.
3. Use embedded WebDriver semantic input by default. Do not activate the app,
   move the physical pointer, redirect keyboard focus, or force window stacking.
4. A process-scoped macOS file chooser requires the parent Cell's real
   open/select/close/owned-stop qualification. Binding consumes the closed
   descriptor from the same source and Cell. Driver owns AX selection and
   operator sampling; shared picker owns visible triggering and closure.
   Use the Driver's shared exact-PID panel finder to observe absent/present/
   absent. Do not infer native panel state from AX window or sheet counts.
   Preserve one prelaunch operator baseline across all sampled phases.
   A mismatch stays failed even if the operator later returns.
5. Permission sheets, physical hover/drag, focus and global-input chooser
   mechanisms require `exclusive-native-input` in a reviewed
   `isolated-gui-session`. A Profile or platform name cannot supply isolation.
6. Keep equipment, framework checks, product Journey and formal Acceptance
   evidence distinct. Native panel selection alone does not prove receiver
   content or product closure. Product assertions remain with their Gate.
7. Release only owned processes, staging directories, storage and leases.
   Diagnose cleanup failure before further dispatch.

## Verification

Run the focused source and Driver/Cell checks, then the exact-source native
Journey. Inspect current Cell/run/source/binary binding, actual native window,
file identity, panel closure, distinct operator PID and unchanged operator
pointer/focus through owned stop. Reject stale descriptors, missing phases,
restored baselines, hidden windows and any physical fallback in semantic mode.

Use `test_file_chooser_qualification`, `test_native_desktop_macos`,
`test_native_runtime_binding` and `native_file_picker_test` for synthetic
contract coverage. Their PASS is framework evidence only.

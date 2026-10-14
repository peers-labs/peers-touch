# DSTR-02-FUNCTIONAL: Native Tray Functional Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "desktop-macos-tray-acceptance-20261014",
  "taskId": "DSTR-02-FUNCTIONAL",
  "workstreamId": "DSTR-TRAY",
  "title": "Exercise the packaged macOS tray lifecycle under Development policy",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "desktop-shell-tray-functional",
  "journeyId": "DSTR-J01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "tooling/acceptance/gates/desktop",
    "tooling/acceptance/provisioners/desktop_shell_native.py",
    "tooling/acceptance/drivers/native"
  ],
  "readSet": [
    "docs/architecture/platform/client/desktop",
    "docs/client/desktop",
    "tooling/acceptance/capabilities/desktop-shell.yaml",
    "tooling/acceptance/domains/desktop-shell.yaml",
    "tooling/acceptance/environments/desktop-shell-native.yaml",
    "tooling/acceptance/features/desktop-shell-tray.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "desktop-shell-tray-focused",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml macos_tray_icon_is_retina_template_artwork && python3 -m unittest tooling.acceptance.gates.desktop.shell_tray_e2e_test tooling.acceptance.provisioners.desktop_shell_native_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-shell-tray-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --execution-plan docs/architecture/platform/client/desktop/execution-plans/20261014-macos-tray-acceptance/plan.md --runtime-cell desktop-macos-native",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-shell-tray-proof-contract",
      "command": "python3 tooling/scripts/acceptance-run.py --gate desktop-shell-tray-e2e --runtime-cell desktop-macos-native",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "The exact-source packaged app exposes one 62 x 24 Peers Touch status item",
    "The source asset, packaged binary, runtime process, and native status item identities agree",
    "Closing the main window preserves the process and status item",
    "The status-item Show action restores a focused frontmost main window",
    "Development evidence records DSTR-A01 through DSTR-A06 without publishing PROVEN",
    "Process, status item, ports, storage, and runtime-cell resources are released"
  ],
  "failureBehavior": [
    "A dirty source, stale package, binary mismatch, missing Accessibility permission, or geometry mismatch blocks functional proof",
    "A ready runtime with a failed product assertion is a product failure",
    "Screenshot evidence cannot replace Accessibility or process postconditions",
    "Cleanup failure prevents FUNCTIONAL_PASS"
  ],
  "updatedAt": "2026-10-14T11:25:00.000Z"
}
```

## Current Snapshot

The source is visually approved and has passed focused checks, but the tracked
Development Session has not yet executed the packaged Native Journey.

## Closure

One source-bound package run proves the tray lifecycle under Development policy
and establishes the functional fence required before formal Acceptance.

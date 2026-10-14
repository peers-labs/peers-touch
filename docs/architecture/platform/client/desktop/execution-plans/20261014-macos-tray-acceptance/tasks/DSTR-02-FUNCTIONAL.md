# DSTR-02-FUNCTIONAL: Native Tray Functional Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "desktop-macos-tray-acceptance-20261014",
  "taskId": "DSTR-02-FUNCTIONAL",
  "workstreamId": "DSTR-TRAY",
  "title": "Close the tray source contract and exercise the packaged macOS lifecycle",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "desktop-shell-tray-functional",
  "journeyId": "DSTR-J01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "docs/architecture/platform/client/desktop",
    "docs/client/desktop",
    "tooling/acceptance/capabilities/desktop-shell.yaml",
    "tooling/acceptance/domains/desktop-shell.yaml",
    "tooling/acceptance/domains/index.yaml",
    "tooling/acceptance/environments/desktop-shell-native.yaml",
    "tooling/acceptance/features/desktop-shell-tray.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/desktop",
    "tooling/acceptance/provisioners/__init__.py",
    "tooling/acceptance/provisioners/desktop_shell_native.py",
    "tooling/acceptance/provisioners/native_desktop_macos.py",
    "tooling/acceptance/drivers/native",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/tests/test_native_desktop_macos.py",
    "tooling/scripts/acceptance-plan.py",
    "tooling/scripts/acceptance-plan-test.py"
  ],
  "readSet": [
    "docs/architecture/engineering/acceptance",
    "docs/architecture/engineering/development-workflow",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "desktop-shell-tray-rust-source",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml macos_tray_icon_is_retina_template_artwork",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-shell-tray-driver-source",
      "command": "python3 -m unittest tooling.acceptance.drivers.native.macos_test tooling.acceptance.gates.desktop.shell_tray_e2e_test tooling.acceptance.provisioners.desktop_shell_native_test tooling.acceptance.tests.test_native_desktop_macos",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-shell-domain-structure",
      "command": "make acceptance-validate DOMAIN=desktop-shell",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "desktop-shell-plan-mapping",
      "command": "python3 tooling/scripts/acceptance-plan-test.py",
      "verificationClass": "STRUCTURAL_CHECK"
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
    "The macOS source uses the accepted 88 x 36 full Peers Template asset",
    "Desktop shell tray paths map to the desktop-shell feature and Gate without selecting the Chat lifecycle Gate",
    "The concrete environment owns package build, process launch, ephemeral native authority, and cleanup",
    "The Gate consumes native status-item operations without importing AppKit or Quartz",
    "Desktop shell Domain, Capability, Feature, Registry, Gate, Environment, and Provisioner validate structurally",
    "The exact-source packaged app exposes one 62 x 24 Peers Touch status item",
    "The source asset, packaged binary, runtime process, and native status item identities agree",
    "Closing the main window preserves the process and status item",
    "The status-item Show action restores a focused frontmost main window",
    "Development evidence records DSTR-A01 through DSTR-A06 without publishing PROVEN",
    "Process, status item, ports, storage, and runtime-cell resources are released"
  ],
  "failureBehavior": [
    "Do not weaken exact package, Accessibility geometry, restore, or cleanup assertions",
    "Do not add a second tray implementation or a Chat compatibility mapping",
    "Do not classify product-specific Provisioner and Gate code as Acceptance Infra",
    "A dirty source, stale package, binary mismatch, missing Accessibility permission, or geometry mismatch blocks functional proof",
    "A ready runtime with a failed product assertion is a product failure",
    "Screenshot evidence cannot replace Accessibility or process postconditions",
    "Cleanup failure prevents FUNCTIONAL_PASS"
  ],
  "updatedAt": "2026-10-14T11:25:00.000Z"
}
```

## Current Snapshot

The accepted source closure already passed once. Its checks are retained here
because adding the canonical planner to the mounted Plan scope invalidated the
separate source Task before the packaged Native Journey ran.

## Closure

One reviewed source-and-runtime closure proves the tray lifecycle under
Development policy and establishes the functional fence required before formal
Acceptance.

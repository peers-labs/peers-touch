# DSTR-01-SOURCE: Tray And Acceptance Source Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "desktop-macos-tray-acceptance-20261014",
  "taskId": "DSTR-01-SOURCE",
  "workstreamId": "DSTR-TRAY",
  "title": "Connect the packaged macOS tray implementation to formal Acceptance",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "desktop-shell-tray-source",
  "journeyId": "DSTR-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop",
    "docs/architecture/platform/client/desktop",
    "docs/client/desktop",
    "tooling/acceptance/capabilities/desktop-shell.yaml",
    "tooling/acceptance/domains/desktop-shell.yaml",
    "tooling/acceptance/domains/index.yaml",
    "tooling/acceptance/drivers/native",
    "tooling/acceptance/environments/desktop-shell-native.yaml",
    "tooling/acceptance/features/desktop-shell-tray.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/desktop",
    "tooling/acceptance/provisioners/__init__.py",
    "tooling/acceptance/provisioners/desktop_shell_native.py",
    "tooling/acceptance/registry.yaml",
    "tooling/scripts/acceptance-plan-test.py"
  ],
  "readSet": [
    "docs/architecture/engineering/acceptance",
    "docs/architecture/engineering/development-workflow",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "desktop-shell-tray-rust-source",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml macos_tray_icon_is_retina_template_artwork",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-shell-tray-driver-source",
      "command": "python3 -m unittest tooling.acceptance.drivers.native.macos_test tooling.acceptance.gates.desktop.shell_tray_e2e_test tooling.acceptance.provisioners.desktop_shell_native_test",
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
    }
  ],
  "doneWhen": [
    "The macOS source uses the accepted 88 x 36 full Peers Template asset",
    "Desktop shell tray paths map to the desktop-shell feature and Gate without selecting the Chat lifecycle Gate",
    "The concrete environment owns package build, process launch, ephemeral native authority, and cleanup",
    "The Gate consumes native status-item operations without importing AppKit or Quartz",
    "Desktop shell Domain, Capability, Feature, Registry, Gate, Environment, and Provisioner validate structurally",
    "All focused source and structural checks pass"
  ],
  "failureBehavior": [
    "Do not weaken exact package, Accessibility geometry, restore, or cleanup assertions",
    "Do not add a second tray implementation or a Chat compatibility mapping",
    "Do not classify product-specific Provisioner and Gate code as Acceptance Infra",
    "Keep runtime proof UNPROVEN until the successor functional Task runs"
  ],
  "updatedAt": "2026-10-14T11:25:00.000Z"
}
```

## Current Snapshot

- The accepted tray asset and Tauri source are present but uncommitted.
- Screenshot evidence exists, but no formal Desktop shell contract or Gate
  owns the behavior.
- The broad Chat registry rule currently selects an unrelated lifecycle Gate
  for all Desktop Rust source.

## Closure

One source closure connects the existing product implementation to a
domain-correct, platform-owned Acceptance path. It makes no product proof
claim.

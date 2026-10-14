# DSTR-03-FORMAL: Formal macOS Tray Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "desktop-macos-tray-acceptance-20261014",
  "taskId": "DSTR-03-FORMAL",
  "workstreamId": "DSTR-TRAY",
  "title": "Publish and validate exact-source formal tray evidence",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "desktop-shell-tray-formal",
  "journeyId": "DSTR-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop",
    "tooling/acceptance/gates/desktop",
    "tooling/acceptance/provisioners/desktop_shell_native.py",
    "tooling/acceptance/drivers/native"
  ],
  "readSet": [
    "docs/architecture/engineering/acceptance",
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
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 5400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "desktop-shell-tray-formal-run",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "desktop-shell-domain-proven",
      "command": "python3 tooling/scripts/acceptance-validate.py --domain desktop-shell --require-proven",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "desktop-shell-tray-completion-structure",
      "command": "make acceptance-validate DOMAIN=desktop-shell && git diff --check",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Every current-closure Gate is DONE and PROVEN on the exact source",
    "desktop-shell domain validation resolves the complete Feature, Capability, Registry, Gate, Environment, and evidence trace",
    "The Gap Detector reports no required unrun, stale, unrelated, or unproven Gate",
    "Quality and completion evidence preserve the macOS-only claim boundary",
    "All Acceptance, runtime-cell, process, status-item, port, storage, Session, declaration, and Plan resources close cleanly"
  ],
  "failureBehavior": [
    "Do not reuse Development evidence as formal proof",
    "Do not substitute the Chat lifecycle Gate or screenshot-only evidence",
    "Keep Linux, Windows, signing, and notarization explicitly unproven",
    "Any post-Gate cleanup failure blocks readiness"
  ],
  "updatedAt": "2026-10-14T11:25:00.000Z"
}
```

## Current Snapshot

Formal Acceptance is blocked until `DSTR-02-FUNCTIONAL` records a current
`FUNCTIONAL_CHECK/PASS` in its Development Session.

## Closure

The aggregate reruns the accepted Journey under formal policy, validates the
managed Domain proof graph, and leaves no unsupported merge-readiness claim.

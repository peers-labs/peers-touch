# Cross-platform Desktop install adapter

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-01",
  "workstreamId": "ADL",
  "title": "Cross-platform Desktop install adapter and Linux XDG install",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ADL-linux-install",
  "journeyId": "desktop-linux-install",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "tooling/devctl",
    "docs/architecture/engineering/local-dev",
    "docs/global/local-dev-environment.md"
  ],
  "readSet": [
    "apps/desktop/package.json",
    "apps/desktop/src-tauri",
    "pnpm-lock.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "install-adapter-unit",
      "command": "node --test tooling/devctl/test/desktop.test.mjs tooling/devctl/test/cli.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "linux-install-functional",
      "command": "make desktop-install",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "linux-install-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate desktop-linux-install-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "One orchestrator delegates platform build, artifact resolution, stage, install, rollback and verification.",
    "Linux atomically installs AppImage, launcher, hicolor icon, desktop entry and peers-touch-dev handler in the frozen XDG paths.",
    "A running old AppImage may finish while the next launch uses the new source-bound artifact.",
    "Failed artifact or desktop-entry replacement restores the prior installed version.",
    "macOS app bundle/codesign behavior and Windows Native development tests remain unchanged."
  ],
  "failureBehavior": [
    "Missing Linux prerequisites return a typed dependency error with exact package evidence.",
    "Source movement during build rejects installation.",
    "No code path installs OS packages, requires root or silently falls back to a developer binary."
  ],
  "updatedAt": "2026-10-20T04:10:00.000Z"
}
```

## Current Snapshot

`desktop-install` now has one orchestrator and a closed macOS/Linux adapter
registry. Linux owns AppImage resolution, rootless XDG paths, launcher, icon,
desktop entry, source receipt, protocol registration, same-directory
fsync/rename replacement and multi-file rollback.

Focused devctl/CLI tests pass (33/33), including old-inode continuity and
rollback. The `desktop-shell` Acceptance domain, Feature, Capability, Registry
rule and `desktop-linux-install-native-e2e` Gate are structurally connected.

The current Linux host fails preflight before build because
`webkit2gtk-4.1`, `javascriptcoregtk-4.1` and `libsoup-3.0` are absent. The
functional and Native proof states remain `BLOCKED_BY_ENVIRONMENT`; devctl
returns exact Debian/Ubuntu and Fedora package hints and performs no host
package mutation.

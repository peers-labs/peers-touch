# Cross-platform Desktop install adapter

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-01",
  "workstreamId": "ADL",
  "title": "Cross-platform Desktop install adapter and Linux user install",
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
    "One install orchestrator delegates platform-specific build, stage, install and verify behavior.",
    "Linux installs an executable AppImage, icon, desktop entry and peers-touch-dev deep-link handler without root.",
    "macOS keeps its app bundle, codesign and atomic replacement behavior.",
    "Windows Native development setup and process adapter tests remain unchanged."
  ],
  "failureBehavior": [
    "Missing Linux system prerequisites return one typed dependency error with exact package evidence.",
    "A failed atomic replacement restores the previous installed artifact.",
    "A source change during build rejects installation.",
    "Windows persistent installation and OS package installation remain explicit non-claims."
  ],
  "updatedAt": "2026-10-20T03:15:00.000Z"
}
```

## Current Snapshot

未开始。`desktop-install` 仍由 `tooling/devctl/desktop.mjs` 内的 macOS 专属
流程拥有，Linux 返回 `DEVCTL_UNSUPPORTED_MODE`。现有 macOS 单测是本 Task
必须保留的回归基线；Windows 仅有 Native development 支持。

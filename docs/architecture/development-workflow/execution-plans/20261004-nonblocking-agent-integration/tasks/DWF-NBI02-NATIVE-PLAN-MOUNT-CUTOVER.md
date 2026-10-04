# Native Desktop And Plan Mount Cutover

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-NONBLOCKING-INTEGRATION-20261004",
  "taskId": "DWF-NBI02-NATIVE-PLAN-MOUNT-CUTOVER",
  "workstreamId": "DWF-INTEGRATION-CONTROL",
  "title": "Replace workspace binding with Plan mount and remove Desktop browser support",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "native-plan-mount-cutover",
  "journeyId": "DEV-J01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "AGENTS.md",
    "Makefile",
    "apps/desktop",
    "apps/dev",
    "apps/station/app/subserver/agent",
    "docs",
    "tooling/acceptance",
    "tooling/development/secure_content",
    "tooling/devctl",
    "tooling/make",
    "tooling/plugins/pt-ew-plugin",
    "tooling/scripts",
    "tooling/skills"
  ],
  "readSet": [],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "plan-mount-source",
      "command": "node --test tooling/scripts/plan/plan-mount.test.mjs tooling/scripts/plan/planctl.test.mjs tooling/scripts/local-dev/active-work-store.test.mjs tooling/scripts/local-dev/dev-session.test.mjs tooling/scripts/local-dev/completion-review.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "native-only-source",
      "command": "python3 -m unittest tooling.acceptance.tests.test_native_desktop_macos tooling.acceptance.tests.test_provisioner_runtime tooling.acceptance.gates.desktop.primary_navigation_e2e_test && node --test tooling/devctl/test/desktop.test.mjs tooling/devctl/test/wrapper-policy.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "native-only-functional",
      "command": "python3 -m tooling.acceptance.gates.desktop.primary_navigation_e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "A frozen PlanVersion can be mounted by an explicitly selected execution worktree without inheriting the authoring worktree",
    "ExecutionPlanSnapshot contains the immutable Plan payload and executionBinding used by the run",
    "A worktree rejects a second live Plan mount until the current mount is completed, cancelled, or explicitly unmounted",
    "Mount lifecycle is independent from runtime lease TTL and atomic operation locks",
    "make desktop is the only Desktop development launch entrypoint",
    "Desktop browser scripts, devctl web mode, browser runtime class, browser product matrices, and browser compatibility aliases are absent",
    "Peers Dev retains read-only Workflow Snapshot CLI and library projection without apps/dev web assets, HTTP server, fixed port 4177, or browser Gates",
    "Desktop product proof launches a native Tauri window and uses native input and screenshot evidence"
  ],
  "failureBehavior": [
    "Do not infer a mount from branch, directory scan, active-work, or an expiring declaration",
    "Do not let an Agent amend a frozen PlanVersion or silently rebind a mount",
    "Do not retain dual-read binding and mount paths",
    "Do not substitute WebDriver against Chromium for native Desktop proof",
    "Do not remove Tauri WebView rendering, system-browser OAuth handoff, or independent Web products",
    "Do not modify docs/architecture/federation/data-model.md"
  ],
  "updatedAt": "2026-10-04T14:35:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: pending on `DWF-NBI01-CONTROL-ACTIONS`.
- No formal evidence recorded.

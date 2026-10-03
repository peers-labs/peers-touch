# Implement And Prove Cross-Worktree Cargo Cache

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "LDCP-CARGO-CACHE-20261003",
  "taskId": "LDCP-CARGO-CACHE-01",
  "workstreamId": "LDCP-CARGO-CACHE",
  "title": "Implement and prove cross-worktree Cargo cache",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "cargo-cache-functional",
  "journeyId": "LDCP-J-CARGO-CACHE",
  "runtimeClass": "source-only",
  "writeSet": [
    ".cargo",
    "Makefile",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/local-dev-control-plane",
    "tooling/make/setup.mk",
    "tooling/scripts/architecture/module-governance.test.mjs",
    "tooling/scripts/cargo-cache.sh",
    "tooling/scripts/cargo-cache.test.mjs",
    "tooling/skills/pt-github-review/FRESHNESS.md"
  ],
  "readSet": [
    "apps/desktop/src-tauri",
    "apps/mobile/src-tauri",
    "tooling/make/acceptance.mk",
    "tooling/scripts/local-dev/desktop-dev.sh",
    "tooling/scripts/local-dev/mobile-ios-sim.sh"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "cargo-cache-source",
      "command": "git diff --check && bash -n tooling/scripts/cargo-cache.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "cargo-cache-unit",
      "command": "node --test tooling/scripts/cargo-cache.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "cargo-cache-cross-directory",
      "command": "bash tooling/scripts/cargo-cache.sh verify",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Cargo discovers the repository wrapper from root and nested manifests",
    "The wrapper uses sccache when present and directly executes rustc when absent or disabled",
    "Machine setup makes retained worktrees use the same bounded cache without manual environment exports",
    "Desktop and Mobile keep their existing worktree-local target paths",
    "Two byte-identical temporary crates with separate targets produce at least one cache hit",
    "Architecture module governance passes"
  ],
  "failureBehavior": [
    "Do not set a shared CARGO_TARGET_DIR or Cargo build.target-dir",
    "Do not overwrite unrelated Cargo user configuration",
    "Do not delete existing targets or cache data",
    "Do not build product Rust workspaces for this proof",
    "Do not modify sibling worktrees"
  ],
  "updatedAt": "2026-10-03T15:02:30.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "command://bash-n-shellcheck-git-diff-check"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "command://node-test-tooling-scripts-cargo-cache"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "sccache://cross-directory/cache-hits/1"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance://dbd1913c8dd24d52/architecture-module-governance/20261003T142523758377Z-b1e9d32266b98a51985d413d871af9a4"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance://dbd1913c8dd24d52/acceptance-workflow-contract/20261003T142523861369Z-a30e783a86f13fd8b7da8f4b0f12e398"
    }
  ]
}
```

## Current Snapshot

- `sccache 0.18.0` is installed and bounded to 10 GiB under the machine Dev
  root.
- Cargo user configuration references the stable machine wrapper, while the
  repository configuration covers nested manifests after source sync.
- Unit, fallback, idempotency, nested-discovery, architecture, workflow, and
  real cross-directory cache-hit checks pass.
- Desktop and Mobile target paths remain worktree-local and unchanged.
- The user authorized a checkpoint commit and pull request so the remaining
  clean-source browser Gate can run against an immutable source identity.
- Formal Gate aggregation is owned by the dependent Acceptance Task.

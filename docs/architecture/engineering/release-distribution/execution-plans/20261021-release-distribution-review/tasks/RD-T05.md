# RD-T05 — 注册完整的 Desktop 更新通道

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T05",
  "workstreamId": "RD",
  "title": "Register updater runtime and prove versioned signed updates before stable promotion",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rd-desktop-release",
  "journeyId": "RD-J05",
  "runtimeClass": "native-desktop",
  "writeSet": [
    ".github/workflows/release.yml",
    "tooling/distribution",
    "apps/desktop/package.json",
    "pnpm-lock.yaml",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/src-tauri/Cargo.lock",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/capabilities",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/src/application"
  ],
  "readSet": ["docs/architecture/engineering/release-distribution/design.md", "docs/architecture/engineering/release-distribution/data-model.md"],
  "budgets": {"focusedCheckSeconds": 1800, "functionalRunSeconds": 5400, "cleanupSeconds": 180},
  "checks": [
    {"id": "rd-desktop-source", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-desktop-candidate-suite", "command": "node tooling/distribution/release-evidence-check.mjs --repo peers-labs/peers-touch --run-id \"${PT_RD_RUN_ID:?}\" --attempt \"${PT_RD_RUN_ATTEMPT:?}\" --tag \"${PT_RD_TAG:?}\" --source \"$(git rev-parse HEAD)\" --task RD-T05 --phase candidate --from-tag \"${PT_RD_FROM_TAG:?}\"", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "rd-desktop-public-suite", "command": "node tooling/distribution/release-evidence-check.mjs --repo peers-labs/peers-touch --run-id \"${PT_RD_RUN_ID:?}\" --attempt \"${PT_RD_RUN_ATTEMPT:?}\" --tag \"${PT_RD_TAG:?}\" --source \"$(git rev-parse HEAD)\" --task RD-T05 --phase public", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "rd-desktop-candidate-suite",
    "scenarioIds": ["rd-desktop-install", "rd-updater-discovery", "rd-updater-signature-reject", "rd-updater-apply"],
    "maxProvisioningRuns": 4,
    "maxClientLaunches": 8,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "Dependency, lockfiles, config, capabilities and main.rs updater Builder registration land together; registration errors propagate and actual plugin check/download are invoked by the native runtime test.",
    "Stable endpoint is /releases/latest/download/latest.json; package URLs inside static manifest use fixed full tags. Universal macOS package appears under darwin-x86_64 and darwin-aarch64; macOS updater asset is .app.tar.gz with signature.",
    "Official tauri-action builds macOS universal, Windows NSIS and Linux AppImage/deb with explicit prerequisite installation; all legs attach to the same draft release and only lifecycle owners publish/promote.",
    "Suite provides each OS/CPU verification target once, preserves account/storage across scenarios, and treats update-driven replacement/restart as product actions. Lipo alone proves only slice inclusion, not execution on Intel and ARM.",
    "Real version A client invokes its registered updater with a test-only HTTPS endpoint override. Candidate manifest projects only package download origin while preserving version/platform/signature; actual package bytes are unchanged, original tag URLs are checked separately, and installed client retains the stable production endpoint. It discovers real higher version B, installs/restarts and reads durable state; same version gives no update.",
    "Tampered package bytes or signature are rejected before installation and old app remains usable. Manifest URL/platform/version assertions are separate; a URL substitution serving identical valid signed bytes is not falsely required to fail.",
    "Tauri package signing secrets are required; unsigned OS installers are allowed but unsigned updates are not. Secrets never reach public scripts or reports.",
    "After candidate pass, full release is published make_latest=false; fresh anonymous public Suite verifies artifacts and startup. Only complete formal release passing public verification may promote latest; rc and intermediate Station-only releases cannot.",
    "Channel promotion/readback verifies that the stable manifest advances while package URLs remain pinned; first-release 404, stale promotion and failed public verify cannot disable or roll back an existing stable channel.",
    "Linux deb update behavior is measured on locked dependencies and documented; missing CPU/platform runtime targets stay UNPROVEN rather than inferred from build success."
  ],
  "failureBehavior": [
    "Missing registration, platform key, signing secret or updater execution blocks channel-complete claim.",
    "Any candidate failure preserves draft; any public failure leaves prior stable channel intact.",
    "Source, attempt, version-pair, binary digest or cleanup mismatch rejects Suite evidence; no in-app update UI or current release execution is authorized here."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Current Snapshot

- Runtime budget covers Windows x64, Linux x64 and both macOS CPU test targets; unavailable lanes stay explicitly UNPROVEN.
- Candidate and public Suite instances are separate trust boundaries; each reuses its target's runtime across attached scenarios.
- Update UI is out of scope; native test invocation verifies the actual registered plugin and resulting product state.

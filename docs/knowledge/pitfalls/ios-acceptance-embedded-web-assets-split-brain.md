---
kind: pitfall
title: iOS acceptance build can split embedded web assets from bundle resources
status: active
owns:
  - tooling/acceptance/provisioners/mobile_simulator.py
  - tooling/acceptance/tests/test_mobile_simulator_provisioner.py
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/design.md
  - docs/knowledge/pitfalls/ios-simulator-uninstall-retains-keychain.md
detected: 2026-11-09
owner: acceptance-infra
review-cadence: on-change
---

# iOS acceptance build can split embedded web assets from bundle resources

## Symptom

A simulator Gate failed at the iOS WebView preflight with
`Appium client '<id>' did not expose the Mobile Acceptance WebView` even though
the WebView context existed, the application bundle was the acceptance
configuration (`harnessEnabled: true`), and its `assets/` resource folder
contained the harness `registry-*.js` chunk. At runtime the WebView served a
different entry chunk whose build did not contain
`window.__PEERS_MOBILE_ACCEPTANCE__`, so the harness inventory never appeared.

## Root cause

Tauri embeds `frontendDist` into the native binary at Cargo build time through
`tauri::generate_context!()`, while the Xcode resource copy separately stages
`apps/mobile/src-tauri/gen/apple/assets` into the bundle. Both consumers read
the mutable, worktree-shared `apps/mobile/dist`. A plain
`pnpm --dir apps/mobile run build` without `VITE_ACCEPTANCE_HARNESS=1` running
concurrently with provisioning overwrote `dist` after the resource copy but
before the Rust embedding. The resulting application served the harness-less
embedded assets while keeping harness files in its bundle resources. The
content-addressed iOS build cache then sealed and reused the split-brain
artifact, making the failure deterministic across reruns.

## Mitigation

### What was done in code

- The provisioner snapshots the harness web build into a run-owned
  `ios-web-dist` directory immediately after the web build phase. Both the
  `gen/apple/assets` staging and a `TAURI_CONFIG` `frontendDist` override
  (delivered through the existing `MOBILE_TAURI_DEV_CONFIG` path consumed by
  `gen/apple/scripts/build-rust-code.sh`) point at that immutable snapshot.
- After `xcodebuild`, the provisioner fails closed when the native binary's
  embedded `/assets/*` index does not contain every entry referenced by the
  staged `index.html`, and, for harness builds, the exact single
  `registry-*.js` chunk. The block reports missing and stale embedded entries.
- The binding applies to all three simulator provisioning flows (dual-sim
  catalog, selected-client, and layout). Cache-hit builds keep the previously
  verified sealed artifact; the check runs only when a native build executes.

### What guards against regression

- `MobileSimulatorProvisionerTests.test_ios_build_binds_cargo_to_immutable_dist_snapshot`
  proves the Cargo phase receives the snapshot override, the web phase does
  not, and later worktree `dist` mutation cannot reach the snapshot.
- `MobileSimulatorProvisionerTests.test_ios_build_blocks_when_native_embedding_diverges`
  forces a native binary without the staged asset tokens and requires the
  `mobile-simulator:ios-embedded-web-assets` block.
- The fixture web build emits a harness `registry-*.js` chunk only under
  `VITE_ACCEPTANCE_HARNESS=1`, and the fixture `xcodebuild` embeds the staged
  asset token set into its native stub.

## How to detect a recurrence

```bash
PATH="$PWD/.local/acceptance/python-venv/bin:$PATH" \
  python3 -m unittest \
  tooling.acceptance.tests.test_mobile_simulator_provisioner
```

Both embedded-asset tests must pass. On a built simulator application, compare
the two asset sources directly:

```bash
# Entry served from the Rust-embedded asset index
strings <Peers.app>/Peers.debug.dylib | grep '^/assets/index-'
# Entry declared by the staged/bundle resource copy
grep -o '/assets/index-[^"]*\.js' <Peers.app>/assets/index.html
```

The two entries must be identical, and the dylib must embed the harness
`/assets/registry-*.js` chunk for acceptance builds. A mismatch is the
split-brain condition, not a Gate or WebView timing issue. Do not run plain
mobile web builds while simulator provisioning is active.

## Crosswalks

- `docs/knowledge/pitfalls/ios-simulator-uninstall-retains-keychain.md` governs
  the same provisioner's device-isolation guarantees.

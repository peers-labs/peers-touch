---
name: pt-dev-runtime-handoff
description: >
  Use after code changes when the user wants to prepare a Peers-Touch dev
  runtime and run native Tauri Acceptance through the embedded WebDriver.
---

# Dev Runtime Handoff

> Environment source: `docs/global/local-dev-environment.md`

## Goal

Prepare the required Station/Desktop runtime, run the standardized Python
Acceptance Gate, and report source-bound evidence. The user does not perform
manual clicks.

## Native Desktop Acceptance Architecture

```text
Python Acceptance gate
  -> Selenium W3C client
  -> embedded WebDriver server
  -> native macOS Tauri WKWebView
  -> Desktop Rust BFF
  -> Station
```

The WebDriver plugin and `window.__TAURI__` are enabled only in the
`acceptance-webdriver` build. Browser shells, coordinate automation, mocks, and
API-only receiver proof are forbidden substitutes.

## Runtime Selection

- `make desktop`: interactive development runtime.
- `make desktop-web`: browser debugging only, never product Acceptance.
- `make acceptance-driver-build`: build the feature-gated native Acceptance
  binary.
- `make acceptance-driver-smoke`: verify native URL, DOM, global Tauri API,
  process teardown, and port release.

Restart Station when changes touch Station, schema, or generated protocol code.
Rebuild the Acceptance binary when changes touch Desktop Rust, Desktop UI, the
Acceptance harness, or driver feature wiring.

## Standard Chat Workflow

```bash
python3 -m pip install -r tooling/acceptance/requirements.txt
make acceptance-driver-build
make acceptance-driver-smoke

CHAT_ACCEPTANCE_RESET=1 \
CHAT_ACCEPTANCE_PASSWORD=<test-password> \
CHAT_DESKTOP_DOM_STATION_URL=http://10.37.94.156:18080 \
make acceptance-chat-desktop-dom

make profile PROFILE=<approved-disposable-profile>

CHAT_ACCEPTANCE_RESET=1 \
CHAT_NATIVE_DEMO_PASSWORD="$CHAT_NATIVE_DEMO_PASSWORD" \
make acceptance-chat-native-two-client
```

The native two-client target invokes the environment Provisioner first.
Station URL, deployment attestation, canonical PTIDs, client ports/profiles,
storage, and observer sockets come only from
`PT_ACCEPTANCE_RUNTIME_MANIFEST`; do not export those values manually.

Provisioning failures are `BLOCKED/UNPROVEN` with exit code `2`. Product Gate
failures are `FAILED/UNPROVEN` with exit code `1`.

The two-client Gate must prove Alice send, Bob receiver DOM with the same
message ID/body, unread badge increment/clear, and receiver restart recovery.

## Evidence Contract

Require:

- runner and validator JSON;
- native screenshots and DOM snapshots;
- redacted app logs;
- Station live build metadata;
- per-client WebDriver/gateway/profile/storage metadata;
- bounded step timing;
- secret scan;
- native process and port release audit.

Do not claim Acceptance from a smoke check, API result, browser render, or
manual screenshot.

## Failure Inspection

1. Runner's first failed bounded step.
2. Native app logs and WebDriver process liveness.
3. Rust messaging engine and queue lifecycle.
4. `messagingProjection` and owning runtime.
5. projection store.
6. stable DOM selector and component rendering.

Fix state at its owning layer. Do not add page-mount refreshes or polling to
mask a missing runtime transition.

## Handoff Report

Report:

- Station URL and live commit;
- exact Gate commands and PASS/FAIL;
- conversation/message IDs;
- evidence paths;
- process/port/storage cleanup result;
- explicit unproven scope.

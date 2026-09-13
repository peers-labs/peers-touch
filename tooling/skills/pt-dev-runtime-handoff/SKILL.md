---
name: pt-dev-runtime-handoff
description: >
  Use after code changes when the user wants to prepare a Peers-Touch dev
  runtime for an exact-source functional Journey or formal native Tauri
  Acceptance through the embedded WebDriver.
---

# Dev Runtime Handoff

> Environment source: `docs/global/local-dev-environment.md`

## Goal

Prepare the required Station/Desktop runtime under one of two policies:

- `development`: run one exact-source product Journey, report the first failure,
  and write only Development diagnostics.
- `acceptance`: run formal Native Tauri Acceptance and publish source-bound
  Evidence Store artifacts.

Both policies consume the same business Journey. They must not duplicate or
weaken product actions and assertions.

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

Before either policy:

```bash
make dev-check WORK_ITEM=<id>
```

The public declaration must name the Profile, local slot, client storage and
Station capability intent. The declaration does not replace Local Dev leases.

## Agent Station Safety Gate

Local and compose-managed Station modes are human-developer-only capabilities.
Agents MUST NOT start, access, or test against a Station on `127.0.0.1`,
`localhost`, or another loopback address.

Before any command that may ready or access Station, including `make station`,
`make desktop`, `make desktop-web`, `make mobile`, restart targets, or an
environment-backed Acceptance Gate:

1. Run `make config`.
2. Verify `PT_STATION_MODE=remote`.
3. Verify `PT_STATION_DEPLOY_ENV` is non-empty and user-approved.
4. Verify `PT_STATION_URL` is non-loopback and matches the approved node.

Fail closed on missing, local, compose, loopback, defaulted, or mismatched
values. After this preflight, `make station` is the correct command for the
remote deploy/restart/health closure. Do not replace it with ad hoc SSH or
local process commands.

## Development Policy

Use after focused checks and an authorized checkpoint:

```text
make config
  -> verify approved remote profile
make station                # only when Station source changed
make desktop                # interactive Native development runtime
run one declared Journey
  -> PASS: FUNCTIONAL_CHECK for that Journey
  -> FAIL: first actionable product failure only
  -> BLOCKED: environment/driver/authorization owner
reverse-order cleanup
```

Development policy:

- does not allocate an Acceptance Evidence Store run;
- does not run coverage, Gap Detector, broad Gate bundles or cross-platform
  matrices;
- persists transient logs/screenshots under the workspace Development path;
- cannot publish `PROVEN`;
- must use the product runtime required by the Journey.

## Acceptance Policy

```bash
make config
# Verify remote mode, approved deploy env, and non-loopback PT_STATION_URL.
make station

python3 -m pip install -r tooling/acceptance/requirements.txt
make acceptance-driver-build
make acceptance-driver-smoke

CHAT_ACCEPTANCE_RESET=1 \
CHAT_DESKTOP_DOM_STATION_URL="${PT_STATION_URL}" \
make acceptance-chat-desktop-dom

CHAT_ACCEPTANCE_RESET=1 \
CHAT_NATIVE_STATION_URL="${PT_STATION_URL}" \
make acceptance-chat-native-two-client
```

Native Chat gates use the committed disposable dev-account fixture from
`apps/station/app/conf/actor.yml`; do not require a separate password
environment variable for these public test accounts.

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

- policy: `development` or `acceptance`;
- Station URL and live commit;
- exact Gate commands and PASS/FAIL;
- conversation/message IDs;
- evidence paths;
- process/port/storage cleanup result;
- explicit unproven scope.

For development policy, report only verification class, Journey, first failure,
runtime identity and cleanup. For Acceptance policy, include immutable evidence
references and proof state.

## Anti-Patterns

Never:

- Run without a current public Development declaration.
- Use Acceptance policy to diagnose the first product failure.
- Publish Development diagnostics as Acceptance proof.
- Maintain separate Dev and Acceptance Journey implementations.
- Replace Native actions with browser, coordinate-only, Harness-only or
  API-only shortcuts.

# Mobile Native Acceptance

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-28 | **Updated**: 2026-08-29
> **Owner**: Mobile Team
> **Module**: `tooling/acceptance/gates/mobile/`

---

## 1. Scope

This document records how Peers-Touch selected and implements native Mobile
E2E automation for the Tauri iOS and Android applications.

It defines:

- why Mobile does not reuse the Desktop driver unchanged;
- which alternatives were evaluated;
- the selected Appium hybrid architecture;
- simulator versus physical-device proof boundaries;
- ownership and cleanup requirements.

Product behavior remains governed by
`docs/architecture/mobile/acceptance-matrix.md`. Architecture decision MS-D14
in `docs/architecture/mobile/decisions.md` remains the decision source of
truth.

## 2. Required Proof Surface

Mobile Acceptance must exercise one installed native application and prove:

1. Native launch, termination, restart, and OS deep-link delivery.
2. iOS and Android native accessibility trees.
3. The real Tauri WebView and its rendered DOM.
4. Production Rust commands and runtime projections through a typed,
   Acceptance-only Harness.
5. Source-bound screenshots, projections, runtime identity, and cleanup.
6. Real provider OAuth on physical devices for MS-AG03.

A browser-only test cannot satisfy items 1, 2, or 6. A native-only accessibility
test cannot precisely inspect the typed Web runtime and projection contracts.

## 3. Desktop Comparison

Desktop uses the project's embedded WebDriver path:

```text
Acceptance runner
  -> embedded WebDriver server in the Tauri Desktop process
  -> desktop WebView
  -> typed Acceptance Harness
```

This is not a portable iOS transport. Tauri's official WebDriver documentation
states that direct `tauri-driver` support is for Windows and Linux desktop;
mobile iOS and Android use Appium 2 and are not yet streamlined by Tauri.

Mobile therefore preserves the same W3C WebDriver and typed-Harness model but
uses platform-native automation underneath:

```text
Acceptance runner
  -> Appium 2
     +-> XCUITest driver -> WebDriverAgent -> iOS app
     +-> UiAutomator2 driver -------------> Android app
  -> NATIVE_APP context
  -> WEBVIEW_* context
  -> window.__PEERS_MOBILE_ACCEPTANCE__
  -> production runtime intents and projections
```

The Desktop and Mobile implementations share evidence semantics, not the same
driver executable.

## 4. Options Evaluated

| Option | Native lifecycle and deep links | WebView DOM and JS | Cross-platform orchestration | Decision |
|---|---:|---:|---:|---|
| XCTest + XCUIAutomation | Strong on iOS | Indirect and accessibility-oriented | iOS only | Valid platform-specific fallback |
| WebDriverAgent directly | Strong on iOS | Supports WebDriver contexts | iOS only; project owns low-level lifecycle | Rejected as primary |
| Appium + XCUITest/UiAutomator2 | Strong | Native/WebView context switching | Shared W3C model for iOS and Android | Selected |
| Maestro | Strong for black-box flows | Less aligned with the typed JS Harness contract | Shared mobile flow syntax | Not selected as primary |
| Playwright/browser-only | None for installed-app lifecycle | Strong browser DOM support | Web only | Diagnostic tier only |
| Tauri Desktop embedded WebDriver | Strong for Desktop Tauri | Strong | Desktop-oriented | Retained for Desktop only |

### 4.1 XCTest And XCUIAutomation

Apple's supported UI-test stack can launch, monitor, terminate, inspect, and
interact with applications on devices and simulators. It is the native
foundation used by the selected iOS path.

Using XCTest directly remains appropriate for iOS-only native plugin tests or
platform behavior that cannot be represented through Appium. It is not the
primary product Gate because it would require a second orchestration,
reporting, action, and evidence implementation beside Android.

### 4.2 WebDriverAgent Directly

WebDriverAgent exposes XCUITest through a WebDriver-compatible server. Appium's
XCUITest driver already manages this layer. Driving WDA directly would remove
Appium's session abstraction while making Peers-Touch own WDA build,
capability, protocol, retry, and teardown compatibility.

It offers no required product capability that Appium does not already expose,
so it is not selected.

### 4.3 Appium Hybrid Automation

Appium drivers map W3C WebDriver commands to platform automation systems. The
XCUITest and UiAutomator2 drivers officially support native, hybrid, and web
modes. Appium context APIs expose `NATIVE_APP` and available `WEBVIEW_*`
contexts.

This permits one Gate to:

- use native context for launch, termination, accessibility, screenshots, and
  deep links;
- switch to the WebView for typed Harness actions and projection readback;
- use equivalent evidence and failure semantics on both platforms.

Appium does not own product truth. It transports actions to the real
application.

### 4.4 Maestro

Maestro is suitable for black-box user journeys and native UI interaction. It
is not the primary choice here because the project requires deterministic
WebView JavaScript execution against a typed Harness, source-bound projection
capture, and integration with the existing Python Evidence Store.

It remains a possible supplementary smoke-test tool, not an MS-AG03 proof
replacement.

### 4.5 Browser-Only Automation

Playwright or browser-mode WebDriver can validate the Web UI quickly. They
cannot prove installed-app lifecycle, native deep-link dispatch, Keychain or
AndroidKeyStore behavior, native permission handling, or physical provider
handoff. They remain diagnostic or component-level evidence only.

## 5. Android-Specific Selection

Android has a different automation stack from iOS and must be evaluated
separately:

```text
Acceptance runner
  -> Appium server
  -> UiAutomator2 driver
     +-> UiAutomator2 server on device
     +-> adb for application and OS operations
     +-> matching Chromedriver for WEBVIEW_* contexts
  -> Tauri Android application
```

### 5.1 UiAutomator Directly

Android's UI Automator is the platform-supported outside-process UI automation
API. It can launch applications and intents, clear application data, interact
with system UI, wait for stable windows, and capture screenshots.

It is a valid choice for Android-only native shell, permission, notification,
multi-window, and macrobenchmark coverage. It is not the primary Mobile product
Gate because Peers-Touch would need to duplicate the shared W3C orchestration,
typed Harness calls, evidence output, and lifecycle rules in Kotlin.

### 5.2 Espresso

Espresso is an in-process Android UI framework with strong synchronization and
an `espresso-web` package for WebView interaction. It is appropriate for focused
Android implementation tests where application internals and idling resources
are intentionally part of the test contract.

It is not selected as the cross-platform product Gate because it requires an
Android instrumentation test APK and cannot share the same external session
model with iOS. Espresso Intents may also stub intents, which is forbidden for
the real OAuth callback proof unless a specific test is explicitly scoped as a
hermetic component test.

### 5.3 Appium UiAutomator2

The selected Android driver is Appium UiAutomator2 because it:

- drives emulators and physical devices from outside the application;
- supports native, hybrid, and mobile-web modes;
- uses W3C WebDriver like the iOS path;
- delegates native interaction to UiAutomator2 and device operations to ADB;
- supports isolated `udid`, `systemPort`, MJPEG, and Chromedriver ports.

The project currently uses Appium 2 with UiAutomator2 driver 4.2.9. This pin is
intentional: current UiAutomator2 major versions that require Appium 3 cannot be
adopted without an explicitly approved dependency-version change.

### 5.4 Android WebView Driver Contract

UiAutomator2 does not itself execute DOM JavaScript inside Chromium WebView.
Switching from `NATIVE_APP` to `WEBVIEW_*` requires a Chromedriver compatible
with the WebView/Chrome major version installed in the selected AVD or device.

Therefore the Android environment must declare:

- AVD or physical-device identity and ABI.
- Android API and WebView/Chrome version.
- Exact compatible Chromedriver artifact or approved acquisition mechanism.
- Chromedriver port ownership.
- Driver checksum/source identity.
- Reverse-order process and temporary-artifact cleanup.

The Gate must fail closed when the driver is absent or incompatible. Automatic
network download is not enabled implicitly because it makes execution
non-reproducible and weakens artifact provenance.

### 5.5 Android Alternatives Decision

| Requirement | UI Automator | Espresso | Maestro | Appium UiAutomator2 |
|---|---:|---:|---:|---:|
| Installed-app and system UI | Yes | Limited outside app | Yes | Yes |
| Deep-link and lifecycle control | Yes | Yes | Yes | Yes |
| WebView DOM/JavaScript | No direct shared contract | `espresso-web` | UI-oriented | Yes, with Chromedriver |
| Same orchestration as iOS | No | No | Mostly | Yes |
| Existing Python Evidence Store integration | New adapter required | New adapter required | New adapter required | Existing |
| Typed Mobile Harness reuse | New bridge required | New bridge required | Limited | Existing |

Decision: retain Appium UiAutomator2 as the primary Android product Gate.
Use direct UI Automator or Espresso for Android-specific component,
instrumentation, performance, or permission tests when those tests do not claim
cross-platform product proof.

## 6. Selection Criteria

The primary choice is based on:

1. Real installed Tauri application execution.
2. Native and WebView context coverage in one session.
3. iOS and Android parity at the orchestration layer.
4. W3C protocol compatibility.
5. Deterministic device, port, storage, process, and session ownership.
6. Compatibility with the existing typed Harness and external Evidence Store.
7. No mock success injection and no direct Store mutation.

Appium best satisfies the combined criteria. XCTest remains the underlying iOS
authority and the fallback for platform-specific coverage.

## 7. Implementation Ownership

| Component | Owner |
|---|---|
| `appium.py` | W3C transport, session capabilities, context switching |
| `simulator_e2e.py` | Simulator callback/restart/fail-closed assertions |
| `native_e2e.py` | Physical-device provider and product journeys |
| `mobile_simulator.py` | Simulator/emulator/build/Appium resource lifecycle |
| `mobile_native.py` | Physical devices, services, credentials, and fixture inputs |
| `apps/mobile/src/acceptance/` | Typed production-action Harness |
| `proof-contract.schema.json` | Mobile OAuth proof payload and Artifact Role catalog |
| `proof_contracts.py` | Fail-closed payload, role, source/version, redaction, and cutover validation |
| `proof_contracts_test.py` | Adversarial E2-0 contract and source-policy coverage |

Provisioners prepare resources and emit immutable runtime manifests. Gates
consume manifests and assert product behavior. Neither may take over the
other's responsibility.

For simulator runs, the Provisioner owns application installation and removal,
so Appium sessions use `noReset=true` and `fullReset=false`. The typed
`lifecycle.restart` action acknowledges the requested WebView restart first;
the Appium driver then executes the W3C refresh command and waits for the
Harness to reconnect. This prevents navigation from destroying the document
before the action response is delivered.

### 7.1 E2-0A Frozen Proof Contracts

The physical Mobile Gate uses four typed payloads in addition to the original
E2-0 contracts:

- `physical-device-lease` records only an opaque device reference, its client
  and platform binding, physical-device checks, and the current lease fence.
- Acquisition artifacts are immutable snapshots: Fixture/account leases remain
  `LEASED`, while physical-device/browser leases remain `BASELINE_VERIFIED`.
  Terminal state exists only in `mobile-lease-outcome`.
- `mobile-lease-outcome` closes exactly two Fixture, four physical-device, two
  provider-account, and four browser-session acquisitions. Released outcomes
  prove cleanup, baseline restoration, and identity revalidation. Provider
  outcomes also prove completed operations with maximum observed concurrency
  equal to one. Quarantined outcomes may record higher observed concurrency or
  failed fence validation together with a typed failure code.
- `mobile-fresh-install-trace` binds uninstall/readback/install success to the
  fenced device, attested build ArtifactRef, application ID, artifact hash,
  explicit step indexes, and ordered UTC completion times.
- `mobile-installed-build-identity` binds the installed application and fresh
  install to equal Web, Rust/native, and attested embedded identity digests.

Build attestations use an empty-base allowlisted environment and
locked-preseeded tool-native offline resolution. `resolverArguments` is the
only resolver-detail source: Android records pnpm, Cargo, and Gradle arguments
and marks Xcode inapplicable; iOS records pnpm, Cargo, and Xcode arguments and
marks Gradle inapplicable. This is not a general-purpose hermetic sandbox.

iOS signing records the `codesign` SHA-256 CDHash as 40 lowercase hexadecimal
characters plus the 64-character full candidate. Android records signer
certificate and signing schemes and cannot carry iOS signing fields.

Cross-artifact references match the target artifact's complete path and
SHA-256, not only its path. JSON Schema and Python semantic validation both
enforce the platform-specific resolver shape.

All four payloads retain the durable-evidence redaction bans for raw artifact
paths, UDID/serial values, signing subjects, provider identity, and
credentials. Validate the frozen contracts and source policies with:

```bash
python3 -m unittest tooling.acceptance.gates.mobile.proof_contracts_test
python3 -m tooling.acceptance.gates.mobile.proof_contracts --verify-protected-paths
python3 -m tooling.acceptance.gates.mobile.proof_contracts --verify-version-policy
python3 -m tooling.acceptance.gates.mobile.proof_contracts --verify-cutover-inventory
```

## 8. Proof Boundary

`mobile-simulator-access-e2e` may prove:

- application build, install, and launch;
- warm and cold native callback routing;
- deterministic fail-closed behavior;
- WebView Harness availability and projection readback;
- restart/reconnection behavior;
- resource cleanup.

It must not prove:

- real GitHub or Google authorization;
- physical-device browser return behavior;
- physical Keychain/AndroidKeyStore characteristics;
- full MS-AG03.

Those claims require `mobile-native-access-e2e`, physical iOS and Android
devices, approved disposable provider accounts, authoritative Station proof
snapshots, and all required negative cells.

## 9. Reversal Triggers

Re-evaluate Appium as the primary Mobile transport if:

- Tauri provides a supported cross-platform embedded Mobile WebDriver with
  equivalent native lifecycle and WebView coverage;
- Appium cannot provide stable WebView automation for the supported OS matrix;
- platform-specific XCTest/UiAutomator suites can share the same typed action,
  evidence, isolation, and cleanup contracts without duplication.

## 10. References

- Tauri WebDriver: https://v2.tauri.app/develop/tests/webdriver/
- Tauri manual WebDriver setup:
  https://v2.tauri.app/develop/tests/webdriver/manual-setup/
- Appium driver architecture:
  https://appium.io/docs/en/2.0/intro/drivers/
- Appium context switching:
  https://appium.io/docs/en/2.0/guides/context/
- Appium driver catalog:
  https://appium.io/docs/en/3.2/ecosystem/drivers/
- Apple XCTest: https://developer.apple.com/documentation/xctest
- Apple XCUIAutomation:
  https://developer.apple.com/documentation/xcuiautomation
- Android UI Automator:
  https://developer.android.com/training/testing/other-components/ui-automator
- Android Espresso:
  https://developer.android.com/training/testing/espresso
- Appium UiAutomator2 driver:
  https://github.com/appium/appium-uiautomator2-driver
- Maestro Android:
  https://docs.maestro.dev/get-started/supported-platform/android

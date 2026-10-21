# Mobile Acceptance Setup

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-16
> **Owner**: Mobile Team

---

## 1. Scope

This document describes Mobile Acceptance prerequisites and execution. The
architecture contract is
[Mobile Acceptance Environment](../../architecture/platform/client/mobile/mobile-acceptance-environment.md).

## 2. Common Prerequisites

- project-pinned Node.js and pnpm;
- Python 3.11+ project environment;
- Appium 2.19.0;
- generated Station/shared contracts;
- generated Mobile TypeScript contracts;
- exact-source build identity and workspace digest;
- source-attested Station dependencies required by the selected Gate.

```bash
./model/build.sh
./tooling/scripts/proto-gen-mobile.sh web
pnpm mobile:check
```

## 3. iOS Prerequisites

- current Xcode and required Simulator runtimes;
- Appium XCUITest driver pinned by the environment;
- pinned Simulator identities for isolated-client Gates;
- physical iOS device lease, signing, and provider/browser account leases when
  the Gate requires physical behavior.

Current iOS environment definitions are under
`tooling/acceptance/environments/mobile-*.yaml`.

## 4. Android Prerequisites

- Android SDK, platform/build tools, NDK, and emulator tooling;
- Appium UiAutomator2 driver pinned by the environment;
- compatible Chromedriver for WebView context switching;
- declared emulator host routing;
- USB-authorized physical device lease when the Gate requires physical
  behavior;
- FCM/provider configuration and accounts when the Gate asserts provider
  delivery.

Current physical Android environment definitions:

- `tooling/acceptance/environments/mobile-android-physical.yaml`
- `tooling/acceptance/environments/mobile-android-physical-runtime.yaml`

Missing general Android Mobile Shell Gates remain `UNPROVEN`.

## 5. Environment Validation

Before a Gate starts, verify:

- source revision and workspace digest;
- selected release target;
- build artifact identity;
- driver and device/simulator identity;
- isolated profile, ports, and storage root;
- Station/Relay runtime identity where required;
- provider/browser/device leases where required;
- cleanup actions and resource ownership.

## 6. Running Gates

Shared source:

```bash
pnpm mobile:check
```

Run one registered Gate:

```bash
python3 tooling/scripts/acceptance-run.py --gate <gate-id>
```

Examples of existing iOS-oriented Gates:

```bash
python3 tooling/scripts/acceptance-run.py --gate mobile-native-build
python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-access-e2e
python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-runtime-lifecycle-e2e
python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-whole-product-usability-e2e
```

Existing platform-specific Social Gates:

```bash
python3 tooling/scripts/acceptance-run.py --gate mobile-social-ios-native
python3 tooling/scripts/acceptance-run.py --gate mobile-social-android-native
```

Gate names define scope. `mobile-native-build` currently builds iOS Simulator
and does not prove Android.

## 7. Multi-Client Gates

Cross-session, receiver, call, and cross-device scenarios require independent:

- installations;
- driver sessions;
- runtime/device identities;
- actor/session scopes;
- profiles, ports, and storage roots.

Do not reuse one session to simulate both sides.

## 8. Network Setup

- iOS Simulator uses host networking but still verifies signed Station
  identity.
- Android Emulator reaches host services through the environment's declared
  host alias or forwarding; device `localhost` is not host `localhost`.
- Physical devices require reachable TLS endpoints and explicit device/network
  leases.
- Relay-backed scenarios declare Relay explicitly.

## 9. Evidence Requirements

Required artifacts include:

- build and runtime identity;
- release target and runtime mode;
- driver/device identity;
- typed action and projection evidence;
- Station owner readback for durable claims;
- receiver-side evidence for delivery claims;
- screenshots and accessibility trees for visible claims;
- redacted logs and timing for performance claims;
- deterministic cleanup result.

Evidence from one OS cannot satisfy the other OS.

## 10. Failure Handling

- Missing required environment or lease: `BLOCKED`.
- Missing registered Gate or artifact: `UNPROVEN`.
- Source/build/runtime mismatch: `FAILED`.
- Stale evidence: `STALE`.
- Mocked or injected success: invalid evidence.
- Cleanup failure: Gate failure.

## 11. Current Gaps

- General Mobile Shell acceptance is predominantly iOS Simulator based.
- Android whole-product, lifecycle, OAuth, recovery, layout, accessibility,
  and performance parity Gates are not complete.
- Push, background, media, secure-storage, and provider claims require
  capability-specific Android/iOS physical evidence.

No whole-Mobile readiness claim is valid until the required platform matrix is
complete.

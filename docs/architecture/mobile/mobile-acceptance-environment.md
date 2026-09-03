# Mobile Acceptance Environment Contract

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-03
> **Owner**: Mobile Architecture Team
> **Module**: `tooling/acceptance/gates/mobile/`, `tooling/acceptance/environments/`

---

## 1. Scope

This document defines the **contract** for mobile acceptance environments: what
is required, what each tier proves, and how environments map to architecture
gates. It does not describe setup procedures (see
`docs/client/mobile/acceptance-setup.md`) or gate runner internals (see
`tooling/acceptance/gates/mobile/README.md`).

## 2. Mobile Versus Desktop Acceptance

Mobile and Desktop acceptance share evidence semantics and the typed Harness
model but differ in transport, runtime model, and evidence collection.

| Dimension | Desktop | Mobile |
|---|---|---|
| Build target | Tauri Desktop binary | Tauri iOS `.app` / Android `.apk` |
| Runtime model | Single process with embedded WebView | Native app with platform WebView (WKWebView / Android WebView) |
| Driver | Embedded WebDriver (`tauri-driver`) | Appium 2 with XCUITest (iOS) / UiAutomator2 (Android) |
| Station connectivity | Host network, localhost or remote | Simulator shares host network (iOS) or NAT (Android emulator); physical device uses Wi-Fi/cellular |
| Native lifecycle | Window focus/close | `applicationDidEnterBackground`, `onPause`, deep links, push, permissions |
| Evidence collection | WebDriver screenshots + DOM + JS Harness | Native context screenshots + accessibility tree + WebView context JS Harness |
| WebView context | Direct (single context) | Context switching: `NATIVE_APP` and `WEBVIEW_*` |
| Typed Harness namespace | `window.__PEERS_DESKTOP_ACCEPTANCE__` | `window.__PEERS_MOBILE_ACCEPTANCE__` |

The implementations share evidence semantics, not the same driver executable.

## 3. Environment Tiers

### 3.1 Simulator Tier

Covers iOS Simulator and Android Emulator. Defined in
`tooling/acceptance/environments/mobile-simulator.yaml`.

Properties:

- No profile or identity match required.
- Provisioner owns application build, install, and removal.
- Appium sessions use `noReset=true` and `fullReset=false`.
- iOS Simulator shares the host network stack directly.
- Android Emulator uses NAT with host-loopback access via `10.0.2.2`.
- No physical device lease, no provider credentials required.
- Proves: application build/install/launch, native callback routing, restart
  behavior, fail-closed behavior, WebView Harness availability, projection
  readback, layout, accessibility, resource cleanup.
- Does not prove: real provider OAuth (MS-AG03), physical Keychain/AndroidKeyStore,
  physical-device browser return behavior, interaction performance on real
  hardware.

### 3.2 Physical Device Tier

Covers real iOS and Android devices. Defined in
`tooling/acceptance/environments/mobile-native.yaml`.

Properties:

- Profile and identity match required.
- Physical device leases with fenced broker, heartbeat, and quarantine policy.
- Provider credentials (GitHub and Google disposable accounts) required.
- Two-actor model: Alice and Bob on separate devices and Stations.
- Build attestation with platform-specific signing evidence.
- Proves: everything the simulator tier proves, plus real provider OAuth,
  physical Keychain/AndroidKeyStore, interaction performance on pinned hardware,
  browser return behavior, cross-device convergence.

## 4. Gate-To-Environment Mapping

| Gate | Simulator | Physical Device | Rationale |
|---|---|---|---|
| MS-AG01 Static/contracts | Yes (CI/local) | Not required | Compile-time checks only |
| MS-AG02 Lifecycle/isolation | Yes | Yes (full proof) | Simulator validates transitions; physical adds real OS lifecycle |
| MS-AG03 OAuth security | No | Required | Real provider handoff needs physical browser and Keychain |
| MS-AG04 Unknown outcome | Yes (partial) | Yes (full proof) | Network fault injection works on simulator; physical adds real disconnect |
| MS-AG05 Resume/teardown | Yes (partial) | Required | Physical background/resume and secure-delete behavior differ |
| MS-AG06 Projection freshness | Yes (partial) | Yes (full proof) | Simulator proves convergence logic; physical proves real latency |
| MS-AG07 Interaction performance | No | Required | Performance thresholds require pinned physical hardware |
| MS-AG08 Layout | Yes | Yes | Simulator covers viewport/keyboard; physical covers real display |
| MS-AG09 Admission/overload | Yes | Yes | Stress patterns run on both; physical validates real resource limits |
| MS-AG10 Payload/storage | Yes | Yes | Boundary checks run on both tiers |
| MS-AG11 Accessibility/i18n | Yes (partial) | Required | VoiceOver/TalkBack require real accessibility runtime |

Gates that show "Required" under Physical Device cannot be marked `PROVEN` with
simulator-only evidence. See `docs/architecture/mobile/acceptance-matrix.md` for
the full product-to-architecture mapping.

## 5. Station Dependency Contract

The mobile application requires a reachable Station with the following endpoints
for acceptance beyond static checks:

| Endpoint | Purpose | Required by |
|---|---|---|
| `/actor/access/start` | Initiate access gate chain | MS-AG02, MS-AG03 |
| `/sub-bootstrap/station-identity` | Signed Station identity and capability handshake | MS-AG02, MS-AG03, MS-AG05 |
| `/actor/session/validate` | Session validation on resume | MS-AG02, MS-AG05 |
| `/actor/access/oauth/callback` | OAuth callback processing | MS-AG03 |
| Domain-specific Proto endpoints | Chat, contacts, moments, settings | MS-AG04, MS-AG06, MS-AG09, MS-AG10 |

The Station must be reachable from the acceptance environment's network. For
simulators, this means the host machine's network for iOS Simulator and
`10.0.2.2` NAT mapping for Android Emulator. For physical devices, the Station
must be reachable over Wi-Fi or the configured network.

## 6. Network Requirements

### 6.1 iOS Simulator

The iOS Simulator shares the host machine's network stack. HTTP connections to
local or remote Stations work without additional configuration, provided the
application's `Info.plist` includes `NSAllowsArbitraryLoads = true` under
`NSAppTransportSecurity` for debug/acceptance builds. Production builds must not
carry this exception.

### 6.2 Android Emulator

The Android Emulator uses NAT. The host's `localhost` is unreachable from the
emulator; use `10.0.2.2` to reach host services. The emulator's own `localhost`
refers to the emulator itself. Cleartext HTTP requires
`android:usesCleartextTraffic="true"` in the debug manifest or a network
security config that permits the Station's address.

### 6.3 Physical Devices

Physical devices connect over Wi-Fi or cellular. The Station must be on the same
network or publicly reachable. No NAT translation is needed, but firewall rules
must permit the Station port.

## 7. Two-Device Acceptance Model

Two-actor evidence (friend requests, message delivery, group operations,
cross-device convergence) requires two independent automation sessions:

- **Simulator tier**: two iOS Simulators or one iOS Simulator + one Android
  Emulator, each with its own Appium server on a different port.
- **Physical tier**: two physical devices (as defined in `mobile-native.yaml`),
  each with its own Appium server, device lease, and actor identity.

Each session is isolated: separate `udid`, separate Appium port set
(`wda-local`/`system`, `mjpeg`, `webview`), separate storage root, separate
Station actor identity. The two sessions share the same Station but use
different PTID-scoped accounts.

## 8. Machine-Readable Definitions

| File | Tier | Content |
|---|---|---|
| `tooling/acceptance/environments/mobile-simulator.yaml` | Simulator | Build commands, Appium config, client definitions, harness contract, cleanup order |
| `tooling/acceptance/environments/mobile-native.yaml` | Physical | Service dependencies, fixtures, credentials, device leases, provider accounts, browser profiles |

These YAML files are the authoritative machine-readable definitions consumed by
the provisioner and gate runners. This document defines the contract they
implement; the YAML files define the concrete configuration.

## 9. References

- Acceptance matrix: `docs/architecture/mobile/acceptance-matrix.md`
- Architecture decisions: `docs/architecture/mobile/decisions.md`
- Gate runner internals: `tooling/acceptance/gates/mobile/README.md`
- Setup procedures: `docs/client/mobile/acceptance-setup.md`
- Service coordination: `docs/architecture/service-coordination.md`

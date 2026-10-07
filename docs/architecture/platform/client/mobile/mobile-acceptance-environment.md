# Mobile Acceptance Environment Contract

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-03 | **Updated**: 2026-09-21
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
| Build target | Tauri Desktop binary | Tauri iOS `.app`; Android artifacts are optional diagnostics |
| Runtime model | Single process with embedded WebView | Native app with platform WebView (WKWebView / Android WebView) |
| Driver | Embedded WebDriver (`tauri-driver`) | Appium 2 with XCUITest for required proof; Android drivers are optional diagnostics |
| Station connectivity | Host network, localhost or remote | iOS Simulator shares the host network; optional Android emulator uses NAT; physical device uses Wi-Fi/cellular |
| Native lifecycle | Window focus/close | `applicationDidEnterBackground`, `onPause`, deep links, push, permissions |
| Evidence collection | WebDriver screenshots + DOM + JS Harness | Native context screenshots + accessibility tree + WebView context JS Harness |
| WebView context | Direct (single context) | Context switching: `NATIVE_APP` and `WEBVIEW_*` |
| Typed Harness namespace | `window.__PEERS_DESKTOP_ACCEPTANCE__` | `window.__PEERS_MOBILE_ACCEPTANCE__` |

The implementations share evidence semantics, not the same driver executable.

## 3. Environment Tiers

### 3.1 Simulator Tier

Covers two isolated iOS Simulator clients. Defined in
`tooling/acceptance/environments/mobile-simulator.yaml`.

Properties:

- No profile or identity match required.
- Provisioner owns application build, install, and removal.
- Appium sessions use `noReset=true` and `fullReset=false`.
- Both iOS Simulator clients share the host network stack directly while
  retaining distinct devices, Appium sessions, ports, profiles, and storage.
- `sim-ios` uses the pinned primary device; `sim-ios-peer` uses a distinct
  pinned peer device. A required two-client Gate is `BLOCKED` if either client
  cannot be provisioned.
- No physical device lease, no provider credentials required.
- Proves the required Mobile runtime boundary: application
  build/install/launch, deterministic callback routing and finalization,
  lifecycle, restart, fail-closed behavior, WebView Harness availability,
  projection readback, layout, accessibility, platform bridges, and resource
  cleanup.
- Android Emulator and hardware-only behavior such as a live provider browser,
  physical Keychain/AndroidKeyStore characteristics, VoiceOver/TalkBack, OEM
  scheduler behavior, and real-device performance remain optional diagnostics.

### 3.2 iOS Layout Simulator Tier

W9-B uses the narrower
`tooling/acceptance/environments/mobile-ios-layout-simulator.yaml` contract.
It extends the base simulator build and Appium pins but provisions only:

- one iOS 26.5 `iPhone 17` as the current-device viewport;
- isolated Appium ports and storage for that cell.

The Gate captures portrait/landscape, keyboard open/closed, English/Chinese,
native accessibility-tree, WebView DOM, screenshot, source-identity, and
cleanup evidence. The environment has no Station, actor Fixture, provider
credential, Android runtime, or physical-device lease. A pass therefore proves
only the declared unauthenticated iPhone 17 Simulator launch surface; older
generations and alternate viewport sizes remain outside this Gate.

### 3.3 Station Lifecycle Simulator Tier

`tooling/acceptance/environments/mobile-station-lifecycle-simulator.yaml`
extends the base simulator build and driver pins with two source-attested,
disposable Stations. It does not require Relay or provider credentials.
Client-to-Station relationships are declared as typed bindings, and the
Provisioner retains Fixture and Appium authority while the Gate consumes only
the bound lifecycle operations.

The first `create_bound_session` call carries only the closed Mobile launch
options object. The parent Runtime Binding resolves every required service role
from the immutable Runtime Manifest, observes each Station identity through the
running client, persists one binding proof per role for the same launch
generation, and restores the primary role before returning. Later Station
changes use `select_binding(client_id, binding_role)` without allocating a new
launch generation or exposing a Station endpoint to the Gate.
Fixture account lookup, access-attempt creation, and credential submission also
remain in the parent handler; the child Gate receives only sanitized decision,
session, lifecycle, and proof projections.

This tier proves the simulator portions of valid-session restore,
same-device-type takeover and revocation recovery, Station switching, logout,
generation fencing, and old-scope absence. Destructive actor reset still
requires the exact inherited `station.reset:mobile-station-lifecycle-alice`
OS-held lease after both targets pass disposable-target verification. The
Provisioner revalidates that lease through the Local Dev control plane
immediately before setup and cleanup; no environment flag grants reset
authority.

### 3.4 Direct Simulator Tier

`tooling/acceptance/environments/mobile-direct-simulator.yaml` extends the
base simulator runtime with one source-attested disposable Station. `sim-ios`
authenticates as Alice and `sim-ios-peer` authenticates as Bob; both clients
bind their required `station` role to the same `services.station` entry.

This tier is the required environment for current two-actor Mobile product
proof. It preserves separate devices, Appium sessions, ports, profiles,
storage roots, actor identities, receiver observations, and cleanup while
proving same-Station Direct, recovery, Chat, Contacts, Group, and Moments
journeys. It does not acquire or attest a Relay and it cannot prove
cross-Station delivery.

### 3.5 Deferred Cross-Station Social Simulator Tier

`tooling/acceptance/environments/mobile-social-simulator.yaml` retains two
source-attested Stations plus Relay for future cross-Station evidence. It is
not part of `mobile-shell-20260827` required proof and its availability cannot
block that Plan. Any future use must have a separate accepted Desktop/Mobile
cross-Station plan and must remain `UNPROVEN` until that topology actually
runs.

### 3.6 Optional Physical Device Tier

Covers real iOS and Android devices. Defined in
`tooling/acceptance/environments/mobile-native.yaml`.

This tier is retained for optional diagnostics and never participates in
required Feature, Capability, Plan, Task, W8, or W9 completion.

Properties:

- Profile and identity match required.
- Physical device leases with fenced broker, heartbeat, and quarantine policy.
- Resources are selected by `mobile-native.yaml.scenarios`; each scenario
  receives only the clients, services, credentials, Fixtures, and ephemeral
  capabilities it declares.
- The access scenario requires GitHub and Google disposable accounts, four
  clients, two Stations, Relay, provider-browser leases, and the actor reset
  Fixture.
- The lifecycle and platform scenarios require one physical iOS client, one
  physical Android client, and the parent-owned Appium capability. They do not
  require OAuth credentials, provider-browser leases, Stations, Relay, or
  destructive actor reset.
- Build attestation with platform-specific signing evidence.
- Each Gate proves only its declared optional scenario. The physical tier can
  add real provider OAuth, physical
  Keychain/AndroidKeyStore, interaction performance on pinned hardware, browser
  return behavior, and cross-device convergence.

## 4. Gate-To-Environment Mapping

| Gate | Required simulator evidence | Optional physical diagnostics | Rationale |
|---|---|---|---|
| MS-AG01 Static/contracts | Yes (CI/local) | None | Compile-time checks only |
| MS-AG02 Lifecycle/isolation | Yes | Real OS lifecycle | Simulator owns required transitions and isolation |
| MS-AG03 OAuth security | Yes | Live GitHub/Google browser and secure hardware | Deterministic simulator callback/finalizer cells own required proof |
| MS-AG04 Unknown outcome | Yes | Radio/process interruption | The one-Station direct simulator owns deterministic response-loss and restart proof |
| MS-AG05 Resume/teardown | Yes | Physical secure-store and OS background behavior | Simulator lifecycle and injected secure-store failure own required proof |
| MS-AG06 Projection freshness | Yes | Real-radio latency | One source-attested Station and two isolated receiver clients own current proof; cross-Station/Relay is deferred |
| MS-AG07 Interaction performance | Yes | Pinned-hardware benchmark | Simulator threshold and attribution own required proof |
| MS-AG08 Layout | Yes | Real display | Simulator viewport, keyboard, and orientation matrix owns required proof |
| MS-AG09 Admission/overload | Yes | Real-device resource pressure | Deterministic simulator stress owns required proof |
| MS-AG10 Payload/storage | Yes | Physical filesystem inspection | Simulator boundary and restart recovery own required proof |
| MS-AG11 Accessibility/i18n | Yes | VoiceOver/TalkBack | Simulator AX trees, focus, locale, text-size, and motion own required proof |

Only the simulator column participates in required `PROVEN` judgment. See
`docs/architecture/platform/client/mobile/acceptance-matrix.md` for the complete mapping.

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

The Station must be reachable from the acceptance environment's network. The
required iOS Simulator cells use the host machine's network. Optional Android
Emulator diagnostics use the `10.0.2.2` NAT mapping. Physical devices must
reach the Station over Wi-Fi or the configured network.

## 6. Network Requirements

### 6.1 iOS Simulator

The iOS Simulator shares the host machine's network stack. HTTP connections to
local or remote Stations work without additional configuration, provided the
application's `Info.plist` includes `NSAllowsArbitraryLoads = true` under
`NSAppTransportSecurity` for debug/acceptance builds. Production builds must not
carry this exception.

### 6.2 Optional Android Emulator Diagnostics

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

- **Required simulator tier**: two isolated iOS Simulators, each with its own
  device, Appium session ports, profile, storage root, and runtime identity.
- **Optional physical access diagnostics**: four physical clients (Alice and
  Bob on iOS and Android, as defined in `mobile-native.yaml`), each with its own
  Appium session, device lease, and actor identity.
- **Optional physical lifecycle/platform diagnostics**: one iOS and one
  Android physical client, each with an isolated Appium session and
  broker-backed device lease.

Each session is isolated: separate `udid`, separate Appium port set
(`wda-local`, `mjpeg`, `webview`), separate storage root, separate runtime
identity, and explicit typed Station bindings. Current product journeys bind
Alice and Bob to the same Station through `mobile-direct-simulator`. Station
lifecycle and Settings journeys bind both iOS Simulator clients to Alice's
primary Station; the primary client also holds the separately proven secondary
binding used by Station-switch tests. The deferred Social environment binds
Alice and Bob to separate Stations and adds Relay, but is not current proof.

## 8. Machine-Readable Definitions

| File | Tier | Content |
|---|---|---|
| `tooling/acceptance/environments/mobile-simulator.yaml` | Simulator | Build commands, Appium config, client definitions, harness contract, cleanup order |
| `tooling/acceptance/environments/mobile-ios-layout-simulator.yaml` | Current iOS Simulator layout cell | iPhone 17 cell, layout Harness requirements, exact W9-B proof and non-proof scope |
| `tooling/acceptance/environments/mobile-station-lifecycle-simulator.yaml` | Station-bound simulator lifecycle and Settings | Base simulator resources plus two typed Station services, same-actor Fixture, lifecycle/Settings Harness actions, and reverse cleanup |
| `tooling/acceptance/environments/mobile-direct-simulator.yaml` | Required two-actor Station-backed evidence | Reuses the simulator build/runtime base and binds Alice and Bob to one source-attested disposable Station without Relay |
| `tooling/acceptance/environments/mobile-social-simulator.yaml` | Deferred cross-Station evidence | Retains two remote Station bindings plus Relay for a future Desktop/Mobile cross-Station plan |
| `tooling/acceptance/environments/mobile-native.yaml` | Optional physical diagnostics | Service dependencies, fixtures, credentials, device leases, provider accounts, browser profiles |

These YAML files are the authoritative machine-readable definitions consumed by
the provisioner and gate runners. This document defines the contract they
implement; the YAML files define the concrete configuration.

The shared `mobile-simulator` environment also runs
`mobile-simulator-runtime-lifecycle-e2e`. That Gate exercises the production
Mobile lifecycle kernel through typed Harness actions on the two isolated iOS
Simulator clients. It does not provision Station, actor, Relay, provider, or
physical-device resources, so its result cannot prove session revalidation,
Station switching, revocation, Android behavior, or physical OS lifecycle
delivery.

`mobile-simulator-station-lifecycle-e2e` adds only the two Station services and
same-actor Fixture required by AS-04 and AS-10. Relay remains outside this
environment because no federated Social delivery assertion is exercised.
`mobile-simulator-settings-e2e` reuses the same parent-owned Runtime Binding and
same-account Fixture to prove sequential second-simulator Profile/Notification
readback while keeping device preferences local to each simulator.

## 9. References

- Acceptance matrix: `docs/architecture/platform/client/mobile/acceptance-matrix.md`
- Architecture decisions: `docs/architecture/platform/client/mobile/decisions.md`
- Gate runner internals: `tooling/acceptance/gates/mobile/README.md`
- Setup procedures: `docs/client/mobile/acceptance-setup.md`
- Service coordination: `docs/architecture/platform/runtime/service-coordination.md`

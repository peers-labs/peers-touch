# Mobile Acceptance Environment

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-16
> **Owner**: Mobile Architecture Team

---

## 1. Scope

This document defines the runtime environments used to prove Mobile behavior.
It separates shared-source, Android, iOS, physical-device, and mixed-client
claims.

## 2. Evidence Identity

Every artifact binds:

```text
source revision
workspace digest
build artifact
release target
runtime mode
device/simulator identity
client role
Station/runtime identity
scenario and capability
cleanup result
```

Artifacts without this binding cannot prove a required cell.

## 3. Environment Classes

### 3.1 Shared source

Shared TypeScript, Rust, Proto, ownership, and contract checks prove portable
semantics. They do not prove Android or iOS host integration.

### 3.2 iOS Simulator

Current environment definitions include:

- `mobile-simulator.yaml`
- `mobile-ios-layout-simulator.yaml`
- `mobile-station-lifecycle-simulator.yaml`
- `mobile-direct-simulator.yaml`
- `mobile-social-ios-simulator.yaml`
- `mobile-social-simulator.yaml`
- `mobile-relay-simulator.yaml`

iOS Simulator cells can prove source-bound application build, WebView/product
behavior, deterministic callback routing, lifecycle transitions exposed by the
simulator, layout, and same/cross-actor flows.

They do not prove Android, physical secure hardware, real APNs delivery,
physical camera/media providers, radio behavior, or pinned-device
performance.

### 3.3 Android Emulator

Android Emulator is the required deterministic Android environment for
capabilities that do not depend on physical hardware or OEM behavior.

Android emulator Gates must use:

- an exact-source Android artifact;
- a distinct Appium/UiAutomator2 session;
- an isolated profile, storage root, ports, and client identity;
- Android-specific build and package attestation;
- deterministic cleanup.

The current general Mobile Gate catalog does not provide complete Android
emulator parity. Missing Gates are `UNPROVEN`, not optional.

### 3.4 Physical iOS

Physical iOS is required for claims that depend on:

- real APNs provider delivery and tap behavior;
- Keychain/Secure Enclave properties not modeled by Simulator;
- real background execution limits;
- camera/photo provider behavior;
- VoiceOver and device input behavior;
- pinned-hardware performance;
- radio/process interruption.

### 3.5 Physical Android

Current environment definitions include:

- `mobile-android-physical.yaml`
- `mobile-android-physical-runtime.yaml`
- Android clients in `mobile-native.yaml`

Physical Android is required for claims that depend on:

- real FCM provider delivery and notification tap behavior;
- Android Keystore and biometric hardware;
- OEM WorkManager/background restrictions;
- camera/photo providers and content grants;
- TalkBack and device input behavior;
- pinned-hardware performance;
- radio/process interruption.

`mobile-social-android-native` is an existing physical Android Social Gate. It
proves only its declared Social scope.

### 3.6 Mixed Client

Mixed-client environments prove cross-client behavior and remain platform
specific:

- Desktop + Android
- Desktop + iOS

Passing one pair does not prove the other.

## 4. Platform Matrix

| Claim | Android minimum | iOS minimum |
|---|---|---|
| Shared runtime semantics | shared source + Android integration build | shared source + iOS integration build |
| Lifecycle/restart | emulator; physical for OS process/background claim | Simulator; physical for OS process/background claim |
| Layout/keyboard/safe area | emulator/device viewport matrix | Simulator/device viewport matrix |
| Accessibility | physical TalkBack | physical VoiceOver |
| Secure storage | emulator for API flow; physical for hardware claim | Simulator for API flow; physical for hardware claim |
| OAuth deterministic callback | emulator | Simulator |
| OAuth live provider | physical Android | physical iOS |
| Push delivery/tap | physical FCM device | physical APNs device |
| Background wakeup | physical OEM/WorkManager device | physical BGTaskScheduler device |
| Media picker/camera | physical Android provider | physical iOS provider |
| Interaction performance | pinned physical device | pinned physical device |
| Social receiver convergence | isolated Android clients | isolated iOS clients |
| Audio/video calls | isolated physical Android clients | isolated physical iOS clients |

## 5. Multi-Client Isolation

A receiver-perspective or cross-device assertion requires independent:

- application installations;
- driver sessions;
- storage roots;
- runtime identities;
- device identities;
- actor/session scopes;
- ports and profiles.

Sequential actor switching on one physical device may prove an explicitly
declared sequential scenario. It does not prove concurrent delivery, dual
ring, or simultaneous receiver state.

## 6. Network Model

### iOS Simulator

iOS Simulator shares the host network. The environment must still bind the
exact Station origin and signed Station identity.

### Android Emulator

Android Emulator uses a virtualized network. Host routing must use the
environment's declared host alias or forwarded endpoint, not assume device
`localhost` reaches the host.

### Physical devices

Physical devices use declared Wi-Fi/cellular routing and require:

- reachable source-attested Station endpoints;
- TLS and Station identity verification;
- explicit device lease;
- provider/browser account lease where applicable;
- cleanup of sessions, profiles, app data, and temporary grants.

Relay use is explicit. Same-Station evidence cannot be relabeled as
cross-Station or Relay evidence.

## 7. Current Gate Facts

- `mobile-native-build` currently describes an iOS Simulator build. It is not a
  generic Android+iOS build Gate.
- `mobile-social-ios-native` proves its declared iOS Social scope.
- `mobile-social-android-native` proves its declared physical Android Social
  scope.
- General Mobile Shell Gates are predominantly iOS Simulator based.
- Required Android parity outside registered Android Gates remains
  `UNPROVEN`.
- Provider, background, accessibility, media, and performance claims remain
  `UNPROVEN` without the required physical cells.

## 8. Harness Boundary

The Acceptance Harness may:

- invoke bounded production actions;
- deliver typed OS callback inputs through the owning test adapter;
- read sanitized runtime projections;
- collect build/runtime identity and evidence;
- request deterministic cleanup.

It may not:

- mutate product stores directly;
- inject successful business outcomes;
- bypass Station authorization;
- expose credentials or provider tokens;
- relabel one release target as another;
- reuse stale artifacts.

## 9. Completion Rule

A capability is `PROVEN` only when:

1. every declared Android and iOS cell has current evidence;
2. each artifact matches the selected source revision;
3. durable claims include owner readback;
4. receiver claims include receiver-side evidence;
5. required physical behavior ran on physical hardware;
6. cleanup returns owned resources to baseline.

Otherwise the capability remains `UNPROVEN` or `FAILED`.

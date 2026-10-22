# Mobile Shell - Integration

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-08-27 | **Updated**: 2026-10-17
> **Owner**: Mobile Architecture Team

---

## 1. Integration Map

```text
Mobile presentation
  -> lifecycle/navigation/runtime projections
  -> typed gateways and platform services
  -> Mobile Rust runtime
       -> portable Rust cores
       -> Station transport and generated Model contracts
       -> typed Android/iOS plugins
```

Cross-client composition is governed by
[Cross-Client Runtime](../cross-client-runtime/README.md).

## 2. Current Source Facts

### Shared Mobile runtime

- `apps/mobile/src/` is the shared Mobile presentation/runtime tree.
- `apps/mobile/src-tauri/src/` is the shared Mobile Rust runtime.
- Desktop and Mobile both consume `messaging-core`,
  `secure-content-core`, `station-libp2p-http`, and `station-trust`.
- Generated TypeScript contracts exist under `apps/mobile/src/gen/proto/`.
- Android and iOS host projects exist under `src-tauri/gen/`.

### Native plugins

Current plugin source:

- `platform-permissions`: Android and iOS permission, capability observation,
  typed system action, push callback, background scheduling, and media-picker
  adapters;
- `secure-input`: Android and iOS adapters;
- `secure-storage`: Android adapter only.

The combined `platform-permissions` plugin provides native adapter source, but
provider/service configuration, killed-process behavior, host registration,
and source-bound runtime proof remain separate completion requirements.

### Platform selection

The shared Rust runtime derives `android` or `ios` from the compile target and
exposes it through `mobile_health`. The TypeScript platform port reads that
native diagnostic; it does not infer the target from user agent, media query,
environment variable, or a static iOS label. Embedded Acceptance build identity
is rejected when its platform differs from the compiled target.

The shared contract is located at:

- Rust: `apps/mobile/src-tauri/src/platform/ios.rs` (the retained generated-host
  source path now contains the target-neutral contract)
- TypeScript:
  `apps/mobile/src/services/platform/platformContracts.ts`

It freezes release target, runtime port, capability fact, admission projection,
and system-action shapes. UCA-02 and UCA-03 bind those contracts to Kotlin and
Swift. Their runtime claims remain fail-closed until physical Host evidence is
current.

### Provider and host configuration

- The iOS target declares `aps-environment`, `fetch`, and
  `remote-notification`; source and unsigned Simulator compilation do not prove
  signed entitlement delivery or APNs provider callbacks.
- No `GoogleService-Info.plist` or `google-services.json` is present in the
  generated hosts.
- Android has a `FirebaseMessagingService`, token/receipt/tap normalization,
  and explicit provider-unavailable state, but no real FCM application
  configuration.
- Android `ReconcileWorker` writes a durable wake marker. The next
  current-generation Host activation materializes it for Rust reconciliation;
  the Worker does not depend on Activity or plugin instance.
- iOS normalizes APNs token success/failure, foreground receipt, tap, and
  remote-notification background callbacks. Provider credentials and signed
  physical-device proof remain absent.

Physical Host Suite configuration is resolved by the parent Provisioner before
resource acquisition. Set `PT_ANDROID_FCM_PROVIDER_CONFIG` or
`PT_IOS_APNS_PROVIDER_CONFIG` to an absolute private JSON file (owner access
only; no symlink components). Referenced provider private-key files follow the
same policy. No real credential file belongs in the repository.

The Android JSON has exactly `schemaVersion: 1`,
`applicationId: "com.peers.touch.mobile"`, `googleServices` and `serviceAccount`.
The latter two values are absolute paths to the Firebase Android application
configuration and service-account JSON. Their project IDs must agree, the
application must match the bundle ID, and the account must carry a valid RSA
private key. Validated application resources enter the controlled Gradle
environment and its digest; provider signing credentials remain parent-only.

The iOS JSON has exactly `schemaVersion: 1`,
`applicationId: "com.peers.touch.mobile"`, `teamId`, `keyId`,
`environment: "development"` and `privateKey`. Team and key IDs are ten
uppercase alphanumeric characters; `privateKey` references the private APNs
P-256 key. The actual signed application team, signature/profile APNs
environment and background modes are checked during the controlled build.
Configuration admission does not prove registration or delivery; those remain
physical runtime obligations.

These are implementation gaps, not degraded success states.

## 3. Capability Status

| Capability | Shared contract/runtime | Android host | iOS host | Readiness |
|---|---|---|---|---|
| Platform identification | compile-target Rust identity plus native TypeScript diagnostic | source-complete | source-complete | Host runtime proof remains `UNPROVEN` |
| Platform permission facts | typed plugin contract | source present | source present | runtime evidence required per OS |
| Secure input | typed plugin contract | source present | source present | runtime evidence required per OS |
| Secure storage | Rust contract | native plugin source present | Rust Keychain source present | physical secure-storage evidence required per OS |
| Push registration/delivery | architecture/model contracts and native callback adapters | FCM service source complete; provider config absent | APNs success/failure/background source and entitlement complete; provider/runtime proof absent | Android/iOS `UNPROVEN` |
| Background wakeup | Rust/native contracts and scheduler adapters | durable WorkManager handoff source complete | BGTask registration/expiration/reschedule source complete | Android/iOS physical evidence `UNPROVEN` |
| Media picker/staging | Rust staging and native picker source | full-resolution camera/picker stream source complete | full-resolution picker/camera source present | Android/iOS runtime evidence `UNPROVEN` |
| System action/capability fact | shared Rust/TypeScript typed contracts | Kotlin adapter source complete | Swift adapter source complete | physical evidence `UNPROVEN` |
| OAuth deterministic callback | Rust/Station contracts | Gate missing | simulator Gate exists | Android `UNPROVEN` |
| Whole-product usability | shared surface inventory | Gate missing | simulator Gate exists | whole-Mobile `UNPROVEN` |
| Social native parity | shared product/runtime contract | physical Gate registered | iOS simulator Gate registered | verdict follows latest source-bound results |

## 4. Model and Station Integration

- Shared domain semantics come from `model/domain/`.
- Mobile-local view state does not become a parallel contract.
- Station confirms shared business outcomes.
- Unknown writes use typed command identity and owner readback.
- Station, PTID, device, credential, and lifecycle generation scope every
  durable Mobile operation.

## 5. Portable Core Integration

Mobile Rust composes portable cores through Cargo dependencies.

Every core integration requires:

- semantic owner;
- explicit port bindings;
- local-store schema/migration owner;
- Model contract inputs;
- Station interaction boundary;
- Android and iOS host evidence where behavior reaches the host.

Core unit tests do not prove WebView, Tauri command, plugin, permission,
packaging, or provider behavior.

## 6. Native Capability Integration

Canonical flow:

```text
OS API/callback
  -> native plugin adapter
  -> typed Rust boundary
  -> capability fact or operation result
  -> runtime admission/reconciliation
  -> presentation projection
```

Required properties:

- target-aware plugin registration;
- typed request/result/error/event;
- lifecycle generation and request identity;
- cancellation, timeout, late-callback, and duplicate behavior;
- no secrets or native paths in Web state;
- cleanup to resource baseline;
- independent Android/iOS proof.

## 7. Reliability Integration

Device-local ledgers and drafts remain client-local authority. They:

- preserve exact Station/PTID/device scope;
- use bounded admission;
- retain unknown outcomes;
- never auto-replay non-idempotent writes without owner semantics;
- reconcile through Station readback;
- are fenced and cleared/quarantined on scope change according to owner policy.

## 8. Acceptance Integration

Current Gate facts:

- `mobile-native-build` builds the iOS Simulator application; its generic name
  does not prove Android.
- most Mobile Shell runtime Gates use iOS Simulator environments;
- `mobile-social-android-native` is a physical Android Social Gate;
- `mobile-social-ios-native` is an iOS Social Gate.
- unified-client Android/iOS, Messaging, Secure Content, owner-zero and shared
  semantics Gate identities are registered fail-closed; only the final
  aggregate implementation exists at UCA-01.

Required next architecture closures:

1. provision dedicated source-bound Android/iOS physical Host Suites and then
   replace the fail-closed Gate catalog entries;
2. bind real FCM/APNs provider configuration and signed identities to those
   Suites without committing credentials;
3. prove build, install, launch, callback, denial, background, media,
   system-action, receiver-visible, and cleanup cells;
4. run whole-product and capability matrices on Android and iOS;
5. keep all missing cells `UNPROVEN`.

## 9. Hard-Cut Rule

When capability ownership changes:

- one active producer;
- one runtime owner;
- one projection/readback path;
- no dual write or fallback alias;
- old executable path deleted in the same change;
- external persisted/wire compatibility handled through explicit migrations.

Git carries obsolete architecture descriptions. Active documents describe only
the current contract and current gaps.

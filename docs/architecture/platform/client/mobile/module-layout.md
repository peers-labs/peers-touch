# Mobile Shell - Module Layout

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-08-27 | **Updated**: 2026-10-16
> **Owner**: Mobile Architecture Team

---

## 1. Current Source Layout

```text
apps/mobile/
├── src/
│   ├── acceptance/
│   ├── app/
│   │   ├── layout/
│   │   ├── lifecycle/
│   │   └── navigation/
│   ├── components/
│   ├── contracts/
│   ├── features/
│   │   ├── auth/
│   │   ├── call/
│   │   ├── chat/
│   │   ├── social/
│   │   └── station/
│   ├── gen/proto/
│   ├── pages/
│   ├── runtimes/
│   ├── services/
│   │   ├── gateways/
│   │   └── platform/
│   └── storage/
└── src-tauri/
    ├── src/
    │   ├── commands/
    │   ├── domain/
    │   ├── messaging/
    │   ├── platform/
    │   ├── runtime/
    │   ├── secure_content/
    │   └── social/
    ├── plugins/
    │   ├── platform-permissions/
    │   ├── secure-input/
    │   └── secure-storage/
    └── gen/
        ├── android/
        └── apple/
```

This tree is descriptive. A directory name does not prove complete capability
or runtime support.

## 2. Presentation Ownership

| Path | Owns | Must not own |
|---|---|---|
| `src/app/lifecycle/` | visible lifecycle projection and intent dispatch | Station policy or native callback processing |
| `src/app/navigation/` | route identity, stack/tab/overlay state, focus restoration | business entity identity as route truth |
| `src/components/` | reusable Mobile presentation | business freshness |
| `src/pages/` | page composition and user intent | streams, polling, retry owner, durable state |
| `src/features/*/` | feature-local presentation state and adapters | parallel shared domain models |
| `src/runtimes/` | session-scoped freshness, reconciliation, admission, teardown | page-lifetime ownership |
| `src/services/gateways/` | typed boundary into Rust/Station contracts | Web-owned secrets or manual domain DTOs |
| `src/services/platform/` | typed capability intents and projections | Android/iOS SDK access |
| `src/storage/` | explicitly device-local UI/runtime state | shared business truth |

## 3. Rust Runtime Ownership

| Path | Owns | Must not own |
|---|---|---|
| `src-tauri/src/commands/` | bounded Tauri command surface | domain policy hidden in command wrappers |
| `src-tauri/src/domain/` | Mobile-local runtime semantics | Model-owned cross-device contract twins |
| `src-tauri/src/runtime/` | lifecycle-safe orchestration, reliability, OAuth, local stores | product presentation |
| `src-tauri/src/messaging/` | Mobile composition of Messaging Platform contracts and cores | separate Chat authority |
| `src-tauri/src/secure_content/` | Mobile adapter for secure-content mechanisms | Social/Conversation business policy |
| `src-tauri/src/social/` | Mobile Social transport/projection adapters | Station Social truth |
| `src-tauri/src/platform/` | typed host facts and port composition | raw UI navigation or business mutation |

Portable libraries such as `messaging-core` and `secure-content-core` are
embedded through Cargo dependencies. Their reusable mechanism code stays under
`packages/`; host composition stays in `src-tauri/`.

## 4. Native Plugin Ownership

| Path | Current source fact | Evidence implication |
|---|---|---|
| `plugins/platform-permissions/` | Rust wrapper with Android/iOS permission, push callback, background scheduling, and media-picker adapters | provider/configuration, killed-process behavior, and each capability still need separate Android/iOS runtime proof |
| `plugins/secure-input/` | Rust wrapper with Android and iOS adapters | input behavior still needs separate Android/iOS runtime proof |
| `plugins/secure-storage/` | Rust wrapper with Android adapter only | iOS uses the Rust Keychain path; both integrations require independent native evidence |

The combined `platform-permissions` plugin is the current native adapter
location for several capabilities. A source file inside that plugin does not
prove provider configuration, host registration, killed-process behavior, or
runtime readiness.

## 5. Platform Hosts

| Path | Role |
|---|---|
| `src-tauri/gen/android/` | Android build, packaging, manifest, resources, native host |
| `src-tauri/gen/apple/` | iOS build, packaging, entitlements, resources, native host |

Generated host projects are active release inputs. Required host configuration
must be source-controlled or reproducibly generated and verified by a
source-bound build.

## 6. Dependency Direction

```text
page/component
  -> feature action
  -> owning runtime
  -> typed gateway/platform service
  -> Mobile Rust command/runtime
  -> portable core or typed native plugin
  -> Station / OS
```

Forbidden:

- page/component -> native plugin;
- native plugin -> product store;
- Web state -> provider token or native path;
- Android/iOS host -> separate Mobile feature state model;
- portable core -> Tauri application state;
- runtime -> manual contract duplicating `model/domain/`.

## 7. Capability Admission

```text
native adapter
  -> CapabilityFact
  -> Rust/runtime policy
  -> AdmissionProjection
  -> page/component
```

Presentation does not infer availability from platform name, plugin presence,
permission strings, or compile-time flags.

## 8. Acceptance Layout

Mobile evidence is organized by release target:

```text
shared source Gates
Android native Gates
  emulator cells
  physical-device cells where required
iOS native Gates
  simulator cells
  physical-device cells where required
mixed-client Gates
  Desktop + Android
  Desktop + iOS
```

Every Gate binds the source revision, build artifact, runtime identity, release
target, client role, owner readback, visible evidence, and cleanup result.
Missing required Android or iOS cells are `UNPROVEN`.

## 9. Related Sources

- [Cross-Client Runtime](../cross-client-runtime/README.md)
- [Mobile Design](./design.md)
- [Mobile Data Model](./data-model.md)
- [Mobile Integration](./integration.md)
- [Mobile Acceptance Matrix](./acceptance-matrix.md)
- [Native Plugin Layer](../../../../client/mobile/native-plugin-layer.md)

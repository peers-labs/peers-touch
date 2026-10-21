# Peers Touch Mobile

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-16
> **Owner**: Mobile Architecture Team

---

## 1. Scope

This document defines the Mobile platform baseline and implementation
boundaries.

Upstream client-form, release-target, portable-core, host, and port semantics
are defined by
[Cross-Client Runtime](../../architecture/platform/client/cross-client-runtime/README.md).

Detailed Mobile product and runtime architecture is defined by
[Mobile Shell](../../architecture/platform/client/mobile/README.md).

## 2. Product and Release Model

Mobile is one product with two release targets:

- Android
- iOS

Android and iOS share:

- one product state model;
- one React/TypeScript presentation tree;
- one Rust runtime composition;
- one lifecycle and navigation contract;
- one capability/admission model.

They retain separate:

- OS hosts;
- native plugin implementations;
- build, packaging, signing, and provider configuration;
- source-bound native evidence.

## 3. Runtime Composition

```text
Mobile presentation
  apps/mobile/src/
        |
        | typed actions and projections
        v
Mobile Rust runtime
  apps/mobile/src-tauri/src/
        |
        +-> embedded portable Rust cores
        |
        +-> typed native capability plugins
              |
              +-> Android Kotlin adapters
              +-> iOS Swift adapters
        |
        +-> Station APIs and generated Model contracts
```

### 3.1 Mobile presentation

`apps/mobile/src/` owns:

- mobile navigation and visible state;
- touch, safe-area, keyboard, and responsive layout policy;
- rendering runtime and admission projections;
- user intent dispatch.

It does not call Android/iOS SDKs directly or own long-lived business
freshness.

### 3.2 Mobile Rust runtime

`apps/mobile/src-tauri/src/` owns:

- lifecycle-safe capability orchestration;
- Tauri commands and event boundaries;
- secure local state and command/draft ledgers;
- portable-core composition;
- Station transport and trust integration;
- capability fact normalization;
- native plugin registration and callback fencing.

It does not replace Station as shared business authority.

### 3.3 Native plugin layer

`apps/mobile/src-tauri/plugins/` owns typed OS capability adapters. Kotlin and
Swift implementations may access permissions, secure storage, deep links,
notifications, media, background execution, and other native APIs.

Plugins do not own:

- Station policy;
- product navigation;
- business retry or reconciliation;
- Mobile feature stores;
- parallel domain DTOs.

See [Native Plugin Layer](./native-plugin-layer.md).

### 3.4 Portable Rust cores

Mobile embeds host-neutral Rust libraries such as `messaging-core` and
`secure-content-core`. Each library is an in-process mechanism with its own
local instance and store.

A portable core is not a service or shared business authority. Cross-device
state converges through Station.

## 4. Repository Layout

```text
apps/mobile/
├── src/                          # shared Mobile presentation/runtime
└── src-tauri/
    ├── src/                      # shared Mobile Rust runtime
    ├── plugins/                  # typed native capability plugins
    └── gen/
        ├── android/              # Android host project
        └── apple/                # iOS host project
```

## 5. Authority Boundaries

- Shared contract truth: `model/domain/`
- Shared business truth: `apps/station/`
- Portable local mechanism state: owning Rust core
- Mobile local orchestration and projection: Mobile runtime
- OS capability observation: Android/iOS host adapter
- Mobile interaction and layout: Mobile presentation policy

Durable local state does not become shared business truth.

## 6. Capability Flow

```text
OS capability
  -> native plugin
  -> Mobile Rust CapabilityFact
  -> runtime policy
  -> AdmissionProjection
  -> Mobile presentation
```

Unknown, unsupported, denied, restricted, and unavailable capability states
remain explicit. The UI does not infer product eligibility from raw plugin or
permission values.

## 7. Lifecycle

The top-level Mobile lifecycle is:

```text
app boot
  -> Station selection and signed identity handshake
  -> Station-owned access gate chain
  -> admitted session
  -> critical runtime bootstrap
  -> shell
  -> foreground event/reconcile
  -> background suspension
  -> resume revalidation/reconcile
```

Pages render runtime projections. Runtimes own long-lived freshness and
reconciliation.

See [Mobile Lifecycle](./lifecycle.md).

## 8. Verification

`pnpm mobile:check` is the shared source gate.

Product or architecture support claims are release-target specific:

- Android claims require Android native build/runtime evidence.
- iOS claims require iOS native build/runtime evidence.
- One target never proves the other.
- Shared Rust and TypeScript tests prove portable semantics only.
- Missing required evidence is `UNPROVEN`.

The required capability-by-platform matrix is defined in
[Mobile Acceptance Matrix](../../architecture/platform/client/mobile/acceptance-matrix.md).

## 9. Related Sources

- [Cross-Client Runtime](../../architecture/platform/client/cross-client-runtime/README.md)
- [Mobile Shell](../../architecture/platform/client/mobile/README.md)
- [Native Plugin Layer](./native-plugin-layer.md)
- [Mobile Lifecycle](./lifecycle.md)
- [Sync Protocol](./sync-protocol.md)
- [Applet Container](./applet-container.md)
- [Mobile Coding Guide](../../global/coding-guide/mobile/)

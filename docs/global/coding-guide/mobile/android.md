# Android Host and Plugin Coding Guide

> **Status**: active
> **Updated**: 2026-10-16
> **Scope**: Tauri Android host and Kotlin/Java native capability adapters

---

## 1. Source Roots

```text
apps/mobile/src-tauri/
├── gen/android/                  # Android host, manifest, Gradle, resources
└── plugins/*/android/            # Kotlin/Java capability adapters
```

Android is a release target of one Mobile product. Product UI, navigation,
feature state, and business projections remain in shared Mobile source.

## 2. Ownership

Android code may own:

- Android permission checks and requests;
- Activity/Intent/lifecycle callbacks;
- Keystore, biometric, notification, media, and background OS adapters;
- callback normalization into typed plugin results;
- Android packaging, manifest, resources, and provider configuration.

Android code must not own:

- Station policy or authorization;
- a separate Android feature store;
- business retry or reconciliation;
- shared domain DTO definitions;
- product navigation;
- direct mutation of Web/runtime stores.

## 3. Plugin Structure

A Mobile plugin keeps:

```text
plugins/<capability>/
├── Cargo.toml
├── src/lib.rs
├── android/
│   ├── build.gradle.kts
│   └── src/main/java/.../<Capability>Plugin.kt
├── permissions/
└── build.rs
```

Plugin APIs are capability-specific and typed. Generic JSON tunnels, arbitrary
command dispatch, and global host escape handles are forbidden.

## 4. Command Rules

- Parse typed arguments at the plugin boundary.
- Validate request ID, lifecycle generation, scope, and deadline in Rust.
- Return a typed terminal result or typed error.
- Resolve an invocation exactly once.
- Discard and clean up late or duplicate callbacks.
- Keep blocking I/O and expensive work off the Android main thread.
- Do not keep business-critical completion state only in an `Activity` or
  plugin singleton.

## 5. Lifecycle and Background Work

- Activity recreation and process death are normal.
- Persistent work stores enough typed input to resume without an in-memory
  plugin instance.
- WorkManager workers call a process-safe Rust/host entry or durable queue.
- Worker completion is acknowledged exactly once.
- Logout, Station change, actor change, permission revocation, and app upgrade
  have explicit cleanup behavior.
- Native callbacks are fenced before entering the active Mobile generation.

An in-memory `activeInstance` may assist foreground routing but cannot be the
only owner of killed-process background execution.

## 6. Permissions

- Declare only required permissions.
- Separate `notDetermined`, `granted`, `denied`, `restricted`, `unsupported`,
  and `unknown`.
- Permission state becomes a `CapabilityFact`; Kotlin does not decide product
  admission.
- A denied permission is a visible typed result, not empty success.
- Never request permission before the user action that requires it unless the
  product contract explicitly requires onboarding.

## 7. Sensitive Data

- Use Android Keystore-backed storage for protected key material.
- Never expose tokens, raw native paths, content URIs, or provider credentials
  to Web state.
- Copy provider-owned media into Rust-owned scoped staging before durable use.
- Redact secrets and PII from logs and Acceptance evidence.
- Do not use direct `Log.*` in production paths; use the project logging
  boundary.

## 8. Provider Integration

FCM, deep links, background work, media, and biometric support each require:

- source-controlled adapter code;
- manifest/Gradle/provider configuration;
- target-aware plugin registration;
- rotation/revocation and cleanup;
- source-bound Android build;
- emulator and physical-device evidence according to the capability.

Source or contracts on iOS do not prove Android.

## 9. Verification

Shared checks:

```bash
pnpm mobile:check
```

Android support additionally requires a registered Android build/runtime Gate
bound to the exact source and artifact. Physical evidence is required for real
FCM delivery, Keystore hardware claims, OEM background behavior, media
providers, TalkBack, and pinned-device performance.

Missing Android evidence is `UNPROVEN`.

## 10. Related Sources

- `docs/client/mobile/base.md`
- `docs/client/mobile/native-plugin-layer.md`
- `docs/architecture/platform/client/cross-client-runtime/`
- `docs/architecture/platform/client/mobile/acceptance-matrix.md`

# iOS Host and Plugin Coding Guide

> **Status**: active
> **Updated**: 2026-10-16
> **Scope**: Tauri iOS host and Swift native capability adapters

---

## 1. Source Roots

```text
apps/mobile/src-tauri/
├── gen/apple/                    # iOS host, Xcode project, plist, entitlements
└── plugins/*/ios/                # Swift capability adapters
```

iOS is a release target of one Mobile product. Product UI, navigation, feature
state, and business projections remain in shared Mobile source.

## 2. Ownership

iOS code may own:

- iOS permission checks and requests;
- app/scene/deep-link lifecycle callbacks;
- Keychain, LocalAuthentication, notification, media, and background adapters;
- callback normalization into typed plugin results;
- iOS packaging, entitlements, resources, and provider configuration.

iOS code must not own:

- Station policy or authorization;
- a separate iOS feature store;
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
├── ios/
│   ├── Package.swift
│   └── Sources/<Capability>Plugin.swift
├── permissions/
└── build.rs
```

Plugin APIs are capability-specific and typed. Generic dictionaries may be
used only at the Tauri serialization edge and must decode immediately into a
defined request/result shape.

## 4. Command and Callback Rules

- Decode typed arguments at the boundary.
- Validate request ID, lifecycle generation, scope, and deadline in Rust.
- Resolve an invocation exactly once.
- Return explicit cancellation, denial, restriction, timeout, unsupported, and
  failure states.
- Discard and clean up late or duplicate callbacks.
- Keep blocking I/O and expensive work off the main actor.
- Do not keep business-critical state only in a plugin instance or scene.

## 5. Lifecycle and Background Work

- Scene recreation, suspension, and process termination are normal.
- BGTaskScheduler inputs and completion state must survive without a live
  WebView or plugin instance.
- Background identifiers, permitted task configuration, registration, and
  scheduling must match.
- Every launched background task completes exactly once before expiration.
- Logout, Station change, actor change, permission revocation, and app upgrade
  have explicit cleanup behavior.
- Native callbacks are fenced before entering the active Mobile generation.

## 6. Permissions and Entitlements

- Declare only required usage descriptions and entitlements.
- Keep `notDetermined`, `authorized`, `denied`, `restricted`, `unsupported`,
  and `unknown` distinct.
- Permission/entitlement state becomes a `CapabilityFact`; Swift does not
  decide product admission.
- Empty entitlements mean entitlement-dependent capability is unavailable or
  `UNPROVEN`.
- Plist keys without registered runtime behavior do not prove a capability.

## 7. Sensitive Data

- Use Keychain access classes appropriate to the capability.
- Never expose tokens, provider credentials, raw callback secrets, file URLs,
  or security-scoped bookmarks to Web state.
- Move selected media into Rust-owned scoped staging before durable use.
- Redact secrets and PII from logs and Acceptance evidence.
- Use the project logging boundary, not ad hoc `print`.

## 8. Provider Integration

APNs, universal links, background tasks, media, and biometric support each
require:

- source-controlled Swift adapter code;
- entitlement/plist/provider configuration;
- target-aware plugin registration;
- rotation/revocation and cleanup;
- source-bound iOS build;
- Simulator and physical-device evidence according to the capability.

Source or contracts on Android do not prove iOS.

## 9. Verification

Shared checks:

```bash
pnpm mobile:check
```

iOS support additionally requires a registered iOS build/runtime Gate bound to
the exact source and artifact. Physical evidence is required for real APNs
delivery, secure-hardware claims, BGTaskScheduler behavior, media providers,
VoiceOver, and pinned-device performance.

Missing iOS evidence is `UNPROVEN`.

## 10. Related Sources

- `docs/client/mobile/base.md`
- `docs/client/mobile/native-plugin-layer.md`
- `docs/architecture/platform/client/cross-client-runtime/`
- `docs/architecture/platform/client/mobile/acceptance-matrix.md`

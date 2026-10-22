# Cross-Client Runtime Architecture - Reference Analysis

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-16 | **Updated**: 2026-10-16
> **Owner**: Client Platform Team
> **Role**: external evidence input, not Peers Touch design authority

---

## 1. Method

This analysis uses first-party project documentation and repositories. It
extracts architecture patterns; it does not copy another product's ownership
model into Peers Touch.

Sources were checked on 2026-10-16.

## 2. Matrix / Element X

First-party sources:

- [Element X Android](https://github.com/element-hq/element-x-android)
- [Element X iOS](https://github.com/element-hq/element-x-ios)
- [Matrix Rust SDK](https://github.com/matrix-org/matrix-rust-sdk)
- [Matrix SDK FFI](https://matrix-org.github.io/matrix-rust-sdk/matrix_sdk_ffi/)

Observed pattern:

- Android and iOS are separate native applications.
- Both consume Matrix Rust SDK through an FFI layer.
- Android uses Jetpack Compose; iOS uses SwiftUI.
- Shared protocol/client semantics do not require a shared presentation
  implementation.

Relevant lesson:

Portable protocol and state logic can be shared while each OS host retains its
own presentation and lifecycle. Shared core and shared UI are separate
decisions.

## 3. Signal

First-party sources:

- [libsignal](https://github.com/signalapp/libsignal)
- [Signal Android](https://github.com/signalapp/Signal-Android)
- [Signal iOS](https://github.com/signalapp/Signal-iOS)
- [Signal Desktop](https://github.com/signalapp/Signal-Desktop)

Observed pattern:

- `libsignal` implements platform-agnostic APIs in Rust.
- Official clients consume language-specific Java, Swift, and TypeScript
  libraries around the Rust implementation.
- Android, iOS, and Desktop remain separate products and release artifacts.
- The shared library concentrates protocol, cryptography, transfer, key, and
  related security mechanisms.

Relevant lesson:

Security-critical semantics belong in a narrow portable core with explicit
language boundaries. The core does not replace client product shells or the
server authority.

## 4. Mozilla Application Services

First-party sources:

- [Application Services Rust Components](https://mozilla.github.io/application-services/book/)
- [Application Services repository](https://github.com/mozilla/application-services)

Observed pattern:

- Shared Rust components provide Firefox account, sync, and experimentation
  capabilities.
- Components are wrapped with native language bindings for different
  platforms.
- The unit of reuse is a component with a bounded contract, not one universal
  client application.

Relevant lesson:

Portable cores should be capability-oriented and independently ownable.
Bindings and host adapters remain explicit platform integration work.

## 5. 1Password

First-party source:

- [1Password 8: The Story So Far](https://blog.1password.com/1password-8-the-story-so-far/)

Observed pattern:

- 1Password consolidated non-UI client behavior into a shared Rust Core.
- The Core covers server communication, database handling, permission
  enforcement, cryptography, search, and view-model-relevant semantics.
- Frontends remain platform-conscious and may use different UI technologies.
- Product teams coordinate shared Core and platform presentation together.

Relevant lesson:

Shared logic improves semantic consistency, but presentation policy remains a
first-class product layer. A core can inform views without becoming the UI.

## 6. Bitwarden

First-party sources:

- [Bitwarden internal SDK](https://github.com/bitwarden/sdk-internal)
- [Bitwarden SDK architecture](https://contributing.bitwarden.com/architecture/sdk/)

Observed pattern:

- The Rust SDK centralizes internal business and cryptographic logic.
- Swift and Kotlin mobile bindings are generated through UniFFI.
- Web clients use WASM bindings.
- Client and SDK changes require source-bound integration builds and explicit
  coordination for breaking changes.
- Generated server API bindings are kept distinct from stable SDK models.

Relevant lesson:

Cross-client reuse needs a disciplined integration and release contract.
Portable semantics, generated server bindings, and client-facing models are
different boundaries and should not collapse into one type layer.

## 7. Tauri

First-party sources:

- [Tauri process model](https://v2.tauri.app/concept/process-model/)
- [Tauri mobile plugin development](https://v2.tauri.app/develop/plugins/develop-mobile/)

Observed pattern:

- Tauri separates a Rust core process from WebView presentation.
- The core process mediates OS access and IPC.
- Mobile plugins use Kotlin/Java on Android and Swift on iOS.
- Shared Rust plugin logic and OS-native implementations can coexist behind
  one plugin API.
- Lifecycle, permissions, commands, and events are explicit plugin concerns.

Relevant lesson:

Tauri supplies host and plugin mechanisms, not Peers Touch business ownership.
Plugins should remain typed capability adapters, and long-running native work
must respect host-thread constraints.

## 8. Synthesis

The references converge on five patterns:

1. Rust is used to centralize difficult semantics, not to erase platform
   boundaries.
2. Native hosts and release pipelines remain distinct even when they consume
   one core.
3. Presentation policy is allowed to differ from portable runtime semantics.
4. Bindings, ports, and generated API contracts require explicit ownership.
5. Cross-platform claims require integration proof in every shipping target.

Peers Touch differs in one important way: Android and iOS intentionally share
one Tauri Mobile presentation/runtime tree. Therefore the correct model is not
"copy Element X native UI" or "copy Signal client repositories." The applicable
pattern is the narrower one: embedded portable Rust mechanisms, explicit host
ports, platform-specific release proof, and one product authority model.

## 9. Rejected Inferences

The external evidence does not justify:

- moving all client behavior into Rust;
- treating a shared core as a server or process;
- giving local core state cross-device business authority;
- making Android and iOS separate Peers Touch product models;
- assuming one OS integration proves another;
- exposing a generic FFI/plugin bridge instead of typed capability ports;
- selecting UniFFI when direct Rust composition through Tauri already provides
  the required boundary.

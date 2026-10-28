# Mobile Native Plugin Layer

> **Status**: active
> **Version**: v1.0
> **Updated**: 2026-10-16
> **Owner**: Mobile Architecture Team

---

## 1. Scope

This document defines Android and iOS native capability ownership inside the
Tauri Mobile architecture.

It does not define:

- Mobile product state or navigation;
- Station business policy;
- portable-core domain semantics;
- a separate Android or iOS application architecture.

## 2. System Boundary

```text
apps/mobile/src
  Mobile presentation
        |
        | typed action/projection
        v
apps/mobile/src-tauri/src
  Mobile Rust runtime
        |
        | typed plugin command/event
        v
apps/mobile/src-tauri/plugins
  Android Kotlin / iOS Swift adapter
        |
        | OS API
        v
Device capability
```

The plugin layer adapts OS capabilities. It does not own business state.

## 3. Ownership

### 3.1 Mobile presentation

- renders capability and admission projections;
- requests a typed product action;
- never calls Android/iOS SDKs directly;
- never receives secrets, provider tokens, native file paths, or unrestricted
  native handles.

### 3.2 Mobile Rust runtime

- registers plugins and Tauri permissions;
- validates lifecycle generation, scope, deadline, and request identity;
- converts native results into `CapabilityFact` or typed operation results;
- owns local staging, secure persistence, reconciliation, and cleanup when the
  capability contract requires them;
- feeds product policy through explicit admission projections.

### 3.3 Native plugin

- calls Android or iOS APIs;
- checks and requests OS permission;
- normalizes native callbacks;
- emits exactly one typed terminal result where the contract requires it;
- releases native resources on cancellation, timeout, teardown, or terminal
  completion.

### 3.4 Station and Model

- Model owns shared contract semantics.
- Station owns shared policy and cross-device business truth.
- A plugin cannot activate a Station session, commit business state, or define
  a private domain protocol.

## 4. Plugin Layout

```text
apps/mobile/src-tauri/plugins/
├── platform-permissions/
│   ├── src/
│   ├── android/
│   └── ios/
├── secure-input/
│   ├── src/
│   ├── android/
│   └── ios/
└── secure-storage/
    ├── src/
    └── android/
```

The layout records current source only. A missing OS adapter means that
capability is unavailable or `UNPROVEN` on that release target; another
target's implementation does not substitute for it.

## 5. Plugin Contract

Every plugin capability must define:

- capability ID and semantic owner;
- typed request, response, event, and error shapes;
- Android and iOS availability;
- permission states;
- lifecycle and cancellation behavior;
- thread and blocking constraints;
- sensitive-data boundary;
- duplicate/late callback behavior;
- cleanup and resource baseline;
- source-bound evidence cells.

Generic JSON tunnels, unrestricted command dispatch, and global native objects
are forbidden.

## 6. Capability Facts

Native status is reported as typed facts:

```text
available
unavailable
denied
restricted
unsupported
unknown
```

Facts include release target, observation source, and timestamp. Runtime policy
combines them with Station and product policy before presentation consumes
them.

The plugin does not decide whether a feature is visible, admitted, degraded,
or blocked.

## 7. Sensitive Data

- Secrets remain in Rust or OS secure storage.
- Provider tokens are never exposed to Web state.
- Native file paths, content URIs, bookmarks, and durable grants remain behind
  Rust-owned opaque handles.
- Logs and evidence contain typed redacted metadata only.
- Native callback payloads are validated before they enter runtime state.

## 8. Background and Push

Push and background callbacks are wakeup inputs:

```text
OS callback
  -> native plugin
  -> generation-fenced Rust ingress
  -> Station/runtime reconciliation
  -> projection update
```

The plugin does not mutate business projections, retry Station commands, or
navigate the UI directly.

Provider support must be claimed separately for Android and iOS. Source,
provider configuration, packaging, registration, receipt, tap, expiration,
and cleanup are independent evidence concerns.

## 9. Media and File Capabilities

Native selection returns a bounded result to Rust. Rust owns:

- request validation;
- scoped staging;
- digest and size validation;
- encryption/upload integration;
- promotion or cleanup;
- opaque handles exposed to presentation.

The plugin does not become a media store or upload owner.

### Chat file actions

`MessagingEngine` authorizes a private attachment and returns the local
`AttachmentAccessProjection` protobuf. Its asset URL identifies a bounded
`chat-file` grant bound to the active actor, Station, profile, device,
activation generation and WebView. The protocol accepts GET/HEAD and a single
byte range; MIME normalization prevents active text from becoming executable
Web content.

`platform-permissions.executeFileAction` receives only a Rust-created verified
copy under the OS cache `peers-touch-file-handoff` root. Its typed request
contains request ID, preview/open/export intent, local path, MIME type and a
bounded deadline. The terminal outcome contains the same request ID,
completed/cancelled/unavailable/failed and a reason. Paths stay inside the
Rust-to-plugin boundary.
Rust captures that deadline before authorization; it cannot mint a newer
issuance after a plugin cancel-all watermark. Per-request cancellation reaches
the plugin even when the issuing Engine is already suspended or unavailable.

iOS uses Quick Look, the Open In application picker and document export with
copy semantics. Android uses a dedicated FileProvider restricted to this
handoff directory, read-only grants and ACTION_VIEW for explicit external
opening; ACTION_CREATE_DOCUMENT selects a user export destination. Android
keeps the owned destination picker within the explicit operation's deadline.
Its own Activity stop does not suspend and cancel that export. Returning to the
Host clears this presentation stop; cancellation, timeout or teardown while
still stopped releases the deferred background signal. Account and Station
revocation continue to cancel the operation.
Android
native document preview returns unavailable so the detail surface can offer
an explicit external action. Browser-supported media/PDF/text preview stays
in the file detail surface.

The plugin serializes file presentation, rejects stale IDs/deadlines and
normalizes late callbacks. Rust revokes grants and requests plugin cancellation
on scope teardown/suspension. The destination is owned by the user; Attachment
cache eviction does not remove exported files. Native handoff copies have
bounded count and retention and are never writable attachment-cache aliases.
Quick Look completes on dismissal. Rust removes its copy after that result and
removes export copies after the destination operation; failed/stale handoffs
are discarded. Successful external-opening copies remain under bounded retention.

## 10. Verification

Each capability requires:

- shared Rust contract tests;
- Android adapter build/runtime evidence when Android is supported;
- iOS adapter build/runtime evidence when iOS is supported;
- permission denial and cancellation evidence;
- lifecycle interruption and late-callback evidence;
- cleanup evidence.

An absent or stale platform cell is `UNPROVEN`.

## 11. Related Sources

- [Mobile Base](./base.md)
- [Mobile Lifecycle](./lifecycle.md)
- [Cross-Client Runtime](../../architecture/platform/client/cross-client-runtime/README.md)
- [Mobile Shell Design](../../architecture/platform/client/mobile/design.md)

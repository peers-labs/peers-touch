# Mobile Lynx Bridge Coding Guide

> **Status**: active
> **Updated**: 2026-10-16
> **Scope**: Tauri Mobile native Lynx host and canonical applet bridge

---

## 1. Architecture

```text
Mobile applet surface
  -> Mobile Rust applet host
  -> Tauri native plugin
  -> Android/iOS LynxView host
  -> applet bundle
  -> canonical applet bridge
  -> Capability Gateway
```

The native Lynx host is a Mobile plugin capability. It is not a separate
Android or iOS product shell.

## 2. Canonical Contracts

- Manifest: `@peers-touch/applet-contract`
- Bridge namespace: `peers-touch.applet.bridge`
- Applet SDK: `packages/applet-sdk/`
- Host semantics: `packages/applet-kernel/`
- Architecture: `docs/architecture/platform/applet-runtime/`

Do not define an Android-only or iOS-only bridge protocol.

## 3. Source Placement

Shared applet product/runtime code stays in:

```text
packages/applet-contract/
packages/applet-kernel/
packages/applet-sdk/
apps/mobile/src/
apps/mobile/src-tauri/src/
```

Native Lynx adapters belong under a capability plugin:

```text
apps/mobile/src-tauri/plugins/<lynx-capability>/
├── src/
├── android/
└── ios/
```

The absence of this plugin means native Mobile Lynx hosting is `UNPROVEN`.

## 4. Session Boundary

Each applet instance binds:

- applet ID and package revision;
- manifest digest;
- bridge protocol version;
- instance/session ID;
- Station/PTID/device scope where required;
- granted capabilities;
- lifecycle generation;
- host release target.

Every request carries a request ID and resolves exactly once.

## 5. Permission Model

Effective permission is the intersection of:

```text
manifest declaration
Tauri capability
host policy
Station/product policy
OS permission
runtime availability
```

Unknown or missing input fails closed. The native host does not grant a
capability because a bridge method name exists.

## 6. Request and Event Rules

- Use canonical request/response/event envelopes.
- Validate method, version, request ID, session, capability, and payload.
- Return canonical typed errors.
- Reject stale-generation and destroyed-session messages.
- Bound payload size, event rate, and outstanding requests.
- Keep binary/media payloads outside JSON envelopes and expose opaque handles.
- Never expose native paths, content URIs, credentials, or unrestricted host
  objects to applet code.

## 7. Lifecycle

```text
discovered
  -> validated
  -> loading
  -> active
  -> paused
  -> destroyed
```

- Host creates and destroys LynxView resources.
- Pause/background suspends bridge delivery according to capability policy.
- Destroy rejects new requests, settles or cancels admitted work, removes
  listeners, and releases native resources.
- Late callbacks are ignored after cleanup.
- Restoration creates a new generation and session binding.

## 8. Android Adapter

The Android adapter:

- hosts LynxView inside the Tauri Android application;
- binds Kotlin/JNI/plugin lifecycle to the canonical host session;
- follows Activity/process recreation rules;
- avoids long work on the main thread;
- uses Android permission and resource APIs only behind typed capabilities.

Android evidence requires the current Tauri Android artifact and a real
emulator/device applet route. iOS evidence cannot substitute.

## 9. iOS Adapter

The iOS adapter:

- hosts LynxView inside the Tauri iOS application;
- binds Swift/plugin lifecycle to the canonical host session;
- follows scene/background/termination rules;
- keeps UI work on the main actor and long work off it;
- uses iOS permission and resource APIs only behind typed capabilities.

iOS evidence requires the current Tauri iOS artifact and a Simulator/device
applet route. Android evidence cannot substitute.

## 10. Security

- Verify bundle integrity before activation.
- Enforce manifest capability declarations.
- Keep applet storage scoped by applet and actor/Station where required.
- Sanitize host errors.
- Record redacted audit events for capability admission and denial.
- Apply bounded admission to bridge work.
- Never allow bridge code to bypass Station authorization or native plugin
  permission boundaries.

## 11. Verification

Required proof includes:

- manifest and bundle validation;
- Android and iOS host build;
- bridge version negotiation;
- capability allow/deny/unknown;
- request success, failure, timeout, cancellation, duplicate, and late result;
- background/resume/destroy cleanup;
- payload/rate limits;
- no secrets or native paths in applet-visible state;
- independent Android and iOS end-to-end applet route evidence.

Missing platform evidence is `UNPROVEN`.

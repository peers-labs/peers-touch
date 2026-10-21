# Cross-Runtime Communication Protocol Guide

> **Status**: active
> **Updated**: 2026-10-17
> **Scope**: Model contracts, Station APIs, Tauri IPC, realtime streams, files, and native ports

---

## 1. Authority

```text
Model
  owns shared contract meaning
Station
  owns shared business operations and outcomes
Client runtime
  owns typed local orchestration and projections
Platform host
  owns OS capability adaptation
```

Transport and serialization do not grant business authority.

## 2. Shared Contracts

Cross-process and cross-device request, response, event, enum, and identity
semantics originate in:

```text
model/domain/**/*.proto
```

Rules:

- generated bindings are derivative;
- field numbers remain stable and removed fields are reserved;
- unknown fields/enums follow the owning compatibility policy;
- Rust/TypeScript/Go/Kotlin/Swift boundary types do not redefine a Model-owned
  concept;
- core-internal types are allowed only behind an explicit total mapper.

See [Proto Guide](./proto.md).

## 3. Station API

Station business APIs use their registered API Governance owner. A client does
not invent an endpoint family, infer policy from transport status, or preserve
an obsolete route as fallback.

Client requests carry:

- verified Station identity and selected route;
- authenticated actor/session/device context;
- typed request payload;
- request or command identity where required;
- explicit idempotency/readback semantics for mutations.

HTTP status, protocol error, Station business rejection, timeout,
cancellation, overload, and unknown mutation outcome remain distinct.

## 4. Native Client Transport

Desktop and Mobile presentation call typed Tauri commands. Rust owns Station
credentials, trust verification, route selection, request bounds,
cancellation, and transport error mapping.

```text
React/TypeScript
  -> typed gateway
  -> Tauri IPC
  -> Desktop/Mobile Rust transport
  -> canonical Station API over direct or authorized Relay route
```

Tauri IPC uses framework serialization at the host edge. That JSON envelope is
not a second domain contract: arguments decode immediately into typed command
inputs, and binary/protobuf payloads remain typed bytes.

Android Kotlin and iOS Swift plugins do not implement independent Station
business clients. A native network adapter is permitted only for a narrow OS
capability port and cannot hold Station policy or credentials outside its
declared boundary.

## 5. Realtime Stream

The canonical client realtime channel is:

```text
GET /events/stream
Accept: text/event-stream
Authorization: Bearer <session credential>
X-Device-ID: <device identity>
Last-Event-ID: <opaque cursor, optional>
```

One authenticated device-window/session owns one multiplexed SSE stream.
The SSE `data:` field carries generated realtime protobuf bytes using the
encoding defined by `model/domain/realtime/event.proto`.

Rules:

- one stream, one cursor, one reconnect owner;
- no per-feature SSE or parallel WebSocket business channel;
- event IDs are opaque;
- control-event loss closes affected write admission;
- data gaps/overflow mark affected projections stale and trigger targeted
  reconciliation;
- background/resume follows client lifecycle policy;
- Android/iOS native callbacks wake the shared runtime and do not parse or
  mutate business state.

See [Realtime Plane](../../../architecture/shared/communication/event-stream.md)
and [Mobile Event Stream](../mobile/event-stream.md).

## 6. Streaming Responses

AI/token streaming and resource streaming are operation-scoped response
streams, not additional application event buses. Their owner defines:

- framing and content type;
- cancellation;
- maximum item/body size;
- backpressure;
- timeout and terminal error;
- partial-result semantics;
- cleanup when the consumer disappears.

A page does not retain a transport stream beyond the owning runtime lifecycle.

## 7. Files And Media

- Small typed metadata uses the owning Model/API contract.
- File upload/download uses the registered OSS/resource owner and bounded
  streaming.
- Presigned URLs and provider handles are scoped capabilities, not general
  network authority.
- Native media pickers return typed handles; provider-owned paths/URIs do not
  enter durable Web state.
- Private content is encrypted according to its domain contract before
  Station/OSS transport.

## 8. Native Capability Ports

Native plugin messages are capability-specific:

```text
typed request
  -> Rust admission and generation fence
  -> Kotlin/Swift OS adapter
  -> typed result or typed error
  -> Rust/runtime projection
```

Generic command runners, untyped JSON tunnels, global host objects, and
arbitrary network/file access are forbidden. Every request has one terminal
result; late or duplicate callbacks are discarded and cleaned up.

## 9. Compatibility

Internal ownership changes use a hard cut: one current route and one owner.
Released external contracts use explicit version/migration policy:

- Proto/wire compatibility;
- persisted local schema migration;
- deep-link and provider callback compatibility;
- applet/plugin protocol compatibility.

An internal compatibility facade cannot be used to avoid consumer migration.

## 10. Verification

Protocol verification covers:

- generated-contract compatibility;
- authenticated actor/resource ownership;
- malformed and oversized input;
- cancellation and timeout;
- idempotent retry and unknown mutation outcome;
- SSE resume, gap, overflow, and teardown;
- direct and declared Relay routes;
- file digest/range/cancellation;
- stale lifecycle generation and late native callback;
- independent Desktop, Android, and iOS runtime cells where claimed.

Static/type/unit checks prove contract mechanics only. They do not prove native
host integration, provider setup, route trust, or receiver-visible behavior.

## 11. Related Sources

- [Cross-Client Runtime](../../../architecture/platform/client/cross-client-runtime/README.md)
- [Node Connectivity](../../../architecture/platform/runtime/node-connectivity/README.md)
- [API Governance](../../../architecture/engineering/api-governance/README.md)
- [Security Guide](./security.md)

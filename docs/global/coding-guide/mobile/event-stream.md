# Mobile Event Stream Coding Guide

> **Status**: active
> **Updated**: 2026-10-17
> **Scope**: Tauri Mobile Station realtime transport, shared ingress, and runtime projections

---

## 1. Architecture

```text
Station /events/stream
  -> Mobile Rust authenticated transport
  -> Tauri event mobile:station-realtime
  -> shared Mobile realtime supervisor
  -> bounded event ingress
  -> domain runtime projections
  -> React presentation
```

Mobile owns one session-scoped Station stream. Android and iOS do not maintain
separate OkHttp or URLSession business event clients.

Canonical sources:

- wire contract: `model/domain/realtime/event.proto`;
- Rust transport: `apps/mobile/src-tauri/src/runtime/station_transport/`;
- TypeScript transport boundary: `apps/mobile/src/services/stationTransport.ts`;
- stream adapter: `apps/mobile/src/features/social/socialRealtime.ts`;
- bounded ingress: `apps/mobile/src/runtimes/socialEventIngress.ts`;
- runtime ownership: `apps/mobile/src/runtimes/runtimeRegistry.ts`.

## 2. Ownership

Mobile Rust owns:

- authenticated `GET /events/stream`;
- Station/session/device headers and trust;
- `Last-Event-ID` request projection;
- stream cancellation and replacement;
- byte-chunk delivery through one typed Tauri event;
- transport failure and terminal close.

The session-scoped Mobile runtime owns:

- one live stream per current lifecycle generation;
- cursor preservation and resume;
- protobuf decode and event classification;
- bounded control/data admission;
- deduplication and gap detection;
- targeted reconciliation after overflow, reconnect, wake, or resume;
- domain projection fan-out.

Pages only subscribe to projections. They do not open streams, parse SSE, own
cursors, add polling fallbacks, or perform mount-time freshness loops.

Android/iOS native plugins may report network or lifecycle facts and deliver
push/background wakeups. They do not parse business events or mutate product
stores.

## 3. Wire Rules

- The endpoint is `GET /events/stream`.
- The client sends `Accept: text/event-stream`, authenticated session headers,
  `X-Device-ID`, and an opaque `Last-Event-ID` when resuming.
- SSE `data:` carries protobuf wire bytes encoded according to the canonical
  realtime contract.
- Event IDs are opaque Station cursors. Client code must not derive ordering
  from their textual shape.
- Unknown protobuf fields remain compatible. Unknown event kinds are surfaced
  or ignored according to the owning runtime contract, never reinterpreted.
- One stream multiplexes Chat control intents, Social, Moments, Notification,
  Profile, presence, and call signaling.

Do not introduce WebSocket, per-feature SSE, native-platform event DTOs, or a
notify-then-pull path without replacing the canonical realtime architecture.

## 4. Lifecycle

```text
session admitted
  -> install listener
  -> start stream from runtime-owned cursor
  -> connected
  -> ingest chunks
  -> reconcile gaps or overflow
  -> suspend/teardown
  -> stop stream and remove listener
```

Rules:

- A Station, actor, session, device, or lifecycle-generation change tears down
  the old stream before the new one becomes authoritative.
- Late events from an old stream ID or generation are discarded.
- Background closes or suspends live ingress according to lifecycle policy.
- Resume revalidates session and Station identity before reopening the stream.
- Cancellation is explicit and cleanup is idempotent.
- Reconnect uses bounded owner policy; a feature module cannot create its own
  retry loop.

## 5. Backpressure And Failure

Control events that affect write eligibility must not be silently dropped.
Control loss closes affected write admission and requires session
revalidation. Data overflow marks only the affected projections stale and
requests targeted reconciliation.

Transport failure, decode failure, handler failure, cursor gap, capacity
overflow, and session invalidation remain distinct outcomes. A closed stream
is not evidence that Station state is lost, and a successful reconnect is not
evidence that every projection is current.

## 6. Verification

Focused source checks cover:

- one stream start/stop owner;
- `Last-Event-ID` preservation;
- stale stream/generation rejection;
- protobuf decode;
- control/data capacity behavior;
- deduplication and cursor gaps;
- targeted reconciliation;
- teardown and listener cleanup.

Native support claims additionally require current-source Android and iOS
runtime cells. A TypeScript unit test, Rust unit test, or one OS run does not
prove the other release target.

## 7. Related Sources

- [Realtime Plane](../../../architecture/shared/communication/event-stream.md)
- [Mobile Shell](../../../architecture/platform/client/mobile/README.md)
- [Mobile Lifecycle](../../../client/mobile/lifecycle.md)
- [Sync Protocol](../../../client/mobile/sync-protocol.md)
- [Mobile Network Layer](./network-layer.md)

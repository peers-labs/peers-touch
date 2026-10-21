# Mobile Network Layer Coding Guide

> **Status**: active
> **Updated**: 2026-10-16
> **Scope**: Mobile Web gateways, Mobile Rust transport, Station trust, and native network constraints

---

## 1. Ownership

```text
Mobile presentation
  -> feature runtime
  -> typed gateway
  -> Mobile Rust authenticated transport
  -> station-libp2p-http / Station API
  -> Station
```

Kotlin and Swift do not implement independent Mobile business HTTP clients.
Native plugins expose OS networking capabilities only when a narrow typed port
requires them.

## 2. Source Roots

```text
apps/mobile/src/services/gateways/
apps/mobile/src/services/mobileCommands.ts
apps/mobile/src-tauri/src/commands/
apps/mobile/src-tauri/src/runtime/
apps/mobile/src-tauri/src/platform/
packages/station-libp2p-http/
packages/station-trust/
model/domain/
```

## 3. Contract Rules

- Shared request, response, and event meaning comes from `model/domain/`.
- Public API ownership follows API Governance.
- Generated types are used at cross-process and cross-device boundaries.
- A gateway does not define a parallel business DTO.
- JSON is not introduced for a domain concept already governed by Proto.
- Transport errors are mapped into stable typed runtime outcomes.

## 4. Authentication and Trust

- Station scope is identified by signed `station_peer_id`, not URL alone.
- Route URL, Node PeerID, and Relay route are transport inputs.
- Credentials remain in Mobile Rust secure state and are not attached by Web
  presentation code.
- Station, PTID, device, credential, and lifecycle generation bind requests.
- Identity mismatch fails before credential use.
- Production credentials require TLS and Station trust verification.

## 5. Gateway Rules

A TypeScript gateway may:

- serialize generated request types;
- invoke one typed Rust command;
- map typed runtime errors into feature results;
- expose cancellation to the owning runtime.

A gateway may not:

- read or attach bearer credentials;
- select a retry policy for non-idempotent writes;
- own event streams or long-lived freshness;
- silently fall back to a second endpoint family;
- infer Station policy from HTTP status or empty data.

## 6. Runtime Admission

Network work is submitted through bounded runtime admission:

- reads may use cancellation and latest-wins;
- writes declare idempotency;
- non-idempotent unknown outcomes remain unresolved until owner readback;
- large payloads and streams have independent flow control;
- background work cannot starve visible control work;
- retries use bounded owner policy and never a generic infinite loop.

## 7. Connectivity

Mobile connects to the same logical Station through:

- direct trusted Station transport; or
- an authorized opaque Relay route.

Mobile does not expose a general peer listener, Relay service, or Federation
authority. Relay does not terminate Station business TLS or sessions.

## 8. Lifecycle

- Background closes write admission and suspends/downgrades streams.
- Resume revalidates Station/session and reconciles before writes reopen.
- Station or actor change fences the generation and tears down old transport.
- Native push/background callbacks trigger reconciliation; they do not carry
  authoritative business state.
- Late responses from an old generation are discarded.

## 9. Error Model

Network errors distinguish:

- trust or identity failure;
- access/session failure;
- protocol incompatibility;
- timeout or cancellation;
- transport unavailable;
- Station rejection;
- unknown write outcome;
- malformed contract;
- local admission rejection.

Presentation receives a sanitized domain/runtime projection, not raw transport
exceptions.

## 10. Verification

Verification must cover:

- exact-source Mobile Rust build;
- signed Station identity mismatch;
- access/session expiry and revocation;
- cancellation and timeout;
- unknown non-idempotent write outcome;
- reconnect and resume reconciliation;
- direct and declared Relay routes;
- payload bounds and redaction;
- Android and iOS runtime cells independently.

Shared source checks do not prove platform network security configuration.

## 11. Related Sources

- `docs/architecture/platform/client/cross-client-runtime/`
- `docs/architecture/platform/station/access/`
- `docs/architecture/platform/runtime/node-connectivity/`
- `docs/architecture/engineering/api-governance/`
- `docs/client/mobile/sync-protocol.md`

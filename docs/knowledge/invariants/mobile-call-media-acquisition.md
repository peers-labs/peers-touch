---
kind: invariant
title: Mobile call media reacquisition is bounded
status: active
owns:
  - apps/mobile/src/features/call/
referenced-by: []
related:
  - docs/architecture/domains/chat/lifecycle/decisions.md
  - docs/client/mobile/lifecycle.md
detected: 2026-10-12
---

# Mobile call media reacquisition is bounded

## What must hold

Mobile call media acquisition MUST absorb the bounded native release window
after a prior call or recording stops. `AbortError` and `NotReadableError` MAY
be retried with short bounded delays. Permission, security, missing-device,
constraint, and unsupported-media errors MUST fail immediately. Exhausted
retries MUST terminate the call and release every local media resource.

An identical `CALL_REQUEST` redelivery with the same `call_id`, peer PTID, and
signaling session identity MUST be an idempotent no-op while that call remains
locally active. It MUST NOT emit `CALL_REJECT busy`, replace the active call, or
restart its ring deadline. A different `call_id` received while a call is
non-terminal remains a distinct concurrent request and MAY be rejected as
busy.

## Why this is non-negotiable

`MediaStreamTrack.stop()` ends the web track synchronously, but Android and iOS
WebViews may release the native capture device later. A reject, hangup, or voice
recording followed by an immediate call retry can therefore receive a transient
capture error even though the device is healthy and becomes available shortly
afterward.

Retrying every media error is also incorrect. Permission denial and missing or
unsupported devices require user action and must not become hidden retry loops.
The call runtime is the single owner of this distinction so outgoing and
incoming calls cannot drift.

Realtime delivery and reconnect reconciliation may expose the same sealed call
request more than once. Treating that redelivery as a new concurrent call can
commit a false busy rejection while the user is accepting the original request,
preventing media acquisition from starting even though the endpoint is healthy.
The canonical call identity, not delivery cursor identity, owns deduplication.

## How to verify

- `pnpm --dir apps/mobile exec vitest run src/features/call/callState.test.ts`
  must prove identical request redelivery is a no-op, transient contention
  retries, and permission denial does not retry.
- `node apps/mobile/scripts/run-three-client-product-journey.mjs --phase chat --publish-evidence`
  must prove reject, retry, accept, hangup, and stale-state cleanup through the
  foreground Android, Desktop, and iOS clients.
- `rg "getUserMedia" apps/mobile/src/features/call` must show one acquisition
  owner rather than call-site-specific retry loops.

## Crosswalks

- `CHAT-D05` defines the live call runtime and media teardown boundary.
- `MWPU-04-CHAT` owns the three-client call retry Journey.

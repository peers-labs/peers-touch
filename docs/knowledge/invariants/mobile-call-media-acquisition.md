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

## How to verify

- `pnpm --dir apps/mobile exec vitest run src/features/call/callState.test.ts`
  must prove transient contention retries and permission denial does not retry.
- `node apps/mobile/scripts/run-three-client-product-journey.mjs --phase chat --publish-evidence`
  must prove reject, retry, accept, hangup, and stale-state cleanup through the
  foreground Android, Desktop, and iOS clients.
- `rg "getUserMedia" apps/mobile/src/features/call` must show one acquisition
  owner rather than call-site-specific retry loops.

## Crosswalks

- `CHAT-D05` defines the live call runtime and media teardown boundary.
- `MWPU-04-CHAT` owns the three-client call retry Journey.

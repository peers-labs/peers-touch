---
kind: pitfall
title: Mobile periodic repair must recover failed Messaging before its dependents
status: active
owns:
  - apps/mobile/src/runtimes/messagingRuntime.ts
  - apps/mobile/src/runtimes/socialProjectionRuntime.ts
  - apps/mobile/src/features/social/socialRuntime.ts
related:
  - docs/client/mobile/lifecycle.md
referenced-by: []
detected: 2026-10-24
---

# Mobile Messaging recovery after a Station outage

## Symptom

The iOS Social Search native Journey recovered reads after a Station outage but
could not admit the subsequent block operation. Original Messaging readiness
retained a worker-cycle failure after transient network and HTTP 503 errors.
Its dependent runtimes remained unavailable while Social ingress was active
with closed write admission. Android recovered independently in that run.

## Root cause

The OS network stayed connected during service recovery. A failed Messaging
wake therefore received no new network observation. Social's existing periodic
repair reconciled dependent projections without retrying Messaging, and
explicit repair attempted those projections before their dependency recovered.

## Mitigation

The Messaging readiness owner alone decides whether recovery is required.
Periodic Social repair asks the original Messaging wake to run only when that
owner reports failure, before refreshing dependent projections. Successful
scope-fenced reconciliation publishes readiness through the existing port.
Failed recovery keeps admission closed. Healthy Messaging performs no extra
periodic native call. No new timer, readiness registry, or mutation replay is
introduced.

## How to detect a recurrence

- Run the focused `messagingRuntime.test.ts` worker-cycle regression: healthy
  recovery requests do not reconcile, repeated failures do not publish ready,
  one successful native reconciliation clears failure, and healthy subsequent
  requests again skip reconciliation.
- Run the `socialProjectionRuntime.test.ts` failed-resume regression: a failed
  periodic retry preserves the original write fence; the next healthy retry
  precedes feed repair and only then admits writes.
- Run `social-content-search-mobile-native-e2e` and
  `chat-mobile-device-search-native-e2e` on current source, including outage,
  recovery, suspend/resume and original-object Open/Return on both native
  targets. Focused source regressions do not replace native evidence.
- Inspect original runtime errors and Gate/Suite cleanup results. A derived
  Search dependency failure cannot substitute for the Messaging cause.

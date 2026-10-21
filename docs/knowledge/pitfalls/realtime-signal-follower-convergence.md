---
kind: pitfall
title: Realtime signals can overtake follower convergence
status: active
owns:
  - apps/station/app/subserver/conversation/signal_authorizer.go
  - tooling/acceptance/gates/chat/lifecycle_call_resolution.py
referenced-by: []
related:
  - docs/architecture/domains/chat/calling/voice-video.md
  - docs/architecture/domains/chat/lifecycle/decisions.md
detected: 2026-10-21
---

# Realtime signals can overtake follower convergence

## Symptom

A cross-Station Direct conversation returned successfully, but an immediate
call failed during its first WebRTC offer:

```text
events: signal route failed ... Federation peer returned HTTP 403
```

The recipient Home Station rejected the first three forwarded signals. The
same route began returning HTTP 200 after the durable Conversation follower
events arrived roughly 600 milliseconds later.

## Root cause

Realtime call signaling uses an ephemeral Federation peer call, while
Conversation follower state arrives through the durable Federation outbox.
The ephemeral request can therefore overtake the follower event. Treating the
temporarily missing shared-Conversation projection as a terminal authorization
denial creates a race between two valid transports.

## Mitigation

### What was done in code

- `conversationSignalAuthorizer` still rejects either block direction
  immediately.
- When no block exists but shared Conversation state is not visible yet, it
  re-reads that projection for a bounded two-second convergence window.
- The timeout remains fail closed; it does not create a fallback authority or
  accept a signal without shared Conversation proof.

### What guards against regression

`signal_authorizer_test.go` proves convergence-after-delay, immediate blocked
denial, and fail-closed timeout. The mixed Desktop/Mobile call-resolution Gate
proves the real cross-Station race through current-source product runtimes.

## How to detect a recurrence

```bash
cd apps/station/app
GOWORK=off go test ./subserver/conversation -run TestSignalAuthorization -count=1
```

```bash
PATH="$PWD/.local/acceptance/python-venv/bin:$PATH" \
python3 tooling/scripts/acceptance-run.py \
  --runtime-cell desktop-macos-native \
  --gate chat-lifecycle-call-resolution-e2e
```

The Station logs must not contain a 403 for
`POST /federation/realtime/signal` after Direct creation.

## Crosswalks

- `CHAT-D02` keeps Conversation membership as authorization truth.
- `CHAT-D05` requires cross-Station signaling through Federation rather than
  direct foreign-Station client access.

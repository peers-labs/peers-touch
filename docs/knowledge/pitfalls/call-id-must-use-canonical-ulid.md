---
kind: pitfall
title: Call IDs must use the canonical ULID generator
status: active
owns:
  - packages/client-chat-core/src/callId.ts
  - apps/desktop/src/modules/p2p/callP2p.ts
  - apps/mobile/src/features/call/
  - apps/station/app/subserver/events/call_resolution.go
referenced-by: []
related:
  - docs/architecture/domains/chat/lifecycle/decisions.md
  - docs/architecture/domains/chat/lifecycle/data-model.md
  - docs/knowledge/invariants/call-resolution-session-identity-width.md
detected: 2026-10-18
---

# Call IDs must use the canonical ULID generator

## Symptom

Native Live Voice reached the Callee Home Station, but `CALL_REQUEST` failed as
`signal delivery failed`. The destination returned HTTP 409 because Station
classified the generated call ID as `CALL_NO_ANSWER`. Broken IDs started with
`06...` while valid IDs for the same wall clock started with `01...`.

## Root cause

Desktop encoded 128 raw bits directly into 26 Crockford Base32 characters.
A ULID string represents 130 bits and requires two leading zero bits, so the
handwritten encoder shifted the 48-bit timestamp left by two and made it four
times larger. Mobile carried a separate implementation, allowing the two
clients to drift.

## Mitigation

### What was done in code

- `packages/client-chat-core/src/callId.ts` now owns Call ID generation.
- Desktop and Mobile both call `createCallId`.
- Checkpoint `86a71c594` removed both client-local generators.

### What guards against regression

The Client Chat Core contract test requires a canonical first character and
decodes the first ten characters back to the exact input timestamp. The Native
Live Voice Gate proves Station accepts the ID and completes call arbitration.

## How to detect a recurrence

```bash
pnpm --filter @peers-touch/client-chat-core test
```

```bash
rg -n "newCallId|CROCKFORD_BASE32|0123456789ABCDEFGHJKMNPQRSTVWXYZ" \
  apps/desktop/src apps/mobile/src
```

The second command must return no client-local generator.

```bash
PATH="$PWD/.local/acceptance/python-venv/bin:$PATH" \
python3 tooling/scripts/acceptance-run.py \
  --runtime-cell desktop-macos-native \
  --gate chat-lifecycle-live-voice-e2e
```

## Crosswalks

- `docs/knowledge/invariants/call-resolution-session-identity-width.md`
  defines the durable Call Resolution identity contract.
- `CCU-D06` in `docs/architecture/domains/chat/lifecycle/decisions.md`
  defines first-terminal-action-wins arbitration.

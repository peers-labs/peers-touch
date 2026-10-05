---
kind: pitfall
title: Mobile projection checkpoints require one live consumer
status: active
owns:
  - apps/mobile/src/services/mobileCommands.ts
  - apps/mobile/src/features/social/socialStore.ts
  - apps/mobile/src/runtimes/commandRuntime.ts
referenced-by: []
related:
  - docs/architecture/platform/client/mobile/decisions.md
  - docs/architecture/platform/client/mobile/data-model.md
  - docs/architecture/shared/security/secure-content/execution-plans/20260913-secure-content-hard-cut/archive/desktop-usability-deferred/W9.md
detected: 2026-09-27
---

# Mobile projection checkpoints require one live consumer

## Symptom

The W9 iOS Journey committed a Friend Request acceptance, then failed while
acknowledging its projection checkpoint:

```text
CommandNotFound: matching projection checkpoint does not exist
```

## Root cause

The foreground Social action applied and acknowledged the terminal checkpoint,
while `mobileCommands` synchronously woke the background command reconciler for
the same checkpoint. Either consumer could delete it first, so the other
reported a false product failure after the Station command had committed.

## Mitigation

### What was done in code

- Friend Request command wrappers wake background recovery only when their
  result has no ready projection checkpoint.
- Checkpoint-ready results remain owned by the foreground Social action, which
  applies the projection before acknowledging it.
- Relationship commands keep their existing background wake because their
  foreground path does not acknowledge checkpoints.

### What guards against regression

`friendRequestCheckpointOwnership.test.ts` verifies send, accept, and reject
for both checkpoint-ready and recovery-needed results. W9 then executes the
same behavior through real iOS, Android, and cross-platform runtimes.

## How to detect a recurrence

Run:

```bash
pnpm --dir apps/mobile exec vitest run \
  src/acceptance/friendRequestCheckpointOwnership.test.ts \
  src/features/social/contactJourney.test.ts \
  src/runtimes/commandRuntime.test.ts
```

Then run the exact-source W9 Mobile matrix. A second checkpoint consumer will
surface as `CommandNotFound` during a Friend Request action.

## Crosswalks

- `MS-D15` defines authoritative result and projection checkpoint ownership.
- W9 `sc-dj-mobile-matrix` supplies native receiver-side regression evidence.

---
kind: pitfall
title: Deferred draft restoration must not reopen its decision modal
status: active
owns:
  - apps/mobile/src/runtimes/commandRuntime.ts
  - apps/mobile/src/runtimes/commandRuntime.test.ts
  - apps/mobile/src/runtimes/runtimeRegistry.ts
  - apps/mobile/src/components/recovery/DraftRestoreOverlay.tsx
  - tooling/acceptance/gates/mobile/simulator_social_e2e.py
related:
  - docs/architecture/platform/client/mobile/decisions.md
  - docs/architecture/platform/client/mobile/experience-contract.md
referenced-by: []
detected: 2026-11-14
---

# Deferred draft restoration must not reopen its decision modal

## Symptom

The native Chat recovery Journey selected Restore Drafts after process restart,
then failed to deliver the restored media. An earlier native Voice check showed
the unsaved-drafts dialog covering the composer. The retained draft belonged to
an editor that had not mounted yet.

## Root cause

The runtime queued a validated envelope for its future editor, but the recovery
projection excluded only mounted or previously observed consumers. A later
reconciliation therefore presented the same successful restore choice again.
JavaScript click completion did not mean the covered Chat action was admitted.

## Mitigation

The existing pending handoff queue counts as a completed restore decision for
that exact Station, actor, surface and target. Rust remains the durable owner;
restoration neither sends nor deletes the draft. The future editor still
receives the queued envelope.

Consumer rejection or a missing durable source removes the pending handoff,
propagates the error and makes the draft eligible for recovery again. Do not
suppress the dialog in the page or driver, discard data, or introduce a second
acknowledgement store.

The original recovery Journey selects Restore Drafts after each process
restart and verifies modal closure and unchanged durable draft identities.

## How to detect a recurrence

Run:

```bash
pnpm --dir apps/mobile exec vitest run \
  src/runtimes/commandRuntime.test.ts \
  src/components/recovery/DraftRestoreOverlay.test.ts \
  src/runtimes/runtimeRegistry.test.ts
```

The tests require deferred delivery without repeated prompts, exact-scope
isolation and renewed recovery on failed delivery. Then run the exact-source
`mobile-simulator-recovery-e2e` through its approved remote Profile: restored
Chat media must reach the receiver and real recording must remain usable.
Static checks and click responses alone do not prove those product outcomes.

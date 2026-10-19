# EDX-H02: Resolve A Station Identity Change On Mobile

## Starting Context

Mobile resumes a saved Station scope. The signed identity observed at the saved
address differs from the identity pinned by the prior session. The old Shell is
blocked and the recovery projection retains both identity references.

## User Goal

Understand what changed, avoid entering credentials into the wrong scope, and
choose whether to re-authenticate the saved Station or return to Station
selection.

## Required Sources

- `apps/mobile/src/components/recovery/SessionMismatchOverlay.tsx:1-124`
- `apps/mobile/src/runtimes/recoveryProjection.ts:74-80`
- `apps/mobile/src/runtimes/recoveryProjection.ts:479-487`
- `apps/mobile/src/App.tsx:685-706`
- `apps/mobile/src/App.tsx:798-830`
- `docs/architecture/platform/client/mobile/product-state-model.md:106-125`
- `docs/architecture/platform/client/mobile/product-state-model.md:142-167`
- `docs/architecture/platform/client/mobile/experience-contract.md:25-47`
- `docs/architecture/platform/client/mobile/experience-contract.md:132-143`
- `docs/client/mobile/lifecycle.md:161-173`

## States To Walk

- saved Station verified with the expected identity;
- identity mismatch detected before access;
- blocking mismatch overlay;
- re-authentication pending, failed or complete;
- return to Station selection;
- old-scope projection remains hidden until a valid Gate completes.

## Review Boundary

Review the user-visible trust boundary, action meaning and recovery handoff.
Raw peer IDs should not become primary UI copy. Do not redesign signed Station
identity verification or define a replacement protocol.

Return the JSON ReviewResult required by `rubric.md`.

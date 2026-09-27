# W6B-DRAFT-UX - Moment Draft Persistence Recovery

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6B-DRAFT-UX",
  "workstreamId": "W6B",
  "title": "Moment draft persistence failure and discard recovery",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "W6B-draft-ux-source",
  "journeyId": "MS-J05-draft-recovery",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/features/social/useMomentsDraft.ts",
    "apps/mobile/src/features/social/useMomentsDraft.test.ts",
    "apps/mobile/src/pages/moments/MomentComposer.tsx",
    "apps/mobile/src/pages/moments/MomentComposer.test.ts"
  ],
  "readSet": [
    "docs/architecture/mobile/data-model.md",
    "docs/architecture/mobile/experience-contract.md",
    "docs/architecture/mobile/product-state-model.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "moments-draft-recovery-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social/useMomentsDraft.test.ts src/pages/moments/MomentComposer.test.ts",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Draft persistence failure remains visible and retryable",
    "Explicit discard removes the exact Station and actor scoped draft",
    "Publish failure retains the complete draft and successful attachments",
    "Successful publish or explicit discard is the only normal draft removal"
  ],
  "failureBehavior": [
    "Do not clear a draft on persistence or publish failure",
    "Do not mix newly selected media with owner-undefined restored media references",
    "Descriptor-bearing restored drafts and private-audience envelopes remain owner-blocked"
  ],
  "updatedAt": "2026-09-17T03:30:00Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src/features/social/useMomentsDraft.test.ts"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src/pages/moments/MomentComposer.test.ts"
    }
  ]
}
```

## Objective

Close the accepted device-local Moment draft lifecycle without inventing the
still-undefined restored-media or private-audience key contracts.

## Current Snapshot

- Draft storage failures are currently discarded in a completion callback.
- The only normal `clearDraft` path is successful publish; users have no
  explicit scoped discard action.

## Source Closure

- Draft saves and removals are serialized through the exact Station, PTID,
  Moment-composer, and `compose` scope so explicit discard cannot be undone by
  an older delayed save.
- Persistence failures remain attached to the composer with an exact retry;
  local state is cleared only after scoped removal succeeds.
- Publication flushes text, audience, and successful encrypted-media
  references before contacting Station. Rejection, transport failure, and
  incomplete authoritative readback retain the complete draft.
- Restored media references remain separate from newly selected files, and no
  private-audience or descriptor-bearing restore contract was invented.

## Verification Snapshot

- Focused draft/composer suite: 10/10 PASS.
- Broader Moments source suite: 63/63 PASS.
- Mobile Web checks and scoped diff validation: PASS.
- Formal Moments Acceptance remains deferred until the source frontier closes.

## Concurrency Decision

- This slice is independent of feed recovery, published-media rendering,
  Settings, and native lifecycle work.
- The current Task owns the hook state and composer recovery controls together.

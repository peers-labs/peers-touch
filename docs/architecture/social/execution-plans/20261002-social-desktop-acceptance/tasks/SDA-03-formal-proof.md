# SDA-03: Formal Desktop Social Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SOCIAL-DESKTOP-ACCEPTANCE-20261002",
  "taskId": "SDA-03-formal-proof",
  "workstreamId": "SDA-W02",
  "title": "Aggregate exact-source formal proof for Desktop Social",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "social-desktop-final-proof",
  "journeyId": "SOC-SEC-J01-J09",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/social/execution-plans/20261002-social-desktop-acceptance/tasks/SDA-03-formal-proof.md"
  ],
  "readSet": [
    "apps/desktop",
    "apps/station/app/subserver/social",
    "docs/architecture/acceptance-framework",
    "docs/architecture/secure-content",
    "docs/architecture/social",
    "packages/secure-content-core",
    "tooling/acceptance",
    "tooling/development/secure_content",
    "tooling/scripts"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 9000,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "social-desktop-completion-proof",
      "command": "make acceptance-run-completion",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "social-desktop-coverage",
      "command": "make acceptance-coverage-report",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "SDA-02 exact-source Native functional proof is complete",
    "all six Desktop Social completion Gates pass on the final exact source",
    "the Social Domain validates with required Desktop capabilities PROVEN",
    "AS11 Browser and AS14 Mobile remain explicit UNPROVEN non-claims",
    "the formal Suite report ends in cleanup-complete and all owned runtime resources are released"
  ],
  "failureBehavior": [
    "formal proof cannot fabricate or replace the predecessor FUNCTIONAL_CHECK",
    "a failed Gate returns to its owning Task or source without weakening the Gate",
    "the full-only Chat Gate remains outside this completion closure",
    "unrun Browser, Mobile and positive cross-Station delivery remain UNPROVEN"
  ],
  "updatedAt": "2026-10-02T17:31:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "NOT_RUN",
      "ref": "Awaiting exact-source completion Acceptance after SDA-02"
    }
  ]
}
```

## Current Snapshot

- This Task owns no new functional claim.
- Its predecessor owns the reusable Alice/Bob/Eve Native Suite functional run.
- The completion bundle publishes the Native Social Gate before Social Domain
  proof validation.
- Browser, Mobile, positive cross-Station delivery and Chat remain outside the
  claim.

## Closure

The final exact source has independent formal Desktop Social evidence, a
PROVEN Social Domain projection for the bounded claim, and verified cleanup.

## Concurrency Decision

Serial aggregate after `SDA-02-desktop-proof`; the six completion Gates execute
in declared order so Domain validation sees the current Native result.

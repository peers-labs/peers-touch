# SDA-02: Native Desktop Social Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SOCIAL-DESKTOP-ACCEPTANCE-20261002",
  "taskId": "SDA-02-desktop-proof",
  "workstreamId": "SDA-W01",
  "title": "Prove Social Private Moments on one reusable Native Desktop Suite",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "social-desktop-proof",
  "journeyId": "SOC-SEC-J01-J09",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "docs/architecture/social/execution-plans/20261002-social-desktop-acceptance",
    "apps/desktop/src/acceptance/moments/harness.ts",
    "apps/desktop/src/acceptance/moments/harness.test.ts",
    "apps/desktop/src-tauri/src/social/mod.rs",
    "apps/desktop/src-tauri/src/social/private_moment.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/messaging_recovery.rs",
    "tooling/acceptance/gates/social",
    "tooling/acceptance/provisioners/secure_content_remote_recipient.py",
    "tooling/scripts/acceptance-run.py",
    "tooling/scripts/acceptance-run-test.py",
    "tooling/skills/pt-github-review/FRESHNESS.md",
    "tooling/development/secure_content/runtime_owner.py",
    "tooling/development/secure_content/scenarios/social_expansion.py",
    "tooling/development/secure_content/test_runtime_owner.py"
  ],
  "readSet": [
    "apps/desktop",
    "apps/station/app/subserver/social",
    "docs/architecture/social",
    "docs/architecture/secure-content",
    "packages/secure-content-core",
    "tooling/acceptance/capabilities",
    "tooling/acceptance/core",
    "tooling/acceptance/domains",
    "tooling/acceptance/environments",
    "tooling/acceptance/features",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/provisioners",
    "tooling/acceptance/registry.yaml",
    "tooling/development/secure_content/scenarios"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 9000,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "social-private-desktop-source",
      "command": "python3 -m unittest tooling.acceptance.gates.social.test_desktop_private_e2e tooling.development.secure_content.test_runtime_owner",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "social-private-desktop-harness",
      "command": "pnpm --dir apps/desktop exec vitest run src/acceptance/moments/harness.test.ts && pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "social-acceptance-runner-manifest",
      "command": "python3 tooling/scripts/acceptance-run-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "acceptance-plan-self",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-plan-self",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "acceptance-infra-validation",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-infra-validation",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "acceptance-runtime-provisioning-self",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-runtime-provisioning-self",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "acceptance-workflow-contract",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-workflow-contract",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "chat-lifecycle-tree-zero-reference-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-tree-zero-reference-e2e",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "social-private-desktop-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate social-private-desktop-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "social-private-desktop-proven",
      "command": "python3 tooling/scripts/acceptance-run.py --gate social-domain-validation",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "social-private-desktop-e2e",
    "scenarioIds": [
      "desktop-pre-restart",
      "desktop-continuity",
      "private-comment",
      "social-expansion",
      "social-subtype",
      "social-object",
      "social-delete-block",
      "social-bounds"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 5,
    "minWarmReuseRate": 0.85,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "one exact-source Suite Runtime reuses existing four and fiveArm services and compiled Desktop artifacts",
    "Alice, Bob and Eve cover mutual-friend, follower-only non-friend, unrelated and blocked states without registering another local actor",
    "no more than three Native Desktop clients are active concurrently and Bob recovery is the only device replacement",
    "the Suite registers exactly the three isolated relationship actors once; the fiveArm negative reuses an existing owner-issued Actor identity",
    "all 14 Desktop-applicable Acceptance scenarios publish current receiver-visible and security readback evidence",
    "AS11 Browser and AS14 Mobile are recorded as UNPROVEN without launching those runtimes",
    "the Suite report ends in cleanup-complete and Social require-proven validation passes"
  ],
  "failureBehavior": [
    "a source or runtime attestation mismatch blocks before build or deploy; remediation must be explicitly minimal and source-consistent",
    "no Scenario may build, deploy, provision accounts, launch clients or log in",
    "Harness and HTTP observations support but never replace required Native UI action and receiver-visible evidence",
    "partial child results remain unpublished when any Scenario or cleanup fails"
  ],
  "updatedAt": "2026-10-02T02:20:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "NOT_RUN",
      "ref": "Prepared plan; formal Desktop Suite has not run"
    }
  ]
}
```

## Current Snapshot

- Three relationship actors are sufficient: Alice, Bob, and Eve.
- Anonymous is a request mode; Bob2 is Bob's replacement device/session.
- Existing W7/W8 outputs remain supporting development evidence only.
- Friend-request acceptance is asynchronous with respect to the authoritative
  bilateral relationship projection; the Suite fixture waits for both actors
  to observe mutual friendship before publishing private content.
- The formal Gate must publish a new immutable Evidence Store run.

## Closure

The current source has formal Native Desktop proof for the bounded Social
Private Moments claim, with explicit Browser and Mobile non-claims.

## Concurrency Decision

One serial Suite owns all shared services, clients, actors, storage, fixture
state, evidence publication, and cleanup.

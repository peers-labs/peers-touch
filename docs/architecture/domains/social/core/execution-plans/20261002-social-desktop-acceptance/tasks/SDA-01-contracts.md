# SDA-01: Social Desktop Acceptance Contracts

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SOCIAL-DESKTOP-ACCEPTANCE-20261002",
  "taskId": "SDA-01-contracts",
  "workstreamId": "SDA-W01",
  "title": "Inject the formal Social Desktop Acceptance graph",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "social-desktop-contracts",
  "journeyId": "SOC-SEC-J01-J09",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/social",
    "tooling/acceptance/capabilities",
    "tooling/acceptance/domains",
    "tooling/acceptance/environments",
    "tooling/acceptance/features",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/social",
    "tooling/acceptance/provisioners",
    "tooling/acceptance/registry.yaml",
    "tooling/development/secure_content"
  ],
  "readSet": [
    "apps/desktop",
    "apps/station/app/subserver/social",
    "docs/architecture/acceptance-framework",
    "docs/architecture/secure-content",
    "packages/secure-content-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "social-private-desktop-contract-source",
      "command": "python3 -m unittest tooling.acceptance.gates.social.test_desktop_private_e2e tooling.development.secure_content.test_runtime_owner && make acceptance-validate DOMAIN=social",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Social is an active managed Acceptance Domain with nine SOC-SEC capabilities",
    "the Desktop feature maps AS01-AS10, AS12-AS13 and AS15-AS16 to one formal Gate",
    "AS11 Browser and AS14 Mobile remain explicit unproven scope",
    "the Gate owns an independent Acceptance Evidence Store run and consumes owner-produced Native evidence",
    "the Suite contract declares one provisioning run, at most three concurrent Native clients, one Bob replacement, and attach-only Scenarios"
  ],
  "failureBehavior": [
    "development FUNCTIONAL_PASS artifacts are never relabeled as formal proof",
    "missing Gate, environment, capability, feature or registry linkage fails structural validation",
    "an unrelated catalog defect is repaired only at its owning catalog entry and never hidden by weakening validation"
  ],
  "updatedAt": "2026-10-02T02:20:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "Social domain validation passed; Social gate tests plus Secure Content runtime-owner tests passed 98/98"
    }
  ]
}
```

## Current Snapshot

- Social product and architecture contracts are accepted.
- Development W7/W8 evidence is `FUNCTIONAL_PASS / UNPROVEN`.
- Social is registered as an active managed Acceptance Domain.
- Domain validation and the source/runtime-owner regression suite pass.
- Product runtime proof remains owned by `SDA-02-desktop-proof`.

## Closure

The Social graph is structurally complete and selects exactly one formal
Desktop Gate for the bounded product claim.

## Concurrency Decision

Serial foundation. Runtime proof cannot begin before the formal graph validates.
